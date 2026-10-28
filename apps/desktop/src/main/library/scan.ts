import { open, readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { isPromptFileName } from './prompt-id'

/** Prompt templates are small. Anything bigger is almost certainly not one. */
export const MAX_PROMPT_BYTES = 1024 * 1024

export interface ScanResult {
  /** Absolute paths of every prompt file, sorted. */
  files: string[]
  /** Folders that couldn't be read, so the user can be told rather than shown a silently short list. */
  problems: { path: string; message: string }[]
}

/**
 * Lists the `*.md` files under `root`, recursively. Skips dotfiles and hidden
 * folders, and does not follow symlinked folders (so there are no loops).
 * Throws if `root` itself can't be read.
 */
export async function scanLibrary(root: string): Promise<ScanResult> {
  const files: string[] = []
  const problems: ScanResult['problems'] = []

  async function walk(dir: string, isRoot: boolean): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isRoot) throw error
      problems.push({ path: dir, message: describeError(error) })
      return
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith('.')) return
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return walk(path, false)
        if (!isPromptFileName(entry.name)) return
        if (entry.isFile()) files.push(path)
        else if (entry.isSymbolicLink() && (await stat(path).catch(() => null))?.isFile()) {
          files.push(path)
        }
      })
    )
  }

  await walk(root, true)
  return { files: files.sort(), problems }
}

export type ReadResult =
  { kind: 'ok'; text: string } | { kind: 'missing' } | { kind: 'unreadable'; message: string }

// ignoreBOM keeps a leading byte-order mark in the text, so a later save
// writes the file back exactly as it was.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Reads a prompt file as strict UTF-8 text, refusing huge or binary files. */
export async function readPromptFile(path: string): Promise<ReadResult> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch (error) {
    return isCode(error, 'ENOENT') ? { kind: 'missing' } : unreadable(error)
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) return { kind: 'unreadable', message: 'Not a file.' }
    if (info.size > MAX_PROMPT_BYTES) {
      return {
        kind: 'unreadable',
        message: `Too large to be a prompt (${Math.ceil(info.size / 1024)} KB, limit ${MAX_PROMPT_BYTES / 1024} KB).`
      }
    }
    const buffer = await handle.readFile()
    try {
      return { kind: 'ok', text: decoder.decode(buffer) }
    } catch {
      return { kind: 'unreadable', message: 'Not valid UTF-8 text.' }
    }
  } catch (error) {
    return unreadable(error)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** A path as shown to the user: relative to the library, with the platform's separators. */
export function displayPath(root: string, path: string): string {
  const rel = relative(root, path)
  return rel === '' || rel.startsWith('..') ? path : rel.split(sep).join('/')
}

function unreadable(error: unknown): ReadResult {
  return { kind: 'unreadable', message: describeError(error) }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** A short, human-readable reason for a filesystem error. */
export function describeError(error: unknown): string {
  if (isCode(error, 'ENOENT')) return 'The file or folder does not exist.'
  if (isCode(error, 'ENOTDIR')) return 'This is not a folder.'
  if (isCode(error, 'EACCES') || isCode(error, 'EPERM')) return 'Permission denied.'
  return error instanceof Error ? error.message : String(error)
}
