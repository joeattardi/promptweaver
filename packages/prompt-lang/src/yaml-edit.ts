// Low-level, formatting-preserving text surgery on the frontmatter. Untouched
// parts of the file are never re-serialized, so comments, key order, quoting
// and spacing elsewhere survive every edit.

import {
  Document,
  isCollection,
  isMap,
  isScalar,
  type Node as YamlNode,
  type Pair,
  type YAMLMap
} from 'yaml'
import type { ParsedPrompt } from './parse'
import { detectEol, lineStart, nextLineStart } from './text'
import type { Range, TextChange } from './types'

export class EditError extends Error {
  override name = 'EditError'
}

/** Title written when an edit has to create frontmatter from scratch. */
export const NEW_PROMPT_TITLE = 'Untitled prompt'

const SERIALIZE = { lineWidth: 0, flowCollectionPadding: true } as const
const MAX_FLOW_LENGTH = 80

export type FieldsLocation =
  | { kind: 'no-frontmatter' }
  | {
      kind: 'no-fields'
      base: number
      root: YAMLMap | null
      fieldsPair: Pair<YamlNode, YamlNode | null> | null
    }
  | { kind: 'block'; base: number; map: YAMLMap; indent: number }
  | { kind: 'flow'; base: number; map: YAMLMap }

/** Where the `fields` map lives, or why there isn't one. Throws if the frontmatter can't be edited safely. */
export function locateFields(parsed: ParsedPrompt): FieldsLocation {
  const fm = parsed.frontmatter
  if (fm === null) return { kind: 'no-frontmatter' }
  const doc = fm.document
  if (doc.errors.length > 0) throw new EditError('Fix the frontmatter YAML errors first.')
  const base = fm.contentRange.from
  const root = doc.contents
  if (root === null) return { kind: 'no-fields', base, root: null, fieldsPair: null }
  if (!isMap(root)) throw new EditError('The frontmatter is not a set of key: value pairs.')

  const fieldsPair = (root.items as Pair<YamlNode, YamlNode | null>[]).find(
    (p) => isScalar(p.key) && p.key.value === 'fields'
  )
  const value = fieldsPair?.value ?? null
  if (fieldsPair === undefined || value === null || (isScalar(value) && value.value === null)) {
    return { kind: 'no-fields', base, root, fieldsPair: fieldsPair ?? null }
  }
  if (!isMap(value)) throw new EditError('"fields" is not a map of field definitions.')
  if (value.flow) return { kind: 'flow', base, map: value }
  const first = value.items[0]?.key as YamlNode | undefined
  const firstFrom = first?.range?.[0]
  const indent =
    firstFrom === undefined ? 2 : base + firstFrom - lineStart(parsed.text, base + firstFrom)
  return { kind: 'block', base, map: value, indent }
}

export function absRange(node: YamlNode, base: number): Range {
  const r = node.range
  if (!r) throw new EditError('Missing source position in frontmatter.')
  return { from: base + r[0], to: base + r[1] }
}

/** Whole lines occupied by a block-map pair, from its key line to the end of its value. */
export function pairLines(
  text: string,
  pair: Pair<YamlNode, YamlNode | null>,
  base: number
): Range {
  const key = absRange(pair.key, base)
  const end = pair.value?.range ? base + pair.value.range[1] : key.to
  const to = end > 0 && text[end - 1] === '\n' ? end : nextLineStart(text, end)
  return { from: lineStart(text, key.from), to }
}

/** The pair for a field id in the fields map, if present. */
export function findFieldPair(
  map: YAMLMap,
  id: string
): Pair<YamlNode, YamlNode | null> | undefined {
  return (map.items as Pair<YamlNode, YamlNode | null>[]).find(
    (p) => isScalar(p.key) && String(p.key.value) === id
  )
}

/** A value as single-line flow YAML, e.g. `{ type: text, required: true }`. */
export function flowYaml(value: unknown): string {
  const doc = new Document(value)
  if (isCollection(doc.contents)) doc.contents.flow = true
  return doc.toString(SERIALIZE).trimEnd()
}

/** `id: definition` lines for a block map at `indent`, using flow style when it stays short. */
export function fieldEntry(
  id: string,
  def: Record<string, unknown>,
  indent: number,
  eol: string
): string {
  const pad = ' '.repeat(indent)
  const flow = `${id}: ${flowYaml(def)}`
  const multiline = Object.values(def).some((v) => typeof v === 'string' && v.includes('\n'))
  if (!multiline && flow.length + indent <= MAX_FLOW_LENGTH) return pad + flow + eol
  const block = new Document({ [id]: def }).toString({ ...SERIALIZE, indent: Math.max(indent, 2) })
  return reindent(block, pad, eol)
}

/** Prefixes non-empty lines with `pad` and converts line endings. */
export function reindent(yamlText: string, pad: string, eol: string): string {
  return yamlText
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join(eol)
    .concat(eol)
}

/** Changes that append a new field definition at the end of the fields map, creating it if needed. */
export function addFieldChanges(
  parsed: ParsedPrompt,
  id: string,
  def: Record<string, unknown>
): TextChange[] {
  const { text } = parsed
  const eol = detectEol(text)
  const loc = locateFields(parsed)
  switch (loc.kind) {
    case 'no-frontmatter': {
      const at = text.startsWith('﻿') ? 1 : 0
      const header = `---${eol}title: ${NEW_PROMPT_TITLE}${eol}fields:${eol}${fieldEntry(id, def, 2, eol)}---${eol}`
      return [{ from: at, to: at, insert: header }]
    }
    case 'no-fields': {
      const entry = fieldEntry(id, def, 2, eol)
      if (loc.fieldsPair !== null) {
        // `fields:` with an empty or null value: put the map right under it.
        const key = absRange(loc.fieldsPair.key, loc.base)
        const lineEnd = nextLineStart(text, key.to)
        const eolLength = text.slice(0, lineEnd).endsWith('\r\n')
          ? 2
          : text[lineEnd - 1] === '\n'
            ? 1
            : 0
        return [
          { from: key.to, to: lineEnd - eolLength, insert: `:${eol}${entry.slice(0, -eol.length)}` }
        ]
      }
      const contentTo = parsed.frontmatter?.contentRange.to ?? loc.base
      return [{ from: contentTo, to: contentTo, insert: `fields:${eol}${entry}` }]
    }
    case 'block': {
      const last = loc.map.items[loc.map.items.length - 1] as
        Pair<YamlNode, YamlNode | null> | undefined
      const at = last ? pairLines(text, last, loc.base).to : absRange(loc.map, loc.base).to
      return [{ from: at, to: at, insert: fieldEntry(id, def, loc.indent, eol) }]
    }
    case 'flow': {
      const last = loc.map.items[loc.map.items.length - 1] as
        Pair<YamlNode, YamlNode | null> | undefined
      const entry = `${id}: ${flowYaml(def)}`
      if (last?.value) {
        const at = absRange(last.value, loc.base).to
        return [{ from: at, to: at, insert: `, ${entry}` }]
      }
      const at = absRange(loc.map, loc.base).from + 1
      return [{ from: at, to: at, insert: entry }]
    }
  }
}
