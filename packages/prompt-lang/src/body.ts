import { isFieldId } from './text'
import type { Diagnostic, Range } from './types'

export type Condition =
  | { op: 'truthy'; id: string; idRange: Range }
  | {
      op: 'is' | 'has'
      id: string
      idRange: Range
      opRange: Range
      value: string
      valueRange: Range
    }

export interface BlockTag {
  /** The `{{...}}` tag itself. */
  range: Range
  /** When the tag stands alone on its line: the whole line, newline included, which is removed from output. */
  lineRange: Range | null
}

export interface TextNode {
  kind: 'text'
  /** Literal output. Differs from the source for escapes (`\{{` gives `{{`). */
  value: string
  range: Range
}

export interface PlaceholderNode {
  kind: 'placeholder'
  id: string
  range: Range
  idRange: Range
}

/** Reserved `{{> name}}` include syntax. Not supported yet; renders nothing. */
export interface IncludeNode {
  kind: 'include'
  name: string
  range: Range
}

export interface IfNode {
  kind: 'if'
  /** `null` when the `{{if ...}}` tag is malformed; the block then counts as false. */
  condition: Condition | null
  open: BlockTag
  else: BlockTag | null
  /** `null` when the block is never closed; it then runs to the end of the file. */
  end: BlockTag | null
  then: BodyNode[]
  otherwise: BodyNode[]
  /** 1 for a top-level block. */
  depth: number
  range: Range
}

/** An `{{else}}` or `{{end}}` with no matching `{{if}}`. Renders nothing. */
export interface StrayTagNode {
  kind: 'stray'
  tag: 'else' | 'end'
  block: BlockTag
  range: Range
}

export type BodyNode = TextNode | PlaceholderNode | IncludeNode | IfNode | StrayTagNode

type Token =
  | { t: 'text'; range: Range }
  | { t: 'escape'; range: Range }
  | { t: 'placeholder'; range: Range; id: string; idRange: Range }
  | { t: 'include'; range: Range; name: string }
  | { t: 'if'; range: Range; condition: Condition | null }
  | { t: 'else' | 'end'; range: Range }

type TagParse =
  { ok: true; token: Token } | { ok: false; message: string; block: boolean; token?: Token }

const ID_AT_START = /^[A-Za-z][A-Za-z0-9_]*/

/**
 * Parses what follows `{{if`. `src` starts right after the keyword and `at` is
 * its absolute offset. Returns a message when malformed.
 */
export function parseCondition(src: string, at: number): Condition | string {
  const lead = src.length - src.trimStart().length
  const idMatch = ID_AT_START.exec(src.slice(lead))
  if (idMatch === null) return 'Expected a field name, like {{if field}}.'
  const id = idMatch[0]
  const idRange = { from: at + lead, to: at + lead + id.length }
  const rest = src.slice(lead + id.length)
  if (rest.trim() === '') return { op: 'truthy', id, idRange }
  if (!/^\s/.test(rest)) return `"${id}${rest.trim()}" is not a valid field name.`

  const opLead = rest.length - rest.trimStart().length
  const opMatch = /^(is|has)(?=\s|$)/.exec(rest.slice(opLead))
  if (opMatch === null) return `Expected "is" or "has" after "${id}".`
  const op = opMatch[1] === 'is' ? 'is' : 'has'
  const opFrom = idRange.to + opLead
  const opRange = { from: opFrom, to: opFrom + op.length }

  const valueRaw = rest.slice(opLead + op.length)
  const value = valueRaw.trim()
  if (value === '') return `"${op}" needs a value, like {{if ${id} ${op} Something}}.`
  const valueFrom = opRange.to + (valueRaw.length - valueRaw.trimStart().length)
  return {
    op,
    id,
    idRange,
    opRange,
    value,
    valueRange: { from: valueFrom, to: valueFrom + value.length }
  }
}

/** Classifies the inside of a `{{...}}` tag spanning `range`. */
function parseTag(inner: string, range: Range): TagParse {
  const innerFrom = range.from + 2
  const trimmed = inner.trim()
  const lead = inner.length - inner.trimStart().length

  if (trimmed.startsWith('>')) {
    return { ok: true, token: { t: 'include', range, name: trimmed.slice(1).trim() } }
  }

  const keyword = /^(if|else|end)\b/.exec(trimmed)
  if (keyword !== null) {
    const word = keyword[1]
    const restFrom = innerFrom + lead + (word?.length ?? 0)
    const rest = inner.slice(lead + (word?.length ?? 0))
    if (word === 'if') {
      const condition = parseCondition(rest, restFrom)
      if (typeof condition === 'string') {
        return {
          ok: false,
          block: true,
          message: condition,
          token: { t: 'if', range, condition: null }
        }
      }
      return { ok: true, token: { t: 'if', range, condition } }
    }
    const t = word === 'else' ? 'else' : 'end'
    if (rest.trim() !== '') {
      return {
        ok: false,
        block: true,
        message:
          t === 'else'
            ? '{{else}} takes nothing after it. Use a nested {{if}} for else-if.'
            : '{{end}} takes nothing after it.',
        token: { t, range }
      }
    }
    return { ok: true, token: { t, range } }
  }

  if (isFieldId(trimmed)) {
    const idFrom = innerFrom + lead
    return {
      ok: true,
      token: {
        t: 'placeholder',
        range,
        id: trimmed,
        idRange: { from: idFrom, to: idFrom + trimmed.length }
      }
    }
  }

  return {
    ok: false,
    block: false,
    message: `"${preview(inner)}" is not a valid tag, so it is kept as text. Write \\{{ to keep braces literally.`
  }
}

function preview(s: string): string {
  const t = s.trim()
  return t.length > 30 ? `{{${t.slice(0, 27)}...}}` : `{{${t}}}`
}

function escapeFix(at: number): Diagnostic['fixes'] {
  return [{ title: 'Escape braces', changes: [{ from: at, to: at, insert: '\\' }] }]
}

function tokenize(source: string, from: number, diagnostics: Diagnostic[]): Token[] {
  const tokens: Token[] = []
  let textStart = from
  let i = from
  const flush = (to: number): void => {
    if (to > textStart) tokens.push({ t: 'text', range: { from: textStart, to } })
  }

  while (i < source.length) {
    if (source.startsWith('\\{{', i)) {
      flush(i)
      tokens.push({ t: 'escape', range: { from: i, to: i + 3 } })
      i += 3
      textStart = i
      continue
    }
    if (!source.startsWith('{{', i)) {
      i++
      continue
    }

    const nl = source.indexOf('\n', i)
    const lineEnd = nl === -1 ? source.length : nl
    const close = source.indexOf('}}', i + 2)
    const reopen = source.indexOf('{{', i + 1)
    if (reopen !== -1 && reopen < lineEnd && (close === -1 || reopen < close)) {
      // `{{{x}}}` or `{{ {{x}}`: the later `{{` starts the real tag.
      i++
      continue
    }
    if (close === -1 || close > lineEnd) {
      diagnostics.push({
        severity: 'warning',
        code: 'invalid-tag',
        message:
          'This {{ is never closed, so it is kept as text. Write \\{{ to keep braces literally.',
        range: { from: i, to: i + 2 },
        fixes: escapeFix(i)
      })
      i += 2
      continue
    }

    const range = { from: i, to: close + 2 }
    const parsed = parseTag(source.slice(i + 2, close), range)
    if (parsed.token !== undefined) {
      if (!parsed.ok) {
        diagnostics.push({
          severity: 'error',
          code: 'malformed-block-tag',
          message: parsed.message,
          range
        })
      }
      flush(i)
      tokens.push(parsed.token)
      textStart = range.to
    } else if (!parsed.ok) {
      diagnostics.push({
        severity: 'warning',
        code: 'invalid-tag',
        message: parsed.message,
        range,
        fixes: escapeFix(i)
      })
    }
    i = range.to
  }
  flush(source.length)
  return tokens
}

/** The line around a block tag, if the tag is alone on it (ignoring spaces and tabs). */
function standaloneLine(source: string, bodyStart: number, tag: Range): Range | null {
  let from = tag.from
  while (from > bodyStart && (source[from - 1] === ' ' || source[from - 1] === '\t')) from--
  if (from > bodyStart && source[from - 1] !== '\n') return null
  let to = tag.to
  while (to < source.length && (source[to] === ' ' || source[to] === '\t')) to++
  if (to === source.length) return { from, to }
  if (source[to] === '\n') return { from, to: to + 1 }
  if (source[to] === '\r' && source[to + 1] === '\n') return { from, to: to + 2 }
  return null
}

/** Removes `cuts` (sorted, non-overlapping) from `range`, returning what is left. */
function subtract(range: Range, cuts: Range[]): Range[] {
  const parts: Range[] = []
  let start = range.from
  for (const cut of cuts) {
    if (cut.to <= start || cut.from >= range.to) continue
    if (cut.from > start) parts.push({ from: start, to: cut.from })
    start = Math.max(start, cut.to)
  }
  if (start < range.to) parts.push({ from: start, to: range.to })
  return parts
}

/**
 * Parses the template body starting at `bodyStart`. Never throws: malformed
 * input yields a best-effort tree plus diagnostics.
 */
export function parseBody(
  source: string,
  bodyStart: number
): { nodes: BodyNode[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const tokens = tokenize(source, bodyStart, diagnostics)

  const lineRanges = new Map<Token, Range | null>()
  for (const tok of tokens) {
    if (tok.t === 'if' || tok.t === 'else' || tok.t === 'end') {
      lineRanges.set(tok, standaloneLine(source, bodyStart, tok.range))
    }
  }
  const cuts = [...lineRanges.values()].filter((r): r is Range => r !== null)
  const blockTag = (tok: Token): BlockTag => ({
    range: tok.range,
    lineRange: lineRanges.get(tok) ?? null
  })

  const root: BodyNode[] = []
  const stack: { node: IfNode; inElse: boolean }[] = []
  const current = (): BodyNode[] => {
    const top = stack[stack.length - 1]
    if (top === undefined) return root
    return top.inElse ? top.node.otherwise : top.node.then
  }
  const stray = (tag: 'else' | 'end', tok: Token, message: string): void => {
    diagnostics.push({
      severity: 'error',
      code: tag === 'else' ? 'stray-else' : 'stray-end',
      message,
      range: tok.range
    })
    current().push({ kind: 'stray', tag, block: blockTag(tok), range: tok.range })
  }

  for (const tok of tokens) {
    switch (tok.t) {
      case 'text':
        for (const part of subtract(tok.range, cuts)) {
          current().push({ kind: 'text', value: source.slice(part.from, part.to), range: part })
        }
        break
      case 'escape':
        current().push({ kind: 'text', value: '{{', range: tok.range })
        break
      case 'placeholder':
        current().push({ kind: 'placeholder', id: tok.id, range: tok.range, idRange: tok.idRange })
        break
      case 'include':
        current().push({ kind: 'include', name: tok.name, range: tok.range })
        break
      case 'if': {
        const node: IfNode = {
          kind: 'if',
          condition: tok.condition,
          open: blockTag(tok),
          else: null,
          end: null,
          then: [],
          otherwise: [],
          depth: stack.length + 1,
          range: { ...tok.range }
        }
        current().push(node)
        stack.push({ node, inElse: false })
        break
      }
      case 'else': {
        const top = stack[stack.length - 1]
        if (top === undefined) stray('else', tok, '{{else}} without a matching {{if}}.')
        else if (top.inElse) stray('else', tok, 'An {{if}} can only have one {{else}}.')
        else {
          top.node.else = blockTag(tok)
          top.inElse = true
        }
        break
      }
      case 'end': {
        const top = stack.pop()
        if (top === undefined) stray('end', tok, '{{end}} without a matching {{if}}.')
        else {
          top.node.end = blockTag(tok)
          top.node.range.to = tok.range.to
        }
        break
      }
    }
  }

  for (const { node } of stack) {
    node.range.to = source.length
    diagnostics.push({
      severity: 'error',
      code: 'unclosed-block',
      message: 'This {{if}} is never closed. Add {{end}} where the block should stop.',
      range: node.open.range
    })
  }

  return { nodes: root, diagnostics }
}

/** Every node in source order, parents before children. */
export function* walkNodes(nodes: readonly BodyNode[]): Generator<BodyNode> {
  for (const node of nodes) {
    yield node
    if (node.kind === 'if') {
      yield* walkNodes(node.then)
      yield* walkNodes(node.otherwise)
    }
  }
}
