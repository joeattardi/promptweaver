import { describe, expect, it } from 'vitest'
import { lint } from './lint'
import { parse } from './parse'
import { applyChanges, fixture } from './test-utils'
import type { Diagnostic } from './types'

const withFields = (fields: string, body: string) => `---\ntitle: T\nfields:\n${fields}---\n${body}`

function run(text: string) {
  const diagnostics = lint(parse(text))
  return {
    diagnostics,
    codes: diagnostics.map((d) => d.code),
    at: (d: Diagnostic | undefined) => (d ? text.slice(d.range.from, d.range.to) : undefined),
    fixed: (d: Diagnostic | undefined) => applyChanges(text, d?.fixes?.[0]?.changes ?? [])
  }
}

describe('lint: fixtures', () => {
  it('reports nothing for the Code Review and Email Reply fixtures except the implicit field', () => {
    expect(lint(fixture('code-review'))).toEqual([])
    expect(lint(fixture('email-reply')).map((d) => d.code)).toEqual([
      'undeclared-placeholder',
      'undeclared-placeholder'
    ])
  })
})

describe('lint: reuses parse diagnostics', () => {
  it('includes parser errors with stable codes and severities', () => {
    const { diagnostics } = run('{{if a}}x {{else}}y{{else}}z {{end}}{{end}} {{foo bar}}')
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ['undeclared-condition-field', 'info'],
      ['stray-else', 'error'],
      ['stray-end', 'error'],
      ['invalid-tag', 'warning']
    ])
  })

  it('reports unclosed blocks and unknown field types', () => {
    expect(run('{{if a}}x').codes).toContain('unclosed-block')
    expect(run(withFields('  a: { type: nope }\n', '{{a}}')).codes).toEqual(['unknown-field-type'])
  })

  it('reports invalid frontmatter and duplicate ids', () => {
    expect(run('---\ntags: x\n---\n').codes).toEqual(['invalid-frontmatter', 'invalid-frontmatter'])
    expect(run(withFields('  a: { type: text }\n  a: { type: text }\n', '{{a}}')).codes).toEqual([
      'duplicate-field-id'
    ])
  })
})

describe('lint: has-on-non-multiselect', () => {
  it('flags has on selects, text, implicit fields and built-ins', () => {
    const r = run(
      withFields(
        '  s: { type: select, options: [A] }\n  t: { type: text }\n',
        '{{if s has A}}{{end}}{{if t has A}}{{end}}{{if i has A}}{{end}}{{i}}{{if clipboard has A}}{{end}}'
      )
    )
    const hits = r.diagnostics.filter((d) => d.code === 'has-on-non-multiselect')
    expect(hits).toHaveLength(4)
    expect(hits.every((d) => r.at(d) === 'has' && d.severity === 'error')).toBe(true)
  })

  it('allows has on multiselects', () => {
    expect(
      run(withFields('  m: { type: multiselect, options: [A] }\n', '{{if m has A}}{{end}}')).codes
    ).toEqual([])
  })
})

describe('lint: unknown-option', () => {
  it('flags is values not among a select’s options, on the value', () => {
    const r = run(
      withFields('  s: { type: select, options: [Gentle, Blunt] }\n', '{{if s is Harsh}}{{end}}')
    )
    expect(r.codes).toEqual(['unknown-option'])
    expect(r.at(r.diagnostics[0])).toBe('Harsh')
    expect(r.diagnostics[0]?.message).toContain('Gentle, Blunt')
  })

  it('compares labels, not values, for label-to-value maps', () => {
    const t = withFields(
      '  s: { type: select, options: { Gentle: be kind } }\n',
      '{{if s is Gentle}}{{end}}{{if s is be kind}}{{end}}'
    )
    const r = run(t)
    expect(r.codes).toEqual(['unknown-option'])
    expect(r.at(r.diagnostics[0])).toBe('be kind')
  })

  it('also flags has values not among a multiselect’s options', () => {
    const r = run(
      withFields('  m: { type: multiselect, options: [Bugs] }\n', '{{if m has Bugz}}{{end}}')
    )
    expect(r.codes).toEqual(['unknown-option'])
  })

  it('does not check text fields or built-ins', () => {
    expect(run(withFields('  t: { type: text }\n', '{{if t is anything}}{{end}}')).codes).toEqual(
      []
    )
    expect(run('{{if date is 2026-01-01}}{{end}}').codes).toEqual([])
  })
})

describe('lint: nesting, includes, reserved ids', () => {
  it('flags nesting deeper than 3 on the offending tag', () => {
    const fields = '  a: { type: toggle }\n'
    expect(run(withFields(fields, '{{if a}}{{if a}}{{if a}}x{{end}}{{end}}{{end}}')).codes).toEqual(
      []
    )
    const text = withFields(fields, '{{if a}}{{if a}}{{if a}}{{if a}}x{{end}}{{end}}{{end}}{{end}}')
    const r = run(text)
    expect(r.codes).toEqual(['nesting-too-deep'])
    expect(r.diagnostics[0]?.range).toEqual({
      from: text.indexOf('{{if a}}x'),
      to: text.indexOf('x{{end}}')
    })
  })

  it('flags includes as unsupported', () => {
    const r = run('A {{> shared/intro}}')
    expect(r.codes).toEqual(['include-not-supported'])
    expect(r.at(r.diagnostics[0])).toBe('{{> shared/intro}}')
    expect(r.diagnostics[0]?.message).toBe('Includes are not supported yet.')
  })

  it('flags field ids that collide with built-ins', () => {
    const r = run(
      withFields('  date: { type: text }\n  clipboard: { type: text }\n', '{{date}} {{clipboard}}')
    )
    expect(r.codes).toEqual(['reserved-field-id', 'reserved-field-id'])
    expect(r.at(r.diagnostics[0])).toBe('date')
  })
})

describe('lint: warnings', () => {
  it('flags declared fields never used in the body', () => {
    const r = run(
      withFields(
        '  a: { type: text }\n  b: { type: toggle }\n  c: { type: text }\n',
        '{{a}} {{if b}}{{end}}'
      )
    )
    expect(r.codes).toEqual(['unused-field'])
    expect(r.at(r.diagnostics[0])).toBe('c')
    expect(r.diagnostics[0]?.severity).toBe('warning')
  })

  it('flags option label collisions', () => {
    const text = withFields('  s: { type: select, options: [A, B, A] }\n', '{{s}}')
    const r = run(text)
    expect(r.codes).toEqual(['option-label-collision'])
    expect(r.diagnostics[0]?.range).toEqual({
      from: text.indexOf('A]'),
      to: text.indexOf('A]') + 1
    })
    const map = run(
      withFields('  s:\n    type: select\n    options:\n      A: one\n      A: two\n', '{{s}}')
    )
    expect(map.codes).toEqual(['option-label-collision'])
  })

  it('flags duplicate aliases, case-insensitively', () => {
    const r = run('---\ntitle: T\naliases: [cr, review, CR]\n---\n')
    expect(r.codes).toEqual(['duplicate-alias'])
    expect(r.at(r.diagnostics[0])).toBe('CR')
  })
})

describe('lint: info with quick fixes', () => {
  it('reports each undeclared placeholder with a Declare field fix', () => {
    const r = run('---\ntitle: T\n---\nSummarize {{topic}} for {{topic}}.')
    expect(r.codes).toEqual(['undeclared-placeholder', 'undeclared-placeholder'])
    const d = r.diagnostics[0]
    expect(d?.severity).toBe('info')
    expect(r.at(d)).toBe('topic')
    expect(d?.fixes?.[0]?.title).toBe('Declare field "topic"')
    const fixed = r.fixed(d)
    expect(fixed).toBe(
      '---\ntitle: T\nfields:\n  topic: { type: text, required: true }\n---\nSummarize {{topic}} for {{topic}}.'
    )
    expect(lint(parse(fixed))).toEqual([])
  })

  it('creates frontmatter when declaring into a file without any', () => {
    const r = run('Summarize {{topic}}')
    const fixed = r.fixed(r.diagnostics[0])
    expect(fixed).toBe(
      '---\ntitle: Untitled prompt\nfields:\n  topic: { type: text, required: true }\n---\nSummarize {{topic}}'
    )
    expect(lint(parse(fixed))).toEqual([])
  })

  it('appends to an existing fields map, keeping its indentation', () => {
    const r = run('---\ntitle: T\nfields:\n    a: { type: text }\n---\n{{a}} {{b}}')
    expect(r.fixed(r.diagnostics[0])).toBe(
      '---\ntitle: T\nfields:\n    a: { type: text }\n    b: { type: text, required: true }\n---\n{{a}} {{b}}'
    )
  })

  it('reports condition-only ids as always false, with a fix matching the operator', () => {
    const r = run(
      '---\ntitle: T\n---\n{{if extra}}{{end}}{{if tone is Blunt}}{{end}}{{if tags has A}}{{end}}'
    )
    expect(r.codes).toEqual([
      'undeclared-condition-field',
      'undeclared-condition-field',
      'undeclared-condition-field'
    ])
    const [bare, is, has] = r.diagnostics
    expect(r.fixed(bare)).toContain('  extra: { type: toggle }\n')
    expect(r.fixed(is)).toContain('  tone: { type: select, options: [ Blunt ] }\n')
    expect(r.fixed(has)).toContain('  tags: { type: multiselect, options: [ A ] }\n')
  })

  it('offers no fix when the frontmatter YAML is broken', () => {
    const r = run('---\ntitle: [oops\n---\n{{topic}}')
    const d = r.diagnostics.find((x) => x.code === 'undeclared-placeholder')
    expect(d).toBeDefined()
    expect(d?.fixes).toBeUndefined()
  })

  it('escapes invalid tags with the fix', () => {
    const r = run('a {{foo bar}}')
    const fixed = r.fixed(r.diagnostics[0])
    expect(fixed).toBe('a \\{{foo bar}}')
    expect(lint(parse(fixed))).toEqual([])
  })
})
