import { describe, expect, it } from 'vitest'
import { parseFrontmatter, splitFrontmatter, type FieldDef } from './frontmatter'
import { humanizeId } from './text'

function fm(yaml: string) {
  const text = `---\n${yaml}---\nbody`
  const split = splitFrontmatter(text)
  if (split.block === null) throw new Error('expected a frontmatter block')
  const { frontmatter, diagnostics } = parseFrontmatter(text, split.block)
  return { text, frontmatter, diagnostics, codes: diagnostics.map((d) => d.code) }
}

function field(yaml: string, id: string): FieldDef {
  const f = fm(`title: T\nfields:\n${yaml}`).frontmatter.fields.find((x) => x.id === id)
  if (!f) throw new Error(`no field ${id}`)
  return f
}

describe('splitFrontmatter', () => {
  it('splits a frontmatter block from the body', () => {
    const text = '---\ntitle: A\n---\nHello'
    const { block, bodyStart, diagnostics } = splitFrontmatter(text)
    expect(block).toEqual({ range: { from: 0, to: 17 }, content: { from: 4, to: 13 } })
    expect(text.slice(bodyStart)).toBe('Hello')
    expect(diagnostics).toEqual([])
  })

  it('treats a file without a leading --- as all body', () => {
    expect(splitFrontmatter('Summarize {{topic}}')).toEqual({
      block: null,
      bodyStart: 0,
      diagnostics: []
    })
  })

  it('handles Windows line endings', () => {
    const text = '---\r\ntitle: A\r\n---\r\nHello\r\n'
    const { block, bodyStart } = splitFrontmatter(text)
    expect(text.slice(block?.content.from, block?.content.to)).toBe('title: A\r\n')
    expect(text.slice(bodyStart)).toBe('Hello\r\n')
  })

  it('handles frontmatter only, with and without a trailing newline', () => {
    for (const text of ['---\ntitle: A\n---', '---\ntitle: A\n---\n']) {
      const { block, bodyStart } = splitFrontmatter(text)
      expect(block).not.toBeNull()
      expect(bodyStart).toBe(text.length)
    }
  })

  it('handles an empty frontmatter block', () => {
    const { block } = splitFrontmatter('---\n---\nx')
    expect(block?.content).toEqual({ from: 4, to: 4 })
  })

  it('skips a byte-order mark', () => {
    expect(splitFrontmatter('\uFEFFhello').bodyStart).toBe(1)
    expect(splitFrontmatter('\uFEFF---\ntitle: A\n---\nx').block?.range.from).toBe(1)
  })

  it('allows trailing whitespace on delimiter lines', () => {
    expect(splitFrontmatter('---  \ntitle: A\n--- \nx').block).not.toBeNull()
  })

  it('does not treat --- inside the body or a lone --- as frontmatter', () => {
    expect(splitFrontmatter('Intro\n---\ntitle: A\n---\n').block).toBeNull()
    expect(splitFrontmatter('---').block).toBeNull()
  })

  it('reports an unclosed block and treats the file as body', () => {
    const result = splitFrontmatter('---\ntitle: A\nHello')
    expect(result.block).toBeNull()
    expect(result.bodyStart).toBe(0)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['invalid-frontmatter'])
  })
})

describe('parseFrontmatter: top level', () => {
  it('parses title, description, tags, aliases and format', () => {
    const { frontmatter, diagnostics, text } = fm(
      'title: Code Review\ndescription: Review code\ntags: [code, review]\naliases: [cr, review]\nformat: 1\n'
    )
    expect(diagnostics).toEqual([])
    expect(frontmatter.title).toBe('Code Review')
    expect(frontmatter.description).toBe('Review code')
    expect(frontmatter.tags).toEqual(['code', 'review'])
    expect(frontmatter.aliases.map((a) => a.value)).toEqual(['cr', 'review'])
    const [cr] = frontmatter.aliases
    expect(cr && text.slice(cr.range.from, cr.range.to)).toBe('cr')
    expect(frontmatter.format).toBe(1)
  })

  it('requires a title when frontmatter exists', () => {
    expect(fm('description: x\n').codes).toEqual(['invalid-frontmatter'])
    expect(fm('').codes).toEqual(['invalid-frontmatter'])
    expect(fm('title: "   "\n').codes).toEqual(['invalid-frontmatter'])
  })

  it('coerces scalar titles and tags to text', () => {
    const { frontmatter, diagnostics } = fm('title: 2024\ntags: [1, true]\n')
    expect(diagnostics).toEqual([])
    expect(frontmatter.title).toBe('2024')
    expect(frontmatter.tags).toEqual(['1', 'true'])
  })

  it('rejects wrong shapes with a range on the offending value', () => {
    const { diagnostics, text } = fm('title: T\ntags: code\naliases: { a: b }\nformat: 2\n')
    expect(diagnostics.map((d) => text.slice(d.range.from, d.range.to))).toEqual([
      'code',
      '{ a: b }',
      '2'
    ])
    expect(diagnostics.every((d) => d.code === 'invalid-frontmatter')).toBe(true)
  })

  it('allows unknown top-level keys', () => {
    expect(fm('title: T\nauthor: Someone\n').diagnostics).toEqual([])
  })

  it('reports duplicate top-level keys and keeps the first', () => {
    const { frontmatter, codes } = fm('title: First\ntitle: Second\n')
    expect(codes).toEqual(['invalid-frontmatter'])
    expect(frontmatter.title).toBe('First')
  })

  it('reports YAML syntax errors without throwing', () => {
    const { codes, frontmatter } = fm('title: [unclosed\n')
    expect(codes).toContain('yaml-syntax')
    expect(frontmatter.fields).toEqual([])
  })

  it('rejects a non-map document', () => {
    expect(fm('- a\n- b\n').codes).toEqual(['invalid-frontmatter'])
  })

  it('keeps the yaml Document with comments', () => {
    const { frontmatter } = fm('# note\ntitle: T\n')
    expect(frontmatter.document.toString()).toContain('# note')
  })
})

describe('parseFrontmatter: fields', () => {
  it('parses fields in key order with source ranges', () => {
    const { frontmatter, text } = fm(
      'title: T\nfields:\n  b: { type: text }\n  a: { type: toggle }\n'
    )
    expect(frontmatter.fields.map((f) => f.id)).toEqual(['b', 'a'])
    const [b] = frontmatter.fields
    expect(b && text.slice(b.idRange.from, b.idRange.to)).toBe('b')
    expect(b && text.slice(b.range.from, b.range.to)).toBe('b: { type: text }')
  })

  it('derives labels from ids unless given', () => {
    expect(field('  code_review: { type: text }\n', 'code_review').label).toBe('Code review')
    expect(field('  x: { type: text, label: Custom }\n', 'x').label).toBe('Custom')
  })

  it('parses each field type with its keys', () => {
    expect(
      field('  t: { type: text, default: hi, from: clipboard, help: H }\n', 't')
    ).toMatchObject({
      type: 'text',
      default: 'hi',
      from: 'clipboard',
      help: 'H',
      required: false
    })
    expect(field('  t: { type: textarea, required: true }\n', 't')).toMatchObject({
      type: 'textarea',
      required: true
    })
    expect(field('  s: { type: select, options: [A, B], default: B }\n', 's')).toMatchObject({
      type: 'select',
      options: [
        { label: 'A', value: 'A' },
        { label: 'B', value: 'B' }
      ],
      default: 'B'
    })
    expect(
      field('  m: { type: multiselect, options: [A, B], default: [A], join: " / " }\n', 'm')
    ).toMatchObject({ type: 'multiselect', default: ['A'], join: ' / ' })
    expect(field('  m: { type: multiselect, options: [A] }\n', 'm')).toMatchObject({ join: ', ' })
    expect(field('  g: { type: toggle, default: true }\n', 'g')).toMatchObject({
      type: 'toggle',
      default: true
    })
    expect(field('  n: { type: number, min: 1, max: 5, default: 3 }\n', 'n')).toMatchObject({
      type: 'number',
      min: 1,
      max: 5,
      default: 3
    })
  })

  it('normalizes label-to-value option maps', () => {
    const f = field(
      '  tone:\n    type: select\n    options:\n      Gentle: Be kind.\n      Blunt: Be direct.\n      None:\n',
      'tone'
    )
    expect(f.type === 'select' && f.options.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Gentle', value: 'Be kind.' },
      { label: 'Blunt', value: 'Be direct.' },
      { label: 'None', value: '' }
    ])
  })

  it('coerces scalar options to text', () => {
    const f = field('  n: { type: select, options: [1, 2], default: 2 }\n', 'n')
    expect(f).toMatchObject({ options: [{ label: '1' }, { label: '2' }], default: '2' })
  })

  it('rejects invalid options', () => {
    expect(fm('title: T\nfields:\n  s: { type: select, options: [] }\n').codes).toEqual([
      'invalid-frontmatter'
    ])
    expect(fm('title: T\nfields:\n  s: { type: select }\n').codes).toEqual(['invalid-frontmatter'])
    expect(fm('title: T\nfields:\n  s: { type: select, options: A }\n').codes).toEqual([
      'invalid-frontmatter'
    ])
    expect(fm('title: T\nfields:\n  s: { type: select, options: [[A]] }\n').codes).toContain(
      'invalid-frontmatter'
    )
  })

  it('rejects defaults that are not among the options', () => {
    const r = fm('title: T\nfields:\n  s: { type: select, options: [A], default: Z }\n')
    expect(r.codes).toEqual(['invalid-frontmatter'])
    expect(r.frontmatter.fields[0]).not.toHaveProperty('default')
    const m = fm('title: T\nfields:\n  m: { type: multiselect, options: [A], default: [A, Z] }\n')
    expect(m.codes).toEqual(['invalid-frontmatter'])
    expect(m.frontmatter.fields[0]).toMatchObject({ default: ['A'] })
  })

  it('checks number ranges', () => {
    expect(fm('title: T\nfields:\n  n: { type: number, min: 5, max: 1 }\n').codes).toEqual([
      'invalid-frontmatter'
    ])
    expect(fm('title: T\nfields:\n  n: { type: number, max: 3, default: 9 }\n').codes).toEqual([
      'invalid-frontmatter'
    ])
  })

  it('is strict about keys per type', () => {
    const r = fm(
      'title: T\nfields:\n  a: { type: text, requred: true }\n  b: { type: text, options: [A] }\n  c: { type: select, options: [A], from: clipboard }\n'
    )
    expect(r.diagnostics.map((d) => r.text.slice(d.range.from, d.range.to))).toEqual([
      'requred',
      'options',
      'from'
    ])
  })

  it('rejects wrongly typed values and drops them', () => {
    const r = fm('title: T\nfields:\n  a: { type: text, required: yes }\n')
    expect(r.codes).toEqual(['invalid-frontmatter'])
    expect(r.frontmatter.fields[0]).toMatchObject({ required: false })
  })

  it('reports unknown field types and falls back to text', () => {
    const r = fm('title: T\nfields:\n  a: { type: dropdown, label: Pick, required: true }\n')
    expect(r.codes).toEqual(['unknown-field-type'])
    expect(r.text.slice(r.diagnostics[0]?.range.from, r.diagnostics[0]?.range.to)).toBe('dropdown')
    expect(r.frontmatter.fields[0]).toMatchObject({
      id: 'a',
      type: 'text',
      label: 'Pick',
      required: true
    })
  })

  it('reports a missing type or a non-map definition and falls back to text', () => {
    const r = fm('title: T\nfields:\n  a: { label: A }\n  b:\n  c: text\n')
    expect(r.codes).toEqual(['invalid-frontmatter', 'invalid-frontmatter', 'invalid-frontmatter'])
    expect(r.frontmatter.fields.map((f) => [f.id, f.type])).toEqual([
      ['a', 'text'],
      ['b', 'text'],
      ['c', 'text']
    ])
  })

  it('reports duplicate field ids and keeps the first', () => {
    const r = fm('title: T\nfields:\n  a: { type: text }\n  a: { type: toggle }\n')
    expect(r.codes).toEqual(['duplicate-field-id'])
    expect(r.frontmatter.fields).toHaveLength(1)
    expect(r.frontmatter.fields[0]?.type).toBe('text')
    expect(r.diagnostics[0]?.range.from).toBe(r.text.lastIndexOf('a: {'))
  })

  it('reports invalid field ids and skips them', () => {
    const r = fm(
      'title: T\nfields:\n  my-field: { type: text }\n  9x: { type: text }\n  ok: { type: text }\n'
    )
    expect(r.codes).toEqual(['invalid-field-id', 'invalid-field-id'])
    expect(r.frontmatter.fields.map((f) => f.id)).toEqual(['ok'])
  })

  it('rejects a non-map fields value', () => {
    expect(fm('title: T\nfields: [a, b]\n').codes).toEqual(['invalid-frontmatter'])
    expect(fm('title: T\nfields:\n').codes).toEqual([])
  })

  it('treats field ids as case-sensitive', () => {
    const r = fm('title: T\nfields:\n  name: { type: text }\n  Name: { type: text }\n')
    expect(r.codes).toEqual([])
    expect(r.frontmatter.fields).toHaveLength(2)
  })
})

describe('humanizeId', () => {
  it.each([
    ['code_review', 'Code review'],
    ['codeReview', 'Code review'],
    ['language', 'Language'],
    ['api_URL', 'Api URL'],
    ['x', 'X'],
    ['step2', 'Step2']
  ])('%s -> %s', (id, label) => {
    expect(humanizeId(id)).toBe(label)
  })
})
