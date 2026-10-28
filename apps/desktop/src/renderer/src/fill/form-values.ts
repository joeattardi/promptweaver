import type { FieldValue, FormField, FormModel, Values } from 'prompt-lang'

/** A remembered value if it still fits the field, else undefined. */
function fitting(field: FormField, raw: FieldValue | undefined): FieldValue | undefined {
  if (raw === undefined) return undefined
  switch (field.type) {
    case 'text':
    case 'textarea':
      return typeof raw === 'string' ? raw : undefined
    case 'select':
      if (raw === null) return field.required ? null : undefined
      return typeof raw === 'string' && field.options.some((o) => o.label === raw) ? raw : undefined
    case 'multiselect':
      // Keep the choices that still exist, in the order the form lists them.
      return Array.isArray(raw)
        ? field.options.map((o) => o.label).filter((label) => raw.includes(label))
        : undefined
    case 'toggle':
      return typeof raw === 'boolean' ? raw : undefined
    case 'number':
      return raw === null || (typeof raw === 'number' && Number.isFinite(raw)) ? raw : undefined
  }
}

/**
 * What the form starts with, for every field: the clipboard for `from: clipboard`
 * fields when it has text, else the remembered answer if it still fits, else the default.
 */
export function initialValues(form: FormModel, remembered: Values, clipboard: string): Values {
  const values: Record<string, FieldValue> = {}
  for (const field of form.fields) {
    const fromClipboard =
      (field.type === 'text' || field.type === 'textarea') &&
      field.from === 'clipboard' &&
      clipboard.trim() !== ''
    values[field.id] = fromClipboard
      ? clipboard
      : (fitting(field, remembered[field.id]) ?? field.default)
  }
  return values
}

/** The value a control should show: the current one if it fits the field, else the default. */
export function shownValue(field: FormField, values: Values): FieldValue {
  return fitting(field, values[field.id]) ?? field.default
}

/**
 * Type-ahead for a list of choices: the index of the first label starting with
 * `typed` (ignoring case), looking from just after `current`. One repeated
 * letter ("g", "gg") cycles through the labels that start with it.
 */
export function typeAheadMatch(labels: readonly string[], typed: string, current: number): number {
  const needle = typed.toLowerCase()
  if (needle === '' || labels.length === 0) return -1
  const repeated = [...needle].every((c) => c === needle[0])
  const search = repeated ? (needle[0] ?? '') : needle
  const start = repeated || needle.length === 1 ? current + 1 : Math.max(current, 0)
  for (let i = 0; i < labels.length; i++) {
    const index = (start + i) % labels.length
    if (labels[index]?.toLowerCase().startsWith(search)) return index
  }
  return -1
}
