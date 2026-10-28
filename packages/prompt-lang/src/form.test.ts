import { describe, expect, it } from 'vitest'
import { formFor } from './form'
import { parse } from './parse'
import { fixture } from './test-utils'
import { validateValues } from './validate'

const withFields = (fields: string, body = '') => `---\ntitle: T\nfields:\n${fields}---\n${body}`
const form = (text: string) => formFor(parse(text)).fields

describe('formFor', () => {
  it('builds the Code Review form in frontmatter order with effective values', () => {
    expect(formFor(fixture('code-review'))).toEqual({
      fields: [
        {
          id: 'language',
          label: 'Language',
          required: false,
          implicit: false,
          type: 'select',
          options: [
            { label: 'TypeScript', value: 'TypeScript' },
            { label: 'Python', value: 'Python' },
            { label: 'Go', value: 'Go' },
            { label: 'Rust', value: 'Rust' }
          ],
          default: 'TypeScript'
        },
        {
          id: 'focus',
          label: 'Focus',
          required: false,
          implicit: false,
          type: 'multiselect',
          options: ['Bugs', 'Performance', 'Readability', 'Security', 'Tests'].map((l) => ({
            label: l,
            value: l
          })),
          default: ['Bugs', 'Readability'],
          join: ', '
        },
        {
          id: 'tone',
          label: 'Tone',
          required: false,
          implicit: false,
          type: 'select',
          options: [
            { label: 'Gentle', value: 'Be encouraging and suggest improvements diplomatically.' },
            { label: 'Blunt', value: 'Be direct. Skip praise and list problems in priority order.' }
          ],
          default: 'Gentle'
        },
        {
          id: 'context',
          label: 'Context',
          help: 'What does this change do?',
          required: false,
          implicit: false,
          type: 'textarea',
          default: ''
        },
        {
          id: 'code',
          label: 'Code',
          required: true,
          implicit: false,
          type: 'textarea',
          default: '',
          from: 'clipboard'
        }
      ]
    })
  })

  it('appends implicit fields after declared ones and leaves built-ins out', () => {
    const fields = formFor(fixture('email-reply')).fields
    expect(fields.map((f) => [f.id, f.type, f.required, f.implicit])).toEqual([
      ['tone', 'select', false, false],
      ['decline', 'toggle', false, false],
      ['signoff', 'text', false, false],
      ['sender_name', 'text', true, true]
    ])
    expect(fields[1]?.label).toBe('Politely decline')
    expect(fields[3]?.label).toBe('Sender name')
  })

  it('handles a prompt with no frontmatter', () => {
    expect(form('Summarize {{topic}} in {{word_count}} words.')).toEqual([
      { id: 'topic', label: 'Topic', required: true, implicit: true, type: 'text', default: '' },
      {
        id: 'word_count',
        label: 'Word count',
        required: true,
        implicit: true,
        type: 'text',
        default: ''
      }
    ])
  })

  it('returns no questions for prompts without fields or placeholders', () => {
    expect(form('Just a plain prompt.')).toEqual([])
    expect(form('---\ntitle: Empty\n---\nNo questions here.')).toEqual([])
    expect(form('---\ntitle: T\n---\nToday is {{date}}. {{clipboard}}')).toEqual([])
    expect(form('')).toEqual([])
  })

  it('applies effective defaults per type', () => {
    const fields = form(
      withFields(
        '  s: { type: select, options: [A, B], required: true }\n  m: { type: multiselect, options: [A] }\n  g: { type: toggle }\n  n: { type: number, min: 1 }\n  t: { type: text, default: hi }\n'
      )
    )
    expect(fields.map((f) => [f.id, f.default])).toEqual([
      ['s', null],
      ['m', []],
      ['g', false],
      ['n', null],
      ['t', 'hi']
    ])
    expect(fields[3]).toMatchObject({ min: 1 })
    expect(fields[3]).not.toHaveProperty('max')
  })

  it('leaves out fields whose id is a built-in, and keeps fields with unknown types as text', () => {
    expect(
      form(withFields('  date: { type: text }\n  a: { type: dropdown }\n', '{{date}}{{a}}'))
    ).toEqual([
      { id: 'a', label: 'A', required: false, implicit: false, type: 'text', default: '' }
    ])
  })

  it('produces plain, serializable data', () => {
    const model = formFor(fixture('code-review'))
    expect(structuredClone(model)).toEqual(model)
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })

  it('does not share default arrays with the parse result', () => {
    const parsed = fixture('code-review')
    const focus = formFor(parsed).fields[1]
    if (focus?.type !== 'multiselect') throw new Error('expected multiselect')
    focus.default.push('Tests')
    const again = formFor(parsed).fields[1]
    expect(again?.default).toEqual(['Bugs', 'Readability'])
  })
})

describe('validateValues', () => {
  const codeReview = fixture('code-review')

  it('passes when required fields have values', () => {
    expect(validateValues(codeReview, { code: 'x' })).toEqual([])
  })

  it('reports missing required fields by label', () => {
    expect(validateValues(codeReview, {})).toEqual([
      { fieldId: 'code', code: 'required', message: '"Code" is required.' }
    ])
    expect(validateValues(codeReview, { code: '   \n' })).toHaveLength(1)
  })

  it('requires implicit fields', () => {
    const p = parse('Summarize {{topic}}')
    expect(validateValues(p, {}).map((i) => [i.fieldId, i.code])).toEqual([['topic', 'required']])
    expect(validateValues(p, { topic: 'tides' })).toEqual([])
  })

  it('passes prompts with no questions', () => {
    expect(validateValues(parse('Plain text'), {})).toEqual([])
    expect(validateValues(parse(''), {})).toEqual([])
  })

  it('checks required selects, multiselects and numbers', () => {
    const p = parse(
      withFields(
        '  s: { type: select, options: [A], required: true }\n  m: { type: multiselect, options: [A], required: true }\n  n: { type: number, required: true }\n  g: { type: toggle, required: true }\n'
      )
    )
    expect(validateValues(p, {}).map((i) => i.fieldId)).toEqual(['s', 'm', 'n'])
    expect(validateValues(p, { s: 'A', m: ['A'], n: 0 })).toEqual([])
    expect(validateValues(p, { s: null, m: [], n: null }).map((i) => i.code)).toEqual([
      'required',
      'required',
      'required'
    ])
  })

  it('reports select values that are not among the options', () => {
    expect(validateValues(codeReview, { code: 'x', tone: 'Harsh' })).toEqual([
      {
        fieldId: 'tone',
        code: 'not-an-option',
        message: '"Tone": "Harsh" is not one of the options.'
      }
    ])
    // Values are labels, not inserted text.
    expect(
      validateValues(codeReview, {
        code: 'x',
        tone: 'Be encouraging and suggest improvements diplomatically.'
      })
    ).toHaveLength(1)
    expect(validateValues(codeReview, { code: 'x', focus: ['Bugs', 'Style'] })[0]).toMatchObject({
      fieldId: 'focus',
      code: 'not-an-option'
    })
  })

  it('allows an unset optional select', () => {
    expect(validateValues(codeReview, { code: 'x', language: null })).toEqual([])
  })

  it('reports numbers out of range', () => {
    const p = parse(
      withFields(
        '  a: { type: number, min: 1, max: 5 }\n  b: { type: number, min: 0 }\n  c: { type: number, max: 3 }\n'
      )
    )
    expect(validateValues(p, { a: 3, b: 0, c: 3 })).toEqual([])
    expect(validateValues(p, { a: 6, b: -1, c: 4 }).map((i) => i.message)).toEqual([
      '"A" must be between 1 and 5.',
      '"B" must be at least 0.',
      '"C" must be at most 3.'
    ])
  })

  it('reports values of the wrong type', () => {
    const p = parse(
      withFields(
        '  a: { type: number }\n  b: { type: toggle }\n  c: { type: multiselect, options: [A] }\n'
      )
    )
    expect(validateValues(p, { a: '3', b: 'yes', c: 'A' }).map((i) => [i.fieldId, i.code])).toEqual(
      [
        ['a', 'wrong-type'],
        ['b', 'wrong-type'],
        ['c', 'wrong-type']
      ]
    )
    expect(validateValues(p, { a: Number.POSITIVE_INFINITY })[0]?.code).toBe('wrong-type')
  })

  it('ignores values for unknown ids and built-ins', () => {
    expect(validateValues(codeReview, { code: 'x', nope: 5, clipboard: 1 })).toEqual([])
  })

  it('agrees with render about defaults', () => {
    const p = parse(
      withFields('  s: { type: select, options: [A, B], required: true, default: B }\n', '{{s}}')
    )
    expect(validateValues(p, {})).toEqual([])
  })
})
