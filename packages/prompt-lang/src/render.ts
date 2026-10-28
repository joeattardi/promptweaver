import type { BodyNode, Condition } from './body'
import { builtinValue, isBuiltin, type RenderContext } from './builtins'
import { formFor, type FormField } from './form'
import type { ParsedPrompt } from './parse'
import { effectiveValue, fieldVariable, textVariable, type Values, type Variable } from './values'

/**
 * Renders the prompt. Pure and single-pass: substituted values are never
 * re-parsed. Missing values fall back to defaults. Built-ins come from
 * `context`; without one they render empty.
 */
export function render(parsed: ParsedPrompt, values: Values = {}, context?: RenderContext): string {
  const fields = new Map<string, FormField>(formFor(parsed).fields.map((f) => [f.id, f]))
  const cache = new Map<string, Variable | null>()

  const variable = (id: string): Variable | null => {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    let result: Variable | null = null
    if (isBuiltin(id)) {
      result = textVariable(builtinValue(id, context))
    } else {
      const field = fields.get(id)
      if (field) result = fieldVariable(field, effectiveValue(field, values[id]).value)
    }
    cache.set(id, result)
    return result
  }

  const test = (condition: Condition | null): boolean => {
    if (condition === null) return false
    // An id that is neither a field, an implicit field nor a built-in is false.
    const v = variable(condition.id)
    if (v === null) return false
    switch (condition.op) {
      case 'truthy':
        return v.truthy
      case 'is':
        return v.is(condition.value)
      case 'has':
        return v.has(condition.value)
    }
  }

  const out: string[] = []
  const emit = (nodes: readonly BodyNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'text':
          out.push(node.value)
          break
        case 'placeholder':
          out.push(variable(node.id)?.text ?? '')
          break
        case 'if':
          emit(test(node.condition) ? node.then : node.otherwise)
          break
        case 'include':
        case 'stray':
          break
      }
    }
  }
  emit(parsed.body.nodes)
  return out.join('')
}
