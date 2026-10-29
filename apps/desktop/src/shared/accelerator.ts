// Global-shortcut accelerators ("Control+Alt+Space"), shared by the hotkey
// recorder in the renderer and the validation in the main process.
// Only the subset the recorder can produce is accepted; hand-edited settings
// may use Electron's common aliases, which are normalized here.

/** Where a fresh install puts the launcher. Avoids Cmd+Space, Alt+Space, Cmd+Alt+Space and Ctrl/Cmd+Shift+P. */
export const DEFAULT_LAUNCHER_HOTKEY = 'Control+Alt+Space'

export type Modifier = 'Control' | 'Alt' | 'Shift' | 'Command' | 'Super'

/** The order modifiers are written and shown in (macOS shows them as ⌃⌥⇧⌘). */
const MODIFIER_ORDER: readonly Modifier[] = ['Control', 'Alt', 'Shift', 'Command', 'Super']

const MODIFIER_ALIASES: Readonly<Record<string, Modifier>> = {
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  command: 'Command',
  cmd: 'Command',
  super: 'Super',
  meta: 'Super'
}

const NAMED_KEYS = new Set([
  'Space',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

const PUNCTUATION = new Set(['-', '=', ',', '.', '/', ';', "'", '[', ']', '\\', '`'])

/** The key part of an accelerator in Electron's spelling, or null if it isn't supported. */
function normalizeKey(raw: string): string | null {
  if (/^[a-z]$/i.test(raw)) return raw.toUpperCase()
  if (/^[0-9]$/.test(raw)) return raw
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase()
  const named = [...NAMED_KEYS].find((k) => k.toLowerCase() === raw.toLowerCase())
  if (named !== undefined) return named
  return PUNCTUATION.has(raw) ? raw : null
}

export interface ParsedAccelerator {
  modifiers: Modifier[]
  key: string
}

/** Splits and normalizes an accelerator, or returns null if it is malformed or unsupported. */
export function parseAccelerator(text: string): ParsedAccelerator | null {
  // A literal "+" key is not supported, so "+" always separates parts.
  const parts = text.split('+').map((p) => p.trim())
  const rawKey = parts.pop()
  if (rawKey === undefined || rawKey === '' || parts.length === 0) return null
  const modifiers = new Set<Modifier>()
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier === undefined) return null
    modifiers.add(modifier)
  }
  const key = normalizeKey(rawKey)
  if (key === null) return null
  return { modifiers: MODIFIER_ORDER.filter((m) => modifiers.has(m)), key }
}

export function stringifyAccelerator(parsed: ParsedAccelerator): string {
  return [...parsed.modifiers, parsed.key].join('+')
}

export type AcceleratorCheck = { ok: true; accelerator: string } | { ok: false; reason: string }

/**
 * A global shortcut needs a real modifier: a bare key, or Shift alone, would
 * fire while typing in every app.
 */
export function checkAccelerator(text: string): AcceleratorCheck {
  const parsed = parseAccelerator(text)
  if (parsed === null) return { ok: false, reason: 'That is not a shortcut this app can use.' }
  if (parsed.modifiers.every((m) => m === 'Shift')) {
    return {
      ok: false,
      reason: 'Include Ctrl, Alt, Option or Command, so it doesn’t trigger while typing.'
    }
  }
  return { ok: true, accelerator: stringifyAccelerator(parsed) }
}

interface Clash {
  accelerator: string
  platform: string | 'any'
  message: string
}

const KNOWN_CLASHES: readonly Clash[] = [
  { accelerator: 'Command+Space', platform: 'darwin', message: 'Command+Space opens Spotlight.' },
  {
    accelerator: 'Command+Alt+Space',
    platform: 'darwin',
    message: 'Command+Option+Space opens a Finder search window.'
  },
  {
    accelerator: 'Control+Space',
    platform: 'darwin',
    message: 'Control+Space switches the keyboard input source.'
  },
  { accelerator: 'Alt+Space', platform: 'win32', message: 'Alt+Space opens the window menu.' },
  {
    accelerator: 'Control+Shift+P',
    platform: 'any',
    message: 'Many editors use this for their command palette.'
  },
  {
    accelerator: 'Command+Shift+P',
    platform: 'any',
    message: 'Many editors use this for their command palette.'
  }
]

/** A heads-up if the shortcut is one the system or common apps already use. It can still be chosen. */
export function clashWarning(accelerator: string, platform: string): string | null {
  const clash = KNOWN_CLASHES.find(
    (c) => c.accelerator === accelerator && (c.platform === 'any' || c.platform === platform)
  )
  return clash?.message ?? null
}

// --- Recording from a keyboard event ----------------------------------------

export interface KeyEventLike {
  code: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type Recording =
  /** Only modifiers are held so far; show them and keep waiting. */
  | { status: 'pending'; modifiers: Modifier[] }
  | { status: 'rejected'; reason: string }
  | { status: 'ok'; accelerator: string }

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)$/

/** The key from the physical key position, so Option+letter on macOS isn't a dead-key symbol. */
function keyFromCode(code: string): string | null {
  let match = /^Key([A-Z])$/.exec(code)
  if (match?.[1]) return match[1]
  match = /^Digit([0-9])$/.exec(code)
  if (match?.[1]) return match[1]
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const simple: Record<string, string> = {
    Space: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Backquote: '`'
  }
  return simple[code] ?? null
}

/** Turns what the user is pressing into an accelerator, for the settings key recorder. */
export function recordAccelerator(event: KeyEventLike, platform: string): Recording {
  const modifiers = new Set<Modifier>()
  if (event.ctrlKey) modifiers.add('Control')
  if (event.altKey) modifiers.add('Alt')
  if (event.shiftKey) modifiers.add('Shift')
  if (event.metaKey) modifiers.add(platform === 'darwin' ? 'Command' : 'Super')
  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m))

  if (MODIFIER_CODES.test(event.code)) return { status: 'pending', modifiers: ordered }

  const key = keyFromCode(event.code)
  if (key === null) {
    return {
      status: 'rejected',
      reason: 'That key can’t be used in a shortcut. Try a letter, number or Space.'
    }
  }
  const checked = checkAccelerator([...ordered, key].join('+'))
  return checked.ok
    ? { status: 'ok', accelerator: checked.accelerator }
    : { status: 'rejected', reason: checked.reason }
}

// --- Display -----------------------------------------------------------------

const MAC_SYMBOLS: Record<Modifier, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  Super: '❖'
}

const KEY_LABELS: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' }

/** "⌃⌥Space" on macOS, "Ctrl+Alt+Space" elsewhere. Falls back to the text as written if it can't be parsed. */
export function formatAccelerator(text: string, platform: string): string {
  const parsed = parseAccelerator(text)
  if (parsed === null) return text
  const key = KEY_LABELS[parsed.key] ?? parsed.key
  if (platform === 'darwin') return `${parsed.modifiers.map((m) => MAC_SYMBOLS[m]).join('')}${key}`
  const names: Record<Modifier, string> = {
    Control: 'Ctrl',
    Alt: 'Alt',
    Shift: 'Shift',
    Command: 'Cmd',
    Super: platform === 'win32' ? 'Win' : 'Super'
  }
  return [...parsed.modifiers.map((m) => names[m]), key].join('+')
}
