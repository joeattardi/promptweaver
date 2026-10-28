import { isBuiltin } from './builtins'
import type { FieldDef } from './frontmatter'
import type { ParsedPrompt } from './parse'

export interface FormOption {
  label: string
  value: string
}

interface FormFieldBase {
  id: string
  label: string
  help?: string
  required: boolean
  /** True for fields implied by an undeclared `{{placeholder}}`. */
  implicit: boolean
}

/**
 * One question to ask. Plain data (safe to send over IPC). `default` is the
 * effective default: what the form starts with and what `render` uses for a
 * missing value. For selects it is an option label.
 */
export type FormField =
  | (FormFieldBase & { type: 'text' | 'textarea'; default: string; from?: 'clipboard' })
  | (FormFieldBase & { type: 'select'; options: FormOption[]; default: string | null })
  | (FormFieldBase & {
      type: 'multiselect'
      options: FormOption[]
      default: string[]
      join: string
    })
  | (FormFieldBase & { type: 'toggle'; default: boolean })
  | (FormFieldBase & { type: 'number'; default: number | null; min?: number; max?: number })

export interface FormModel {
  fields: FormField[]
}

function fromDef(def: FieldDef): FormField {
  const base: FormFieldBase = {
    id: def.id,
    label: def.label,
    required: def.required,
    implicit: false
  }
  if (def.help !== undefined) base.help = def.help
  switch (def.type) {
    case 'text':
    case 'textarea': {
      const field: FormField = { ...base, type: def.type, default: def.default ?? '' }
      if (def.from !== undefined) field.from = def.from
      return field
    }
    case 'select': {
      const options = def.options.map(({ label, value }) => ({ label, value }))
      const fallback = def.required ? null : (options[0]?.label ?? null)
      return { ...base, type: 'select', options, default: def.default ?? fallback }
    }
    case 'multiselect':
      return {
        ...base,
        type: 'multiselect',
        options: def.options.map(({ label, value }) => ({ label, value })),
        default: [...(def.default ?? [])],
        join: def.join
      }
    case 'toggle':
      return { ...base, type: 'toggle', default: def.default ?? false }
    case 'number': {
      const field: FormField = { ...base, type: 'number', default: def.default ?? null }
      if (def.min !== undefined) field.min = def.min
      if (def.max !== undefined) field.max = def.max
      return field
    }
  }
}

/**
 * The ordered questions to ask: declared fields in frontmatter order, then
 * implicit fields. Fields whose id is a built-in variable are left out, since
 * the built-in always wins.
 */
export function formFor(parsed: ParsedPrompt): FormModel {
  const declared = parsed.fields.filter((f) => !isBuiltin(f.id)).map(fromDef)
  const implicit = parsed.implicitFields.map((f): FormField => ({
    id: f.id,
    label: f.label,
    required: true,
    implicit: true,
    type: 'text',
    default: ''
  }))
  return { fields: [...declared, ...implicit] }
}
