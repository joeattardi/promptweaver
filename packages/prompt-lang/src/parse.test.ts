import { describe, expect, it } from 'vitest'
import type { BodyNode, IfNode } from './body'
import { parse } from './parse'

/** Compact, readable view of a body tree. */
function shape(nodes: BodyNode[]): unknown[] {
  return nodes.map((n) => {
    switch (n.kind) {
      case 'text':
        return n.value
      case 'placeholder':
        return { ph: n.id }
      case 'include':
        return { include: n.name }
      case 'stray':
        return { stray: n.tag }
      case 'if': {
        const c = n.condition
        const cond = c === null ? null : c.op === 'truthy' ? c.id : `${c.id} ${c.op} ${c.value}`
        const out: Record<string, unknown> = { if: cond, then: shape(n.then) }
        if (n.else) out['else'] = shape(n.otherwise)
        return out
      }
    }
  })
}

const body = (text: string) => shape(parse(text).body.nodes)
const codes = (text: string) => parse(text).diagnostics.map((d) => d.code)
const slice = (text: string, r: { from: number; to: number }) => text.slice(r.from, r.to)

describe('parse: body text and placeholders', () => {
  it('parses plain text', () => {
    expect(body('Hello world')).toEqual(['Hello world'])
    expect(codes('Hello world')).toEqual([])
  })

  it('handles an empty body and an empty file', () => {
    expect(body('')).toEqual([])
    expect(body('---\ntitle: T\n---\n')).toEqual([])
    expect(parse('').diagnostics).toEqual([])
  })

  it('parses placeholders with ranges into the full file', () => {
    const text = '---\ntitle: T\n---\nHi {{name}}!'
    const p = parse(text)
    expect(shape(p.body.nodes)).toEqual(['Hi ', { ph: 'name' }, '!'])
    const ph = p.body.nodes[1]
    expect(ph?.kind === 'placeholder' && slice(text, ph.range)).toBe('{{name}}')
    expect(ph?.kind === 'placeholder' && slice(text, ph.idRange)).toBe('name')
    expect(p.body.range.from).toBe(text.indexOf('Hi'))
  })

  it('allows whitespace inside braces', () => {
    const text = 'Hi {{  name }}'
    const ph = parse(text).body.nodes[1]
    expect(ph?.kind === 'placeholder' && slice(text, ph.idRange)).toBe('name')
  })

  it('renders \\{{ as a literal {{ and never as a tag', () => {
    expect(body('a \\{{name}} b')).toEqual(['a ', '{{', 'name}} b'])
    expect(codes('a \\{{name}} b')).toEqual([])
  })

  it('keeps invalid tags as text with a warning and an escape fix', () => {
    for (const src of ['{{}}', '{{foo bar}}', '{{a: 1}}', '{{my-field}}', '{{9x}}']) {
      const p = parse(`x ${src} y`)
      expect(shape(p.body.nodes)).toEqual([`x ${src} y`])
      expect(p.diagnostics.map((d) => [d.code, d.severity])).toEqual([['invalid-tag', 'warning']])
      expect(p.diagnostics[0]?.fixes?.[0]?.changes).toEqual([{ from: 2, to: 2, insert: '\\' }])
    }
  })

  it('keeps an unclosed {{ as text with a warning', () => {
    expect(body('a {{name')).toEqual(['a {{name'])
    expect(codes('a {{name')).toEqual(['invalid-tag'])
    // A tag cannot span lines.
    expect(body('a {{name\n}}')).toEqual(['a {{name\n}}'])
  })

  it('finds the real tag inside extra braces', () => {
    expect(body('{{{x}}}')).toEqual(['{', { ph: 'x' }, '}'])
  })

  it('recognizes reserved include syntax as its own node', () => {
    expect(body('A {{> shared/snippet}} B')).toEqual(['A ', { include: 'shared/snippet' }, ' B'])
    expect(body('{{>x}}')).toEqual([{ include: 'x' }])
  })
})

describe('parse: conditionals', () => {
  it('parses if / else / end with operators', () => {
    expect(body('{{if a}}A{{else}}B{{end}}')).toEqual([{ if: 'a', then: ['A'], else: ['B'] }])
    expect(body('{{if tone is Very Blunt }}x{{end}}')).toEqual([
      { if: 'tone is Very Blunt', then: ['x'] }
    ])
    expect(body('{{if focus has Security}}x{{end}}')).toEqual([
      { if: 'focus has Security', then: ['x'] }
    ])
  })

  it('records condition ranges', () => {
    const text = '{{if focus has Security}}x{{end}}'
    const node = parse(text).body.nodes[0] as IfNode
    const c = node.condition
    if (c === null || c.op === 'truthy') throw new Error('expected has')
    expect(slice(text, c.idRange)).toBe('focus')
    expect(slice(text, c.opRange)).toBe('has')
    expect(slice(text, c.valueRange)).toBe('Security')
    expect(slice(text, node.range)).toBe(text)
  })

  it('nests blocks and tracks depth', () => {
    const p = parse('{{if a}}{{if b}}{{if c}}{{if d}}x{{end}}{{end}}{{end}}{{end}}')
    const depths: number[] = []
    let nodes = p.body.nodes
    while (nodes[0]?.kind === 'if') {
      depths.push(nodes[0].depth)
      nodes = nodes[0].then
    }
    expect(depths).toEqual([1, 2, 3, 4])
    expect(p.diagnostics).toEqual([])
  })

  it('removes standalone tag lines entirely', () => {
    expect(body('A\n{{if a}}\nB\n{{else}}\nC\n{{end}}\nD')).toEqual([
      'A\n',
      { if: 'a', then: ['B\n'], else: ['C\n'] },
      'D'
    ])
  })

  it('treats tags indented with spaces or tabs as standalone', () => {
    expect(body('A\n  {{if a}}  \nB\n\t{{end}}\nC')).toEqual([
      'A\n',
      { if: 'a', then: ['B\n'] },
      'C'
    ])
  })

  it('keeps inline tags inline', () => {
    expect(body('Hi {{if a}}there{{end}}!\n')).toEqual(['Hi ', { if: 'a', then: ['there'] }, '!\n'])
    expect(body('{{if a}}x\n{{end}}')).toEqual([{ if: 'a', then: ['x\n'] }])
  })

  it('does not treat two tags on one line as standalone', () => {
    expect(body('{{if a}}\n{{if b}}x{{end}}{{end}}\ny')).toEqual([
      { if: 'a', then: [{ if: 'b', then: ['x'] }] },
      '\ny'
    ])
  })

  it('handles a standalone tag on the first body line and at end of file', () => {
    expect(body('---\ntitle: T\n---\n{{if a}}\nx\n{{end}}')).toEqual([{ if: 'a', then: ['x\n'] }])
  })

  it('handles Windows line endings in standalone lines', () => {
    expect(body('A\r\n{{if a}}\r\nB\r\n{{end}}\r\nC\r\n')).toEqual([
      'A\r\n',
      { if: 'a', then: ['B\r\n'] },
      'C\r\n'
    ])
  })

  it('reports an unclosed block and runs it to the end of the file', () => {
    const text = 'A {{if a}} B'
    const p = parse(text)
    expect(shape(p.body.nodes)).toEqual(['A ', { if: 'a', then: [' B'] }])
    expect(p.diagnostics.map((d) => [d.code, slice(text, d.range)])).toEqual([
      ['unclosed-block', '{{if a}}']
    ])
    expect((p.body.nodes[1] as IfNode).range.to).toBe(text.length)
  })

  it('reports stray else and end tags and keeps them as nodes', () => {
    expect(body('x{{end}}y')).toEqual(['x', { stray: 'end' }, 'y'])
    expect(codes('x{{end}}y')).toEqual(['stray-end'])
    expect(codes('{{else}}')).toEqual(['stray-else'])
    expect(body('{{if a}}1{{else}}2{{else}}3{{end}}')).toEqual([
      { if: 'a', then: ['1'], else: ['2', { stray: 'else' }, '3'] }
    ])
    expect(codes('{{if a}}1{{else}}2{{else}}3{{end}}')).toEqual(['stray-else'])
  })

  it('reports malformed block tags but keeps the structure', () => {
    for (const src of [
      '{{if}}x{{end}}',
      '{{if 9}}x{{end}}',
      '{{if a-b}}x{{end}}',
      '{{if a equals b}}x{{end}}',
      '{{if a is}}x{{end}}',
      '{{if a has   }}x{{end}}'
    ]) {
      expect(body(src)).toEqual([{ if: null, then: ['x'] }])
      expect(codes(src)).toEqual(['malformed-block-tag'])
    }
    expect(body('{{if a}}x{{else if b}}y{{end}}')).toEqual([{ if: 'a', then: ['x'], else: ['y'] }])
    expect(codes('{{if a}}x{{else if b}}y{{end}}')).toEqual(['malformed-block-tag'])
    expect(codes('{{if a}}x{{end if}}')).toEqual(['malformed-block-tag'])
  })

  it('does not mistake ids that start with a keyword for keywords', () => {
    expect(body('{{iffy}} {{ending}} {{else_x}}')).toEqual([
      { ph: 'iffy' },
      ' ',
      { ph: 'ending' },
      ' ',
      { ph: 'else_x' }
    ])
  })

  it('never re-parses: placeholder-like text in conditions values stays a value', () => {
    expect(body('{{if a is {{b}}x{{end}}')).toEqual([
      '{{if a is ',
      { ph: 'b' },
      'x',
      { stray: 'end' }
    ])
  })
})

describe('parse: implicit fields and diagnostics order', () => {
  it('collects undeclared placeholders in order of first appearance', () => {
    const p = parse('{{b}} {{a}} {{b}} {{if c}}{{d}}{{end}}')
    expect(p.implicitFields.map((f) => [f.id, f.label])).toEqual([
      ['b', 'B'],
      ['a', 'A'],
      ['d', 'D']
    ])
  })

  it('excludes declared fields and built-ins', () => {
    const p = parse(
      '---\ntitle: T\nfields:\n  a: { type: text }\n---\n{{a}} {{date}} {{clipboard}} {{topic}}'
    )
    expect(p.implicitFields.map((f) => f.id)).toEqual(['topic'])
  })

  it('works with no frontmatter at all', () => {
    const p = parse('Summarize {{topic}}')
    expect(p.frontmatter).toBeNull()
    expect(p.fields).toEqual([])
    expect(p.implicitFields.map((f) => f.id)).toEqual(['topic'])
    expect(p.diagnostics).toEqual([])
  })

  it('sorts diagnostics by position across frontmatter and body', () => {
    const text = '---\ntitle: T\nfields:\n  a: { type: nope }\n---\n{{end}}'
    expect(codes(text)).toEqual(['unknown-field-type', 'stray-end'])
  })

  it('never throws on arbitrary input', () => {
    const inputs = [
      '{{',
      '}}',
      '{{{{',
      '\\',
      '\\{{',
      '---',
      '---\n',
      '---\n---',
      '{{if',
      '{{>',
      '\r\n\r\n'
    ]
    for (const input of inputs) expect(() => parse(input)).not.toThrow()
  })
})
