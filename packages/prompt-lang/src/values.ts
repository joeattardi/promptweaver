import type { FormField } from './form'
import { hasContent } from './text'

/**
 * A value supplied for a field. text/textarea: string. select: option label or
 * null (unset). multiselect: option labels. toggle: boolean. number: number or
 * null (unset).
 */
export type FieldValue = string | string[] | boolean | number | null

/** Values keyed by field id. A missing key means "use the default". */
export type Values = Readonly<Record<string, FieldValue | undefined>>

function hasExpectedType(field: FormField, raw: FieldValue): boolean {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return typeof raw === 'string'
    case 'select':
      return raw === null || typeof raw === 'string'
    case 'multiselect':
      return Array.isArray(raw) && raw.every((v) => typeof v === 'string')
    case 'toggle':
      return typeof raw === 'boolean'
    case 'number':
      return raw === null || (typeof raw === 'number' && Number.isFinite(raw))
  }
}

/**
 * The value to use for a field: the supplied one, or the default when it is
 * missing or of the wrong type (`wrongType` reports the latter).
 */
export function effectiveValue(
  field: FormField,
  raw: FieldValue | undefined
): { value: FieldValue; wrongType: boolean } {
  if (raw === undefined) return { value: field.default, wrongType: false }
  if (hasExpectedType(field, raw)) return { value: raw, wrongType: false }
  return { value: field.default, wrongType: true }
}

/** How a variable behaves in placeholders and conditions. */
export interface Variable {
  text: string
  truthy: boolean
  is(value: string): boolean
  has(value: string): boolean
}

export function textVariable(text: string): Variable {
  return {
    text,
    truthy: hasContent(text),
    is: (v) => text.trim() === v,
    has: () => false
  }
}

const asString = (v: FieldValue): string => (typeof v === 'string' ? v : '')
const asLabels = (v: FieldValue): string[] => (Array.isArray(v) ? v : [])

/** Placeholder output and condition semantics for a field holding `value`. */
export function fieldVariable(field: FormField, value: FieldValue): Variable {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return textVariable(asString(value))
    case 'select': {
      const label = typeof value === 'string' ? value : null
      const option = field.options.find((o) => o.label === label)
      return {
        text: option?.value ?? '',
        truthy: option !== undefined,
        is: (v) => label === v,
        has: () => false
      }
    }
    case 'multiselect': {
      const labels = asLabels(value)
      // Rendered in option order; unknown labels are ignored.
      const selected = field.options.filter((o) => labels.includes(o.label))
      return {
        text: selected.map((o) => o.value).join(field.join),
        truthy: selected.length > 0,
        is: (v) => selected.length === 1 && selected[0]?.label === v,
        has: (v) => selected.some((o) => o.label === v)
      }
    }
    case 'toggle': {
      const on = value === true
      return {
        text: on ? 'yes' : 'no',
        truthy: on,
        is: (v) => v === (on ? 'yes' : 'no'),
        has: () => false
      }
    }
    case 'number': {
      const n = typeof value === 'number' ? value : null
      return {
        text: n === null ? '' : String(n),
        truthy: n !== null,
        is: (v) => n !== null && v.trim() !== '' && Number(v) === n,
        has: () => false
      }
    }
  }
}
