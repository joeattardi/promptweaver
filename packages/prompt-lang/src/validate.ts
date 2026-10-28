import { formFor, type FormField } from './form'
import type { ParsedPrompt } from './parse'
import { hasContent } from './text'
import { effectiveValue, type FieldValue, type Values } from './values'

export type ValueIssueCode = 'required' | 'not-an-option' | 'out-of-range' | 'wrong-type'

export interface ValueIssue {
  fieldId: string
  code: ValueIssueCode
  message: string
}

function check(field: FormField, value: FieldValue): Omit<ValueIssue, 'fieldId'> | null {
  const name = `"${field.label}"`
  const required = { code: 'required', message: `${name} is required.` } as const
  switch (field.type) {
    case 'text':
    case 'textarea':
      return field.required && !hasContent(typeof value === 'string' ? value : '') ? required : null
    case 'select': {
      if (value === null || value === '') return field.required ? required : null
      const label = String(value)
      return field.options.some((o) => o.label === label)
        ? null
        : { code: 'not-an-option', message: `${name}: "${label}" is not one of the options.` }
    }
    case 'multiselect': {
      const labels = Array.isArray(value) ? value : []
      const unknown = labels.filter((l) => !field.options.some((o) => o.label === l))
      if (unknown.length > 0) {
        return {
          code: 'not-an-option',
          message: `${name}: ${unknown.map((u) => `"${u}"`).join(', ')} not among the options.`
        }
      }
      return field.required && labels.length === 0 ? required : null
    }
    case 'toggle':
      return null
    case 'number': {
      if (typeof value !== 'number') return field.required ? required : null
      const { min, max } = field
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        const bounds =
          min !== undefined && max !== undefined
            ? `between ${min} and ${max}`
            : min !== undefined
              ? `at least ${min}`
              : `at most ${max}`
        return { code: 'out-of-range', message: `${name} must be ${bounds}.` }
      }
      return null
    }
  }
}

/**
 * Problems that should block copying the rendered prompt, in form order, at
 * most one per field. An empty array means the prompt is ready.
 */
export function validateValues(parsed: ParsedPrompt, values: Values): ValueIssue[] {
  const issues: ValueIssue[] = []
  for (const field of formFor(parsed).fields) {
    const { value, wrongType } = effectiveValue(field, values[field.id])
    if (wrongType) {
      issues.push({
        fieldId: field.id,
        code: 'wrong-type',
        message: `"${field.label}" has a value of the wrong type.`
      })
      continue
    }
    const issue = check(field, value)
    if (issue) issues.push({ fieldId: field.id, ...issue })
  }
  return issues
}
