const FIELD_ID = /^[A-Za-z][A-Za-z0-9_]*$/

/** Field ids: letters, digits, underscore, starting with a letter. */
export function isFieldId(id: string): boolean {
  return FIELD_ID.test(id)
}

/**
 * Default label for a field id: `code_review` and `codeReview` become
 * "Code review". All-caps words (`URL`) keep their case.
 */
export function humanizeId(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .filter((w) => w !== '')
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
  const label = words.join(' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** True when the string contains anything other than whitespace. */
export function hasContent(s: string): boolean {
  return /\S/.test(s)
}

/** The file's dominant line ending, used when inserting new lines. */
export function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** Offset of the start of the line containing `offset`. */
export function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1
}

/** Offset just past the newline ending the line containing `offset` (or text length). */
export function nextLineStart(text: string, offset: number): number {
  const nl = text.indexOf('\n', offset)
  return nl === -1 ? text.length : nl + 1
}
