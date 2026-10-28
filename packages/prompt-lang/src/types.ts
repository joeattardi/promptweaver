/** Half-open character range `[from, to)` into the full file text. */
export interface Range {
  from: number
  to: number
}

/** A single text replacement against the full file text. */
export interface TextChange {
  from: number
  to: number
  insert: string
}

export type Severity = 'error' | 'warning' | 'info'

export type DiagnosticCode =
  // Frontmatter
  | 'yaml-syntax'
  | 'invalid-frontmatter'
  | 'unknown-field-type'
  | 'invalid-field-id'
  | 'duplicate-field-id'
  | 'reserved-field-id'
  | 'unused-field'
  | 'option-label-collision'
  | 'duplicate-alias'
  // Body
  | 'invalid-tag'
  | 'malformed-block-tag'
  | 'unclosed-block'
  | 'stray-else'
  | 'stray-end'
  | 'nesting-too-deep'
  | 'include-not-supported'
  | 'has-on-non-multiselect'
  | 'unknown-option'
  | 'undeclared-placeholder'
  | 'undeclared-condition-field'

export interface QuickFix {
  title: string
  changes: TextChange[]
}

export interface Diagnostic {
  severity: Severity
  code: DiagnosticCode
  message: string
  range: Range
  fixes?: QuickFix[]
}

export const FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'multiselect',
  'toggle',
  'number'
] as const
export type FieldType = (typeof FIELD_TYPES)[number]
