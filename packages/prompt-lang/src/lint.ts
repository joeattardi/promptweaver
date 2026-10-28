import { walkNodes, type Condition } from './body'
import { isBuiltin } from './builtins'
import type { FieldDef } from './frontmatter'
import type { ParsedPrompt } from './parse'
import type { Diagnostic, QuickFix } from './types'
import { addFieldChanges, EditError } from './yaml-edit'

export const MAX_NESTING = 3

function declareFix(
  parsed: ParsedPrompt,
  id: string,
  def: Record<string, unknown>
): QuickFix[] | undefined {
  try {
    return [{ title: `Declare field "${id}"`, changes: addFieldChanges(parsed, id, def) }]
  } catch (e) {
    if (e instanceof EditError) return undefined
    throw e
  }
}

/** Field definition that makes a condition-only id meaningful. */
function definitionForCondition(c: Condition): Record<string, unknown> {
  switch (c.op) {
    case 'truthy':
      return { type: 'toggle' }
    case 'is':
      return { type: 'select', options: [c.value] }
    case 'has':
      return { type: 'multiselect', options: [c.value] }
  }
}

function describeTarget(id: string, field: FieldDef | undefined): string {
  if (isBuiltin(id)) return `"${id}" is a built-in variable`
  if (field === undefined) return `"${id}" is an undeclared text field`
  return `"${id}" is a ${field.type} field`
}

/**
 * All diagnostics for a prompt: the parser's, plus the semantic rules. Uses
 * the same parse result as `render`, so what is flagged matches what renders.
 */
export function lint(parsed: ParsedPrompt): Diagnostic[] {
  const out: Diagnostic[] = [...parsed.diagnostics]
  const fields = new Map(parsed.fields.map((f) => [f.id, f]))
  const used = new Set<string>()

  for (const node of walkNodes(parsed.body.nodes)) {
    if (node.kind === 'placeholder') {
      used.add(node.id)
      if (!fields.has(node.id) && !isBuiltin(node.id)) {
        const fixes = declareFix(parsed, node.id, { type: 'text', required: true })
        out.push({
          severity: 'info',
          code: 'undeclared-placeholder',
          message: `"${node.id}" is not declared, so it is asked as a required text field.`,
          range: node.idRange,
          ...(fixes && { fixes })
        })
      }
    } else if (node.kind === 'include') {
      out.push({
        severity: 'error',
        code: 'include-not-supported',
        message: 'Includes are not supported yet.',
        range: node.range
      })
    } else if (node.kind === 'if') {
      if (node.depth > MAX_NESTING) {
        out.push({
          severity: 'error',
          code: 'nesting-too-deep',
          message: `Conditionals can be nested at most ${MAX_NESTING} levels deep.`,
          range: node.open.range
        })
      }
      const c = node.condition
      if (c === null) continue
      used.add(c.id)
      const field = fields.get(c.id)
      const known =
        field !== undefined || isBuiltin(c.id) || parsed.implicitFields.some((f) => f.id === c.id)
      if (!known) {
        const fixes = declareFix(parsed, c.id, definitionForCondition(c))
        out.push({
          severity: 'info',
          code: 'undeclared-condition-field',
          message: `"${c.id}" is not a field, so this condition is always false.`,
          range: c.idRange,
          ...(fixes && { fixes })
        })
        continue
      }
      if (c.op === 'truthy') continue
      const builtinWins = isBuiltin(c.id)
      if (c.op === 'has' && (builtinWins || field?.type !== 'multiselect')) {
        out.push({
          severity: 'error',
          code: 'has-on-non-multiselect',
          message: `"has" only works with multiselect fields; ${describeTarget(c.id, builtinWins ? undefined : field)}. Use "is" instead.`,
          range: c.opRange
        })
        continue
      }
      const options =
        !builtinWins && (field?.type === 'select' || field?.type === 'multiselect')
          ? field.options
          : []
      if (options.length > 0 && !options.some((o) => o.label === c.value)) {
        out.push({
          severity: 'error',
          code: 'unknown-option',
          message: `"${c.value}" is not an option of "${c.id}". Options: ${options.map((o) => o.label).join(', ')}.`,
          range: c.valueRange
        })
      }
    }
  }

  for (const field of parsed.fields) {
    if (isBuiltin(field.id)) {
      out.push({
        severity: 'error',
        code: 'reserved-field-id',
        message: `"${field.id}" is a built-in variable and can't be used as a field id.`,
        range: field.idRange
      })
    } else if (!used.has(field.id)) {
      out.push({
        severity: 'warning',
        code: 'unused-field',
        message: `Field "${field.id}" is never used in the prompt.`,
        range: field.idRange
      })
    }
    if (field.type === 'select' || field.type === 'multiselect') {
      const seen = new Set<string>()
      for (const option of field.options) {
        if (seen.has(option.label)) {
          out.push({
            severity: 'warning',
            code: 'option-label-collision',
            message: `Option "${option.label}" appears more than once in "${field.id}".`,
            range: option.labelRange
          })
        }
        seen.add(option.label)
      }
    }
  }

  const aliases = new Set<string>()
  for (const alias of parsed.frontmatter?.aliases ?? []) {
    const key = alias.value.toLowerCase()
    if (aliases.has(key)) {
      out.push({
        severity: 'warning',
        code: 'duplicate-alias',
        message: `Alias "${alias.value}" is listed more than once.`,
        range: alias.range
      })
    }
    aliases.add(key)
  }

  return out.sort((a, b) => a.range.from - b.range.from)
}
