// Text edits for the editor and fields panel. Each returns TextChange[] in the
// coordinates of the original text: non-overlapping and sorted by `from`.
// Throws EditError for invalid requests (unknown field, bad id, ...).

import {
  Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  YAMLMap,
  type Node as YamlNode,
  type Pair
} from 'yaml'
import { parseCondition, walkNodes } from './body'
import { isBuiltin } from './builtins'
import { allowedFieldKeys, isFieldType } from './frontmatter'
import type { ParsedPrompt } from './parse'
import { detectEol, isFieldId, lineStart } from './text'
import type { FieldType, Range, TextChange } from './types'
import {
  absRange,
  addFieldChanges,
  EditError,
  findFieldPair,
  flowYaml,
  locateFields,
  pairLines,
  reindent
} from './yaml-edit'

export { EditError } from './yaml-edit'

/** Changes to a field definition. `undefined` leaves a key alone; `null` removes it. */
export interface FieldPatch {
  type?: FieldType
  label?: string | null
  help?: string | null
  required?: boolean | null
  default?: string | string[] | boolean | number | null
  from?: 'clipboard' | null
  options?: string[] | Record<string, string> | null
  join?: string | null
  min?: number | null
  max?: number | null
}

function sorted(changes: TextChange[]): TextChange[] {
  return changes.filter((c) => c.from !== c.to || c.insert !== '').sort((a, b) => a.from - b.from)
}

function assertInBody(parsed: ParsedPrompt, range: Range): void {
  if (
    range.from < parsed.body.range.from ||
    range.to > parsed.text.length ||
    range.from > range.to
  ) {
    throw new EditError('The selection must be inside the prompt body.')
  }
}

function assertNewId(parsed: ParsedPrompt, id: string): void {
  if (!isFieldId(id)) {
    throw new EditError(
      `"${id}" is not a valid field id. Use letters, digits and underscores, starting with a letter.`
    )
  }
  if (isBuiltin(id)) throw new EditError(`"${id}" is a built-in variable.`)
  if (parsed.fields.some((f) => f.id === id)) throw new EditError(`Field "${id}" already exists.`)
}

/** The block-style fields map and the pair for `id`, or the flow-style equivalent. */
function locateField(parsed: ParsedPrompt, id: string) {
  const loc = locateFields(parsed)
  if (loc.kind === 'block' || loc.kind === 'flow') {
    const pair = findFieldPair(loc.map, id)
    if (pair && parsed.fields.some((f) => f.id === id)) return { ...loc, pair }
  }
  throw new EditError(`Field "${id}" is not declared.`)
}

/** Replaces the selection with `{{id}}` and declares a field whose default is the selected text. */
export function makeField(parsed: ParsedPrompt, range: Range, id: string): TextChange[] {
  assertInBody(parsed, range)
  assertNewId(parsed, id)
  const selected = parsed.text.slice(range.from, range.to)
  const def: Record<string, unknown> = { type: selected.includes('\n') ? 'textarea' : 'text' }
  if (selected !== '') def['default'] = selected.replace(/\r\n/g, '\n')
  return sorted([
    ...addFieldChanges(parsed, id, def),
    { from: range.from, to: range.to, insert: `{{${id}}}` }
  ])
}

/** Renames the frontmatter key and every `{{id}}` and `{{if id ...}}` in one change set. */
export function renameField(parsed: ParsedPrompt, id: string, newId: string): TextChange[] {
  if (id === newId) return []
  assertNewId(parsed, newId)
  const changes: TextChange[] = []
  const field = parsed.fields.find((f) => f.id === id)
  if (field) changes.push({ ...field.idRange, insert: newId })
  for (const node of walkNodes(parsed.body.nodes)) {
    if (node.kind === 'placeholder' && node.id === id)
      changes.push({ ...node.idRange, insert: newId })
    if (node.kind === 'if' && node.condition?.id === id)
      changes.push({ ...node.condition.idRange, insert: newId })
  }
  if (changes.length === 0) throw new EditError(`"${id}" is not used in this prompt.`)
  return sorted(changes)
}

/** Comment lines directly above `from` (no blank line in between) within the frontmatter. */
function attachedCommentsStart(parsed: ParsedPrompt, from: number): number {
  const floor = parsed.frontmatter?.contentRange.from ?? 0
  let start = from
  while (start > floor) {
    const prev = lineStart(parsed.text, start - 1)
    if (!/^[ \t]*#/.test(parsed.text.slice(prev, start))) break
    start = prev
  }
  return start
}

/** Removes the field definition (and comment lines directly above it). Body references are left alone. */
export function removeField(parsed: ParsedPrompt, id: string): TextChange[] {
  const loc = locateField(parsed, id)
  if (loc.kind === 'block') {
    const lines = pairLines(parsed.text, loc.pair, loc.base)
    return [{ from: attachedCommentsStart(parsed, lines.from), to: lines.to, insert: '' }]
  }
  const items = loc.map.items as Pair<YamlNode, YamlNode | null>[]
  const i = items.indexOf(loc.pair)
  const start = absRange(loc.pair.key, loc.base).from
  const end = loc.pair.value
    ? absRange(loc.pair.value, loc.base).to
    : absRange(loc.pair.key, loc.base).to
  const next = items[i + 1]
  const prev = items[i - 1]
  if (next) return [{ from: start, to: absRange(next.key, loc.base).from, insert: '' }]
  if (prev) {
    const prevEnd = prev.value ? absRange(prev.value, loc.base).to : absRange(prev.key, loc.base).to
    return [{ from: prevEnd, to: end, insert: '' }]
  }
  return [{ from: start, to: end, insert: '' }]
}

/** Reorders field definitions (which sets form order). `ids` must list every declared field once. */
export function reorderFields(parsed: ParsedPrompt, ids: readonly string[]): TextChange[] {
  const declared = parsed.fields.map((f) => f.id)
  if (
    ids.length !== declared.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => declared.includes(id))
  ) {
    throw new EditError('Reorder needs every declared field exactly once.')
  }
  if (ids.every((id, i) => declared[i] === id)) return []

  const loc = locateFields(parsed)
  if (loc.kind !== 'block' && loc.kind !== 'flow')
    throw new EditError('There are no fields to reorder.')
  const { text } = parsed
  const pairs = loc.map.items as Pair<YamlNode, YamlNode | null>[]
  const byId = new Map(ids.map((id) => [id, findFieldPair(loc.map, id)]))
  const ordered = [
    ...ids.map((id) => byId.get(id)),
    ...pairs.filter((p) => ![...byId.values()].includes(p))
  ]

  if (loc.kind === 'flow') {
    const source = (p: Pair<YamlNode, YamlNode | null> | undefined): string => {
      if (!p) return ''
      const from = absRange(p.key, loc.base).from
      const to = p.value ? absRange(p.value, loc.base).to : absRange(p.key, loc.base).to
      return text.slice(from, to)
    }
    const first = pairs[0]
    const last = pairs[pairs.length - 1]
    if (!first || !last) return []
    const from = absRange(first.key, loc.base).from
    const to = last.value ? absRange(last.value, loc.base).to : absRange(last.key, loc.base).to
    return [{ from, to, insert: ordered.map(source).join(', ') }]
  }

  // Block map: move whole-line chunks verbatim. Each chunk runs from the end
  // of the previous pair to the end of its own, so leading comments and blank
  // lines travel with the field below them.
  const chunks = new Map<Pair<YamlNode, YamlNode | null>, string>()
  const firstPair = pairs[0]
  if (!firstPair) return []
  let start = attachedCommentsStart(parsed, pairLines(text, firstPair, loc.base).from)
  const regionFrom = start
  for (const pair of pairs) {
    const end = pairLines(text, pair, loc.base).to
    chunks.set(pair, text.slice(start, end))
    start = end
  }
  const insert = ordered.map((p) => (p ? (chunks.get(p) ?? '') : '')).join('')
  return [{ from: regionFrom, to: start, insert }]
}

const isScalarValue = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/** Updates keys of a field definition, preserving comments and key order. */
export function updateField(parsed: ParsedPrompt, id: string, patch: FieldPatch): TextChange[] {
  const loc = locateField(parsed, id)
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [string, unknown][]
  if (entries.length === 0) return []
  if (patch.type !== undefined && !isFieldType(patch.type))
    throw new EditError(`Unknown field type "${String(patch.type)}".`)

  const value = loc.pair.value
  const defMap = isMap(value) ? value : null

  // Fast path: only replacing existing scalar values with single-line scalars.
  // Edits just those value ranges, so nothing else in the field moves.
  if (defMap && patch.type === undefined) {
    const surgical: TextChange[] = []
    for (const [key, next] of entries) {
      const node = defMap.get(key, true) as YamlNode | undefined
      if (
        !isScalarValue(next) ||
        !isScalar(node) ||
        (typeof next === 'string' && next.includes('\n'))
      )
        break
      surgical.push({ ...absRange(node, loc.base), insert: flowYaml(next) })
    }
    if (surgical.length === entries.length) return sorted(surgical)
  }

  // General path: apply the patch to a copy of the definition, then write
  // just this field back in its existing style.
  const def = defMap ? (defMap.clone() as YAMLMap) : new YAMLMap()
  if (!defMap) def.flow = true
  const scratch = new Document()
  for (const [key, next] of entries) {
    if (next === null) {
      def.delete(key)
      continue
    }
    const node = scratch.createNode(next, { flow: def.flow || Array.isArray(next) }) as YamlNode
    const old = def.get(key, true) as YamlNode | undefined
    if (old?.comment) node.comment = old.comment
    if (old?.commentBefore) node.commentBefore = old.commentBefore
    def.set(key, node)
  }
  if (patch.type !== undefined) {
    const allowed = new Set(allowedFieldKeys(patch.type))
    for (const item of [...def.items] as Pair<YamlNode, unknown>[]) {
      const key = isScalar(item.key) ? String(item.key.value) : ''
      if (!allowed.has(key) || (key === 'default' && patch.default === undefined)) def.delete(key)
    }
  }

  const { text } = parsed
  if (def.flow) {
    // Flow definitions are written by hand: unchanged children keep their
    // exact source text, so only the patched keys change.
    const original = value
      ? text.slice(absRange(value, loc.base).from, absRange(value, loc.base).to)
      : ''
    const insert = flowText(def, { text, base: loc.base, padded: !/^\{[^ }]/.test(original) })
    if (value && !(isScalar(value) && value.value === null))
      return [{ ...absRange(value, loc.base), insert }]
    const at = absRange(loc.pair.key, loc.base).to
    const colon = text.indexOf(':', at)
    return [
      {
        from: colon + 1,
        to: value ? absRange(value, loc.base).to : colon + 1,
        insert: ` ${insert}`
      }
    ]
  }

  // Block definitions go through the yaml serializer, which keeps comments.
  // (A block definition can't sit inside a flow-style fields map.)
  if (loc.kind !== 'block') throw new EditError('Unexpected block definition in a flow map.')
  const eol = detectEol(text)
  const source = text.slice(
    absRange(loc.pair.key, loc.base).from,
    value ? absRange(value, loc.base).to : undefined
  )
  const options = { lineWidth: 0, flowCollectionPadding: /\[ /.test(source) }
  const lines = pairLines(text, loc.pair, loc.base)
  const pad = ' '.repeat(loc.indent)
  const map = new YAMLMap()
  map.set(scratch.createNode(id), def)
  const out = new Document(map).toString({ ...options, indent: Math.max(loc.indent, 2) })
  return [{ ...lines, insert: reindent(out, pad, eol) }]
}

interface FlowContext {
  text: string
  base: number
  /** `{ a: 1 }` rather than `{a: 1}`. Sequences are written `[a, b]`. */
  padded: boolean
}

/** Single-line flow YAML for a definition. Nodes still carrying a source range are copied verbatim. */
function flowText(node: unknown, ctx: FlowContext, top = true): string {
  if (!top && isNode(node) && node.range) {
    return ctx.text.slice(ctx.base + node.range[0], ctx.base + node.range[1])
  }
  if (isMap(node)) {
    const inner = (node.items as Pair<unknown, unknown>[])
      .map((p) => `${flowText(p.key, ctx, false)}: ${flowText(p.value, ctx, false)}`)
      .join(', ')
    if (inner === '') return '{}'
    return ctx.padded ? `{ ${inner} }` : `{${inner}}`
  }
  if (isSeq(node)) return `[${node.items.map((i) => flowText(i, ctx, false)).join(', ')}]`
  if (isScalar(node)) return flowYaml(node.value)
  return flowYaml(node ?? null)
}

/** Wraps a body range in `{{if condition}}` / `{{end}}`; on their own lines when the range is whole lines. */
export function wrapIf(parsed: ParsedPrompt, range: Range, condition: string): TextChange[] {
  assertInBody(parsed, range)
  const parsedCondition = parseCondition(` ${condition}`, 0)
  if (typeof parsedCondition === 'string') throw new EditError(parsedCondition)
  const { text } = parsed
  const eol = detectEol(text)
  const open = `{{if ${condition.trim()}}}`
  const close = '{{end}}'

  const startsLine = range.from === lineStart(text, range.from)
  const endsAtLineStart = range.to > range.from && text[range.to - 1] === '\n'
  const endsAtLineEnd =
    range.to === text.length || text.startsWith('\n', range.to) || text.startsWith('\r\n', range.to)

  if (startsLine && endsAtLineStart) {
    return sorted([
      { from: range.from, to: range.from, insert: open + eol },
      { from: range.to, to: range.to, insert: close + eol }
    ])
  }
  if (startsLine && endsAtLineEnd && range.to > range.from) {
    return sorted([
      { from: range.from, to: range.from, insert: open + eol },
      { from: range.to, to: range.to, insert: eol + close }
    ])
  }
  return sorted([
    { from: range.from, to: range.from, insert: open },
    { from: range.to, to: range.to, insert: close }
  ])
}
