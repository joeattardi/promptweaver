/** Reserved variables that resolve without a field or a question. */
export const BUILTIN_IDS = ['date', 'time', 'datetime', 'clipboard'] as const
export type BuiltinId = (typeof BUILTIN_IDS)[number]

/** Supplied by the caller so rendering stays pure and deterministic. */
export interface RenderContext {
  now: Date
  /** Clipboard text captured when the launcher was summoned. */
  clipboard: string
}

export function isBuiltin(id: string): id is BuiltinId {
  return (BUILTIN_IDS as readonly string[]).includes(id)
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Value of a built-in variable. Without a context every built-in is empty. */
export function builtinValue(id: BuiltinId, context: RenderContext | undefined): string {
  if (context === undefined) return ''
  const d = context.now
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  switch (id) {
    case 'date':
      return date
    case 'time':
      return time
    case 'datetime':
      return `${date} ${time}`
    case 'clipboard':
      return context.clipboard
  }
}
