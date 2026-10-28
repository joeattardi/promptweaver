import { parseBody, walkNodes, type BodyNode } from './body'
import { isBuiltin } from './builtins'
import { parseFrontmatter, splitFrontmatter, type FieldDef, type Frontmatter } from './frontmatter'
import { humanizeId } from './text'
import type { Diagnostic, Range } from './types'

/** A field implied by a `{{placeholder}}` with no declaration: required text. */
export interface ImplicitField {
  id: string
  label: string
  /** The first placeholder that uses it. */
  firstRange: Range
}

export interface ParsedPrompt {
  text: string
  frontmatter: Frontmatter | null
  /** Declared fields in frontmatter order (valid, de-duplicated ids). */
  fields: FieldDef[]
  /** Undeclared, non-built-in placeholders in order of first appearance. */
  implicitFields: ImplicitField[]
  body: { range: Range; nodes: BodyNode[] }
  /** Problems found while parsing. `lint` adds the semantic rules. */
  diagnostics: Diagnostic[]
}

export function parse(text: string): ParsedPrompt {
  const split = splitFrontmatter(text)
  const diagnostics = [...split.diagnostics]

  let frontmatter: Frontmatter | null = null
  if (split.block !== null) {
    const result = parseFrontmatter(text, split.block)
    frontmatter = result.frontmatter
    diagnostics.push(...result.diagnostics)
  }
  const fields = frontmatter?.fields ?? []

  const body = parseBody(text, split.bodyStart)
  diagnostics.push(...body.diagnostics)

  const declared = new Set(fields.map((f) => f.id))
  const implicit = new Map<string, ImplicitField>()
  for (const node of walkNodes(body.nodes)) {
    if (node.kind !== 'placeholder') continue
    const { id } = node
    if (declared.has(id) || isBuiltin(id) || implicit.has(id)) continue
    implicit.set(id, { id, label: humanizeId(id), firstRange: node.range })
  }

  diagnostics.sort((a, b) => a.range.from - b.range.from)
  return {
    text,
    frontmatter,
    fields,
    implicitFields: [...implicit.values()],
    body: { range: { from: split.bodyStart, to: text.length }, nodes: body.nodes },
    diagnostics
  }
}
