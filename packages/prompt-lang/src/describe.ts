import { isMap, isScalar, type Node as YamlNode, type Pair } from 'yaml'
import { walkNodes, type Condition, type IfNode, type StrayTagNode } from './body'
import { BUILTIN_IDS, isBuiltin, type BuiltinId } from './builtins'
import { allowedFieldKeys, type FieldDef } from './frontmatter'
import type { ImplicitField, ParsedPrompt } from './parse'
import { FIELD_TYPES, type Range } from './types'

export type SuggestionKind =
  'field' | 'builtin' | 'keyword' | 'operator' | 'option' | 'key' | 'type'

export interface Suggestion {
  label: string
  kind: SuggestionKind
  /** Short extra text, e.g. the field type. */
  detail?: string
}

/**
 * What can be typed at the cursor. Suggestions are unfiltered: the editor
 * filters by what has been typed. Picking one replaces `replace`.
 */
export interface Completion {
  context: 'tag' | 'if-field' | 'operator' | 'option' | 'frontmatter-key' | 'frontmatter-value'
  replace: Range
  /** The field the suggestions belong to (operator and option contexts). */
  fieldId?: string
  suggestions: Suggestion[]
}

/** What an id in the body refers to. */
export type Target =
  | { kind: 'field'; field: FieldDef }
  | { kind: 'implicit'; field: ImplicitField }
  | { kind: 'builtin'; id: BuiltinId }
  | { kind: 'unknown'; id: string }

export type TagPart = 'keyword' | 'field' | 'operator' | 'value' | 'other'

export type CursorInfo =
  | { kind: 'placeholder'; id: string; range: Range; target: Target; completion?: Completion }
  | {
      kind: 'block-tag'
      tag: 'if' | 'else' | 'end'
      part: TagPart
      range: Range
      /** The block this tag belongs to, or the stray tag node. */
      node: IfNode | StrayTagNode
      condition: Condition | null
      target?: Target
      completion?: Completion
    }
  | { kind: 'include'; name: string; range: Range; completion?: Completion }
  | {
      kind: 'frontmatter'
      range: Range
      /** The field definition under the cursor, if any. */
      fieldId?: string
      /** The key under the cursor (top-level, or inside the field definition). */
      key?: string
      part?: 'key' | 'value'
      completion?: Completion
    }
  | { kind: 'text'; completion?: Completion }

const within = (r: Range, offset: number): boolean => offset >= r.from && offset < r.to
const touches = (r: Range, offset: number): boolean => offset >= r.from && offset <= r.to

export function targetFor(parsed: ParsedPrompt, id: string): Target {
  if (isBuiltin(id)) return { kind: 'builtin', id }
  const field = parsed.fields.find((f) => f.id === id)
  if (field) return { kind: 'field', field }
  const implicit = parsed.implicitFields.find((f) => f.id === id)
  if (implicit) return { kind: 'implicit', field: implicit }
  return { kind: 'unknown', id }
}

function idSuggestions(parsed: ParsedPrompt): Suggestion[] {
  return [
    ...parsed.fields
      .filter((f) => !isBuiltin(f.id))
      .map((f): Suggestion => ({ label: f.id, kind: 'field', detail: f.type })),
    ...parsed.implicitFields.map((f): Suggestion => ({
      label: f.id,
      kind: 'field',
      detail: 'text (undeclared)'
    })),
    ...BUILTIN_IDS.map((id): Suggestion => ({ label: id, kind: 'builtin', detail: 'built-in' }))
  ]
}

/** Operators that make sense for an id's type. */
export function operatorsFor(target: Target): ('is' | 'has')[] {
  switch (target.kind) {
    case 'builtin':
    case 'implicit':
      return ['is']
    case 'unknown':
      return ['is', 'has']
    case 'field':
      switch (target.field.type) {
        case 'select':
        case 'text':
        case 'textarea':
          return ['is']
        case 'multiselect':
          return ['has']
        case 'toggle':
        case 'number':
          return []
      }
  }
}

/**
 * Completion from the raw text, so it works while a tag is still being typed
 * (`{{if fo`) as well as inside a finished one.
 */
function completionAt(parsed: ParsedPrompt, offset: number): Completion | undefined {
  const { text } = parsed
  const lineFrom = text.lastIndexOf('\n', offset - 1) + 1
  const open = text.lastIndexOf('{{', offset - 2)
  if (open < lineFrom || open < parsed.body.range.from) return undefined
  if (text[open - 1] === '\\') return undefined
  if (text.slice(open + 2, offset).includes('}}')) return undefined

  const typed = text.slice(open + 2, offset)
  const wordEnd = (from: number): number => {
    let end = from
    while (end < text.length && /[A-Za-z0-9_]/.test(text.charAt(end))) end++
    return end
  }
  const wordRange = (prefix: string): Range => ({
    from: offset - prefix.length,
    to: wordEnd(offset)
  })

  let m = /^\s*([A-Za-z0-9_]*)$/.exec(typed)
  if (m) {
    const keywords = ['if', 'else', 'end'].map((label): Suggestion => ({ label, kind: 'keyword' }))
    return {
      context: 'tag',
      replace: wordRange(m[1] ?? ''),
      suggestions: [...idSuggestions(parsed), ...keywords]
    }
  }
  m = /^\s*if\s+([A-Za-z0-9_]*)$/.exec(typed)
  if (m)
    return {
      context: 'if-field',
      replace: wordRange(m[1] ?? ''),
      suggestions: idSuggestions(parsed)
    }

  m = /^\s*if\s+([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z]*)$/.exec(typed)
  if (m) {
    const fieldId = m[1] ?? ''
    const ops = operatorsFor(targetFor(parsed, fieldId))
    return {
      context: 'operator',
      fieldId,
      replace: wordRange(m[2] ?? ''),
      suggestions: ops.map((label): Suggestion => ({ label, kind: 'operator' }))
    }
  }

  m = /^\s*if\s+([A-Za-z][A-Za-z0-9_]*)\s+(?:is|has)\s+(.*)$/.exec(typed)
  if (m) {
    const fieldId = m[1] ?? ''
    const typedValue = m[2] ?? ''
    const close = text.indexOf('}}', offset)
    const lineEnd = text.indexOf('\n', offset)
    let to = close !== -1 && (lineEnd === -1 || close < lineEnd) ? close : offset
    while (to > offset && /\s/.test(text.charAt(to - 1))) to--
    const target = targetFor(parsed, fieldId)
    const options =
      target.kind === 'field' &&
      (target.field.type === 'select' || target.field.type === 'multiselect')
        ? target.field.options
        : []
    return {
      context: 'option',
      fieldId,
      replace: { from: offset - typedValue.length, to },
      suggestions: options.map((o): Suggestion => ({ label: o.label, kind: 'option' }))
    }
  }
  return undefined
}

function describeTag(
  parsed: ParsedPrompt,
  offset: number,
  tag: 'if' | 'else' | 'end',
  range: Range,
  node: IfNode | StrayTagNode,
  completion: Completion | undefined
): CursorInfo {
  const condition = node.kind === 'if' && tag === 'if' ? node.condition : null
  let part: TagPart = 'other'
  let target: Target | undefined
  const keywordFrom = parsed.text.indexOf(tag, range.from + 2)
  if (touches({ from: keywordFrom, to: keywordFrom + tag.length }, offset)) part = 'keyword'
  if (condition) {
    target = targetFor(parsed, condition.id)
    if (touches(condition.idRange, offset)) part = 'field'
    else if (condition.op !== 'truthy' && touches(condition.opRange, offset)) part = 'operator'
    else if (condition.op !== 'truthy' && touches(condition.valueRange, offset)) part = 'value'
  }
  const info: CursorInfo = { kind: 'block-tag', tag, part, range, node, condition }
  if (target) info.target = target
  if (completion) info.completion = completion
  return info
}

function describeFrontmatter(parsed: ParsedPrompt, offset: number): CursorInfo {
  const fm = parsed.frontmatter
  if (fm === null) return { kind: 'text' }
  const info: CursorInfo & { kind: 'frontmatter' } = { kind: 'frontmatter', range: fm.range }
  const base = fm.contentRange.from
  const rel = offset - base
  const root = fm.document.contents
  if (!isMap(root)) return info

  const hit = (n: YamlNode | null | undefined): boolean => {
    const r = n?.range
    return r != null && rel >= r[0] && rel <= r[1]
  }
  const abs = (n: YamlNode): Range => ({
    from: base + (n.range?.[0] ?? 0),
    to: base + (n.range?.[1] ?? 0)
  })

  for (const pair of root.items as Pair<YamlNode, YamlNode | null>[]) {
    const key = isScalar(pair.key) ? String(pair.key.value) : ''
    if (hit(pair.key)) return { ...info, key, part: 'key' }
    if (!hit(pair.value)) continue
    if (key !== 'fields' || !isMap(pair.value)) return { ...info, key, part: 'value' }

    for (const fieldPair of pair.value.items as Pair<YamlNode, YamlNode | null>[]) {
      const fieldId = isScalar(fieldPair.key) ? String(fieldPair.key.value) : ''
      if (hit(fieldPair.key)) return { ...info, fieldId, part: 'key' }
      if (!hit(fieldPair.value) || !isMap(fieldPair.value)) continue
      const def = parsed.fields.find((f) => f.id === fieldId)
      const present = new Set(
        (fieldPair.value.items as Pair<YamlNode, unknown>[]).map((p) =>
          isScalar(p.key) ? String(p.key.value) : ''
        )
      )
      for (const entry of fieldPair.value.items as Pair<YamlNode, YamlNode | null>[]) {
        const entryKey = isScalar(entry.key) ? String(entry.key.value) : ''
        if (hit(entry.key)) return { ...info, fieldId, key: entryKey, part: 'key' }
        if (entry.value && hit(entry.value)) {
          const result: CursorInfo = { ...info, fieldId, key: entryKey, part: 'value' }
          const values =
            entryKey === 'type' ? [...FIELD_TYPES] : entryKey === 'from' ? ['clipboard'] : []
          if (values.length > 0) {
            result.completion = {
              context: 'frontmatter-value',
              fieldId,
              replace: abs(entry.value),
              suggestions: values.map((label): Suggestion => ({ label, kind: 'type' }))
            }
          }
          return result
        }
      }
      // Inside the definition but not on a key or value: suggest missing keys.
      const keys = def ? allowedFieldKeys(def.type).filter((k) => !present.has(k)) : []
      return {
        ...info,
        fieldId,
        completion: {
          context: 'frontmatter-key',
          fieldId,
          replace: { from: offset, to: offset },
          suggestions: keys.map((label): Suggestion => ({ label, kind: 'key' }))
        }
      }
    }
    return { ...info, key }
  }
  return info
}

/** What is at `offset`: for hover, chips and completion. */
export function describe(parsed: ParsedPrompt, offset: number): CursorInfo {
  const fm = parsed.frontmatter
  if (fm && within(fm.range, offset)) return describeFrontmatter(parsed, offset)

  const completion = completionAt(parsed, offset)
  for (const node of walkNodes(parsed.body.nodes)) {
    switch (node.kind) {
      case 'placeholder':
        if (within(node.range, offset)) {
          const info: CursorInfo = {
            kind: 'placeholder',
            id: node.id,
            range: node.range,
            target: targetFor(parsed, node.id)
          }
          if (completion) info.completion = completion
          return info
        }
        break
      case 'include':
        if (within(node.range, offset))
          return { kind: 'include', name: node.name, range: node.range }
        break
      case 'stray':
        if (within(node.range, offset))
          return describeTag(parsed, offset, node.tag, node.range, node, completion)
        break
      case 'if': {
        const tags: ['if' | 'else' | 'end', Range | undefined][] = [
          ['if', node.open.range],
          ['else', node.else?.range],
          ['end', node.end?.range]
        ]
        for (const [tag, range] of tags) {
          if (range && within(range, offset))
            return describeTag(parsed, offset, tag, range, node, completion)
        }
        break
      }
      case 'text':
        break
    }
  }
  return completion ? { kind: 'text', completion } : { kind: 'text' }
}
