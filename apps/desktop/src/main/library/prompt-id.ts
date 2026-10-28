import { isAbsolute, relative, sep } from 'node:path'

const EXTENSION = /\.md$/i

/** Prompt files are `*.md`; anything starting with a dot (editor temp files, `.git`) is not one. */
export function isPromptFileName(name: string): boolean {
  return EXTENSION.test(name) && !name.startsWith('.')
}

/**
 * The prompt id for a file: its path relative to the library folder, without
 * the extension, with `/` separators on every platform. Null if the path is
 * outside the library, not a `.md` file, or inside a hidden folder.
 * Only the part below `root` is judged, so a library that itself lives in a
 * hidden folder works.
 */
export function idFromPath(root: string, filePath: string): string | null {
  const rel = relative(root, filePath)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  const segments = rel.split(sep)
  if (segments.some((s) => s.startsWith('.'))) return null
  const last = segments[segments.length - 1] ?? ''
  if (!EXTENSION.test(last)) return null
  segments[segments.length - 1] = last.replace(EXTENSION, '')
  if (segments[segments.length - 1] === '') return null
  return segments.join('/')
}

/** Folder part of an id ('' at the top level). */
export function folderOf(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash === -1 ? '' : id.slice(0, slash)
}

/** `code-review` or `code_review` becomes "Code review". Used when a file has no usable title. */
export function titleFromId(id: string): string {
  const name = id.slice(id.lastIndexOf('/') + 1)
  const words = name.replace(/[-_\s]+/g, ' ').trim()
  return words === '' ? name : words.charAt(0).toUpperCase() + words.slice(1)
}
