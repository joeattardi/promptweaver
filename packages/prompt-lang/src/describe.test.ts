import { describe as group, expect, it } from 'vitest'
import { describe, type CursorInfo } from './describe'
import { parse } from './parse'
import { fixtureText } from './test-utils'

/** `src` with a `|` marking the cursor. */
function at(src: string): { info: CursorInfo; text: string; offset: number } {
  const offset = src.indexOf('|')
  const text = src.slice(0, offset) + src.slice(offset + 1)
  return { info: describe(parse(text), offset), text, offset }
}

const FM = `---
title: T
fields:
  lang: { type: select, options: [Go, Rust] }
  focus: { type: multiselect, options: [Bugs, Tests] }
  notes: { type: textarea }
  on: { type: toggle }
---
`
const labels = (info: CursorInfo) => info.completion?.suggestions.map((s) => s.label)

group('describe: placeholders', () => {
  it('identifies a declared field under the cursor', () => {
    const { info, text } = at(`${FM}Use {{la|ng}} here`)
    expect(info.kind).toBe('placeholder')
    if (info.kind !== 'placeholder') return
    expect(info.id).toBe('lang')
    expect(text.slice(info.range.from, info.range.to)).toBe('{{lang}}')
    expect(info.target.kind === 'field' && info.target.field.type).toBe('select')
  })

  it('identifies implicit fields and built-ins', () => {
    const implicit = at(`${FM}{{to|pic}}`).info
    expect(implicit.kind === 'placeholder' && implicit.target.kind).toBe('implicit')
    const builtin = at(`${FM}{{|date}}`).info
    expect(builtin.kind === 'placeholder' && builtin.target).toEqual({
      kind: 'builtin',
      id: 'date'
    })
  })

  it('offers field completion inside a finished placeholder, replacing the whole word', () => {
    const { info, text } = at(`${FM}{{la|ng}}`)
    expect(info.completion?.context).toBe('tag')
    const r = info.completion?.replace
    expect(r && text.slice(r.from, r.to)).toBe('lang')
  })
})

group('describe: block tags', () => {
  it('reports which part of an if tag is under the cursor', () => {
    const src = `${FM}{{if focus has Bugs}}x{{else}}y{{end}}`
    const part = (marker: string) => {
      const i = at(src.replace(marker.replace('^', ''), marker.replace('^', '|'))).info
      return i.kind === 'block-tag' ? [i.tag, i.part] : i.kind
    }
    expect(part('{{i^f')).toEqual(['if', 'keyword'])
    expect(part('if fo^cus')).toEqual(['if', 'field'])
    expect(part('focus h^as')).toEqual(['if', 'operator'])
    expect(part('has Bu^gs')).toEqual(['if', 'value'])
    expect(part('{{el^se')).toEqual(['else', 'keyword'])
    expect(part('{{en^d')).toEqual(['end', 'keyword'])
  })

  it('links tags to their block and condition target', () => {
    const { info } = at(`${FM}{{if on}}x{{e|nd}}`)
    expect(info.kind === 'block-tag' && info.node.kind).toBe('if')
    const open = at(`${FM}{{if o|n}}x{{end}}`).info
    expect(open.kind === 'block-tag' && open.target?.kind).toBe('field')
    expect(open.kind === 'block-tag' && open.condition?.id).toBe('on')
  })

  it('describes stray tags', () => {
    const { info } = at('x{{e|nd}}')
    expect(info.kind === 'block-tag' && info.node.kind).toBe('stray')
  })

  it('describes includes', () => {
    expect(at('{{> sh|ared}}').info).toMatchObject({ kind: 'include', name: 'shared' })
  })
})

group('describe: completion while typing', () => {
  it('suggests fields, built-ins and keywords right after {{', () => {
    const { info } = at(`${FM}Hello {{|`)
    expect(info.kind).toBe('text')
    expect(info.completion?.context).toBe('tag')
    expect(labels(info)).toEqual([
      'lang',
      'focus',
      'notes',
      'on',
      'date',
      'time',
      'datetime',
      'clipboard',
      'if',
      'else',
      'end'
    ])
    expect(info.completion?.replace).toEqual({ from: FM.length + 8, to: FM.length + 8 })
  })

  it('includes implicit fields with a detail', () => {
    const { info } = at(`${FM}{{topic}} {{|`)
    expect(info.completion?.suggestions.find((s) => s.label === 'topic')).toEqual({
      label: 'topic',
      kind: 'field',
      detail: 'text (undeclared)'
    })
  })

  it('replaces the partial word typed so far', () => {
    const { info, text } = at(`${FM}{{fo|`)
    const r = info.completion?.replace
    expect(r && text.slice(r.from, r.to)).toBe('fo')
  })

  it('suggests fields after {{if', () => {
    const { info } = at(`${FM}{{if |`)
    expect(info.completion?.context).toBe('if-field')
    expect(labels(info)).toContain('focus')
    expect(labels(info)).not.toContain('if')
  })

  it('suggests the operators valid for the field type', () => {
    expect(labels(at(`${FM}{{if focus |`).info)).toEqual(['has'])
    expect(labels(at(`${FM}{{if lang i|`).info)).toEqual(['is'])
    expect(labels(at(`${FM}{{if notes |`).info)).toEqual(['is'])
    expect(labels(at(`${FM}{{if on |`).info)).toEqual([])
    expect(labels(at(`${FM}{{if clipboard |`).info)).toEqual(['is'])
    expect(at(`${FM}{{if focus |`).info.completion?.fieldId).toBe('focus')
  })

  it('suggests that field’s option labels after is / has', () => {
    const { info, text } = at(`${FM}{{if lang is R|}}`)
    expect(info.completion?.context).toBe('option')
    expect(labels(info)).toEqual(['Go', 'Rust'])
    const r = info.completion?.replace
    expect(r && text.slice(r.from, r.to)).toBe('R')
    expect(labels(at(`${FM}{{if focus has |`).info)).toEqual(['Bugs', 'Tests'])
    expect(labels(at(`${FM}{{if notes is |`).info)).toEqual([])
  })

  it('offers nothing after an escape, after a closed tag, or across lines', () => {
    expect(at(`${FM}\\{{|`).info.completion).toBeUndefined()
    expect(at(`${FM}{{lang}} |`).info.completion).toBeUndefined()
    expect(at(`${FM}{{\n|`).info.completion).toBeUndefined()
    expect(at(`${FM}plain |text`).info).toEqual({ kind: 'text' })
  })
})

group('describe: frontmatter', () => {
  it('identifies top-level keys and values', () => {
    expect(at('---\nti|tle: T\n---\n').info).toMatchObject({
      kind: 'frontmatter',
      key: 'title',
      part: 'key'
    })
    expect(at('---\ntitle: T|x\n---\n').info).toMatchObject({
      kind: 'frontmatter',
      key: 'title',
      part: 'value'
    })
  })

  it('identifies the field and key under the cursor', () => {
    const src = fixtureText('code-review')
    const cursor = (needle: string, delta: number) => {
      const offset = src.indexOf(needle) + delta
      return describe(parse(src), offset)
    }
    expect(cursor('focus:', 1)).toMatchObject({
      kind: 'frontmatter',
      fieldId: 'focus',
      part: 'key'
    })
    expect(cursor('default: [Bugs', 2)).toMatchObject({
      fieldId: 'focus',
      key: 'default',
      part: 'key'
    })
    expect(cursor('Blunt:', 1)).toMatchObject({ fieldId: 'tone', key: 'options', part: 'value' })
  })

  it('suggests field types and from values', () => {
    const { info } = at('---\ntitle: T\nfields:\n  a: { type: te|xt }\n---\n{{a}}')
    expect(info).toMatchObject({ fieldId: 'a', key: 'type', part: 'value' })
    expect(labels(info)).toEqual(['text', 'textarea', 'select', 'multiselect', 'toggle', 'number'])
    expect(
      labels(at('---\ntitle: T\nfields:\n  a: { type: text, from: cl|ipboard }\n---\n').info)
    ).toEqual(['clipboard'])
  })

  it('suggests keys missing from a field definition', () => {
    const { info } = at(
      '---\ntitle: T\nfields:\n  a:\n    type: select\n    |\n    options: [A]\n---\n'
    )
    expect(info).toMatchObject({ kind: 'frontmatter', fieldId: 'a' })
    expect(labels(info)).toEqual(['label', 'help', 'required', 'default'])
  })
})
