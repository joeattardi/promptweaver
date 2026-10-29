import { join } from 'node:path'
import type { CaptureResult } from '../shared/ipc'
import { writeFileAtomicNew } from './atomic-write'
import { describeError } from './library/scan'

export interface CaptureDeps {
  /** The open library folder, or null if there isn't one. */
  libraryPath: () => string | null
  readClipboard: () => string | Promise<string>
  /** Makes the library re-read these files now, so the new prompt can be opened right away. */
  refresh: (paths: string[]) => Promise<void>
}

const MAX_TITLE = 60
const MAX_SLUG = 50
const MAX_SAME_NAME = 1000

/**
 * "New prompt from clipboard": turns whatever was just copied into a prompt
 * file in the library, so something that worked once is saved in seconds.
 */
export class CaptureService {
  constructor(private readonly deps: CaptureDeps) {}

  async createFromClipboard(): Promise<CaptureResult> {
    const root = this.deps.libraryPath()
    if (root === null) return { status: 'no-library' }
    const text = (await this.deps.readClipboard()).replace(/\r\n?/g, '\n')
    if (text.trim() === '') return { status: 'empty' }

    const title = titleFromText(text)
    const content = promptFileFor(title, text)
    const slug = slugify(title)
    try {
      for (let n = 1; n <= MAX_SAME_NAME; n++) {
        const name = n === 1 ? `${slug}.md` : `${slug}-${n}.md`
        const path = join(root, name)
        if (!(await writeFileAtomicNew(path, content))) continue
        await this.deps.refresh([path])
        return { status: 'created', id: name.replace(/\.md$/, ''), title }
      }
      return { status: 'error', message: `Too many prompts are already named “${title}”.` }
    } catch (error) {
      return { status: 'error', message: `Couldn’t save the prompt: ${describeError(error)}` }
    }
  }
}

/** The first line with something readable in it, shortened. Code fences and rules like --- don't count. */
export function titleFromText(text: string): string {
  const line = text
    .split('\n')
    .filter((l) => !/^\s*(```|~~~)/.test(l))
    .map((l) =>
      l
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .find((l) => /[\p{L}\p{N}]/u.test(l))
  if (line === undefined) return 'Untitled prompt'
  if (line.length <= MAX_TITLE) return line
  const cut = line.slice(0, MAX_TITLE)
  const lastSpace = cut.lastIndexOf(' ')
  // Break at a word if that doesn't throw away more than half.
  return `${(lastSpace > MAX_TITLE / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–-]+$/u, '')}…`
}

/** A lower-case file name stem: letters and digits joined by dashes. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '')
  return slug === '' ? 'untitled-prompt' : slug
}

/**
 * The file for a captured prompt. The text is the body, with `{{` escaped:
 * something copied from a template engine or a Go file should come back
 * word for word, not as questions.
 */
export function promptFileFor(title: string, text: string): string {
  const body = text.replace(/\{\{/g, '\\{{')
  return `---\ntitle: ${yamlString(title)}\nformat: 1\n---\n${body.endsWith('\n') ? body : `${body}\n`}`
}

// Words YAML would read as something other than text if left unquoted.
const YAML_RESERVED = /^(y|n|yes|no|true|false|on|off|null|~)$/i

function yamlString(value: string): string {
  const plain = /^[\p{L}][\p{L}\p{N} ,.()_-]*$/u.test(value) && !YAML_RESERVED.test(value)
  // A JSON string is also a valid YAML double-quoted string.
  return plain ? value : JSON.stringify(value)
}
