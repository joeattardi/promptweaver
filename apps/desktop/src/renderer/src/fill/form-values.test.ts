import { describe, expect, it } from 'vitest'
import { formFor, parse } from 'prompt-lang'
import { initialValues, shownValue, typeAheadMatch } from './form-values'

const form = formFor(
  parse(`---
title: T
fields:
  language: { type: select, options: [TypeScript, Python, Go] }
  pick: { type: select, required: true, options: [A, B] }
  focus: { type: multiselect, options: [Bugs, Perf, Style], default: [Bugs] }
  strict: { type: toggle }
  count: { type: number, min: 1 }
  note: { type: text, default: hi }
  code: { type: textarea, from: clipboard }
---
{{language}} {{pick}} {{focus}} {{strict}} {{count}} {{note}} {{code}} {{extra}}`)
)

describe('initialValues', () => {
  it('uses the defaults when nothing is remembered', () => {
    expect(initialValues(form, {}, '')).toEqual({
      language: 'TypeScript',
      pick: null,
      focus: ['Bugs'],
      strict: false,
      count: null,
      note: 'hi',
      code: '',
      extra: ''
    })
  })

  it('prefers remembered answers over defaults', () => {
    const values = initialValues(
      form,
      { language: 'Go', focus: ['Style', 'Bugs'], strict: true, count: 3, note: 'x', extra: 'e' },
      ''
    )
    expect(values).toMatchObject({
      language: 'Go',
      focus: ['Bugs', 'Style'],
      strict: true,
      count: 3,
      note: 'x',
      extra: 'e'
    })
  })

  it('puts clipboard text in a from-clipboard field, ahead of a remembered answer', () => {
    expect(initialValues(form, { code: 'old' }, 'new text').code).toBe('new text')
  })

  it('falls back to the remembered answer when the clipboard is empty or blank', () => {
    expect(initialValues(form, { code: 'old' }, '').code).toBe('old')
    expect(initialValues(form, {}, '  \n').code).toBe('')
  })

  it('ignores remembered answers that no longer fit', () => {
    const values = initialValues(
      form,
      { language: 'Cobol', focus: 'Bugs', strict: 'yes', count: 'a', pick: 'Z', note: 4 },
      ''
    )
    expect(values).toMatchObject({
      language: 'TypeScript',
      focus: ['Bugs'],
      strict: false,
      count: null,
      pick: null,
      note: 'hi'
    })
  })

  it('drops multiselect choices that were removed from the prompt', () => {
    expect(initialValues(form, { focus: ['Perf', 'Gone'] }, '').focus).toEqual(['Perf'])
  })

  it('remembers an explicitly unset required select', () => {
    expect(initialValues(form, { pick: null }, '').pick).toBeNull()
  })
})

describe('shownValue', () => {
  const language = form.fields[0]
  it('shows the current value, or the default when it is missing or does not fit', () => {
    if (!language) throw new Error('fixture')
    expect(shownValue(language, { language: 'Python' })).toBe('Python')
    expect(shownValue(language, {})).toBe('TypeScript')
    expect(shownValue(language, { language: 'Nope' })).toBe('TypeScript')
  })
})

describe('typeAheadMatch', () => {
  const labels = ['Gentle', 'Blunt', 'Go', 'Golang', 'Rust']
  it('finds the first label with the prefix', () => {
    expect(typeAheadMatch(labels, 'b', -1)).toBe(1)
    expect(typeAheadMatch(labels, 'RU', 0)).toBe(4)
  })
  it('moves on to the next match for a single letter typed again', () => {
    expect(typeAheadMatch(labels, 'g', 0)).toBe(2)
    expect(typeAheadMatch(labels, 'g', 2)).toBe(3)
    expect(typeAheadMatch(labels, 'g', 3)).toBe(0)
  })
  it('narrows a longer prefix starting from the current item', () => {
    expect(typeAheadMatch(labels, 'gol', 2)).toBe(3)
  })
  it('cycles on a repeated letter', () => {
    expect(typeAheadMatch(labels, 'gg', 0)).toBe(2)
  })
  it('gives -1 for no match, nothing typed, or no labels', () => {
    expect(typeAheadMatch(labels, 'z', 0)).toBe(-1)
    expect(typeAheadMatch(labels, '', 0)).toBe(-1)
    expect(typeAheadMatch([], 'a', 0)).toBe(-1)
  })
})
