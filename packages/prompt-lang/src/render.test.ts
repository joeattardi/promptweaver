import { describe, expect, it } from 'vitest'
import type { RenderContext } from './builtins'
import { parse } from './parse'
import { render } from './render'
import { fixture } from './test-utils'
import type { Values } from './values'

// Local time, so the expected strings hold in every time zone.
const context: RenderContext = {
  now: new Date(2026, 2, 5, 9, 7),
  clipboard: 'Hi, can we meet Friday?'
}

const r = (text: string, values: Values = {}, ctx: RenderContext | undefined = context) =>
  render(parse(text), values, ctx)

const withFields = (fields: string, body: string) => `---\ntitle: T\nfields:\n${fields}---\n${body}`

describe('render: Code Review fixture (golden)', () => {
  const parsed = fixture('code-review')

  it('has no diagnostics', () => {
    expect(parsed.diagnostics).toEqual([])
  })

  it('renders defaults with only the required code', () => {
    expect(render(parsed, { code: 'func main() {}' })).toBe(
      `You are a senior TypeScript engineer reviewing a pull request.

Focus on: Bugs, Readability.
Be encouraging and suggest improvements diplomatically.


## Code
func main() {}

`
    )
  })

  it('renders every block when all values are set', () => {
    expect(
      render(parsed, {
        language: 'Go',
        focus: ['Security', 'Bugs'],
        tone: 'Blunt',
        context: 'Adds login rate limiting.',
        code: 'if attempts > 5 { block() }'
      })
    ).toBe(
      `You are a senior Go engineer reviewing a pull request.

Focus on: Bugs, Security.
Be direct. Skip praise and list problems in priority order.

## Context
Adds login rate limiting.

## Code
if attempts > 5 { block() }

Flag anything that touches user input, auth, or secrets.
`
    )
  })

  it('drops the focus block for an empty multiselect', () => {
    expect(render(parsed, { language: 'Rust', focus: [], code: 'x' })).toBe(
      `You are a senior Rust engineer reviewing a pull request.

Be encouraging and suggest improvements diplomatically.


## Code
x

`
    )
  })

  it('passes pasted code containing {{ through untouched', () => {
    const code = 'const t = `{{name}}`\n{{if x}}{{end}} \\{{ {{> y}}'
    const out = render(parsed, { code, context: '{{tone}}' })
    expect(out).toContain(`## Code\n${code}\n`)
    expect(out).toContain('## Context\n{{tone}}\n')
  })
})

describe('render: Email Reply fixture (golden)', () => {
  const parsed = fixture('email-reply')

  it('declares tone, decline and signoff, with sender_name implicit', () => {
    expect(parsed.fields.map((f) => f.id)).toEqual(['tone', 'decline', 'signoff'])
    expect(parsed.implicitFields.map((f) => f.id)).toEqual(['sender_name'])
    expect(parsed.diagnostics).toEqual([])
  })

  it('renders defaults with the clipboard and today’s date', () => {
    expect(render(parsed, { sender_name: 'Sam' }, context)).toBe(
      `Today is 2026-03-05. Draft a reply to the email below for Sam.

Write in a warm, friendly tone.
Agree to the request and confirm the next steps.

Sign off with "Best, Sam".

## Email
Hi, can we meet Friday?
`
    )
  })

  it('renders the declining, formal branch without a clipboard', () => {
    expect(
      render(
        parsed,
        { sender_name: 'Dr. Lee', tone: 'Formal', decline: true, signoff: 'Kind regards' },
        { ...context, clipboard: '  \n' }
      )
    ).toBe(
      `Today is 2026-03-05. Draft a reply to the email below for Dr. Lee.

Write in a formal, professional tone.
Politely decline the request and suggest an alternative if one makes sense.
Avoid contractions.

Sign off with "Kind regards, Dr. Lee".

(No email was on the clipboard. Ask me to paste it.)
`
    )
  })

  it('renders built-ins as empty without a context', () => {
    expect(render(parsed, { sender_name: 'Sam', tone: 'Brief' })).toBe(
      `Today is . Draft a reply to the email below for Sam.

Keep it to three sentences or fewer.
Agree to the request and confirm the next steps.

Sign off with "Best, Sam".

(No email was on the clipboard. Ask me to paste it.)
`
    )
  })
})

describe('render: placeholders and defaults', () => {
  it('renders text as given and applies defaults only to missing values', () => {
    const t = withFields('  a: { type: text, default: Def }\n', '[{{a}}]')
    expect(r(t)).toBe('[Def]')
    expect(r(t, { a: '' })).toBe('[]')
    expect(r(t, { a: 'x' })).toBe('[x]')
  })

  it('renders selects: first option by default, value for label maps, unset when required', () => {
    expect(r(withFields('  s: { type: select, options: [A, B] }\n', '{{s}}'))).toBe('A')
    expect(r(withFields('  s: { type: select, options: [A, B], default: B }\n', '{{s}}'))).toBe('B')
    expect(
      r(withFields('  s: { type: select, options: [A, B], required: true }\n', '[{{s}}]'))
    ).toBe('[]')
    const map = withFields(
      '  s: { type: select, options: { Short: S-text, Long: L-text } }\n',
      '{{s}}'
    )
    expect(r(map)).toBe('S-text')
    expect(r(map, { s: 'Long' })).toBe('L-text')
    expect(r(map, { s: 'Unknown' })).toBe('')
    expect(r(map, { s: null })).toBe('')
  })

  it('joins multiselects in option order with the join string', () => {
    const t = withFields('  m: { type: multiselect, options: [A, B, C] }\n', '[{{m}}]')
    expect(r(t)).toBe('[]')
    expect(r(t, { m: ['C', 'A'] })).toBe('[A, C]')
    expect(r(t, { m: ['A', 'Nope'] })).toBe('[A]')
    const join = withFields('  m: { type: multiselect, options: [A, B], join: " and " }\n', '{{m}}')
    expect(r(join, { m: ['A', 'B'] })).toBe('A and B')
    const map = withFields('  m: { type: multiselect, options: { A: alpha, B: beta } }\n', '{{m}}')
    expect(r(map, { m: ['A', 'B'] })).toBe('alpha, beta')
  })

  it('renders toggles as yes or no', () => {
    const t = withFields('  g: { type: toggle }\n', '{{g}}')
    expect(r(t)).toBe('no')
    expect(r(t, { g: true })).toBe('yes')
    expect(r(withFields('  g: { type: toggle, default: true }\n', '{{g}}'))).toBe('yes')
  })

  it('renders numbers, or nothing when unset', () => {
    const t = withFields('  n: { type: number }\n', '[{{n}}]')
    expect(r(t)).toBe('[]')
    expect(r(t, { n: 3.5 })).toBe('[3.5]')
    expect(r(t, { n: null })).toBe('[]')
    expect(r(withFields('  n: { type: number, default: 2 }\n', '{{n}}'))).toBe('2')
  })

  it('falls back to the default for values of the wrong type', () => {
    const t = withFields(
      '  a: { type: text, default: D }\n  n: { type: number, default: 1 }\n',
      '{{a}} {{n}}'
    )
    expect(r(t, { a: 5, n: Number.NaN })).toBe('D 1')
  })

  it('renders implicit fields from values, empty when missing', () => {
    expect(r('Summarize {{topic}}.', { topic: 'tides' })).toBe('Summarize tides.')
    expect(r('Summarize {{topic}}.')).toBe('Summarize .')
  })

  it('renders escapes, includes and stray tags', () => {
    expect(r('a \\{{b}} c')).toBe('a {{b}} c')
    expect(r('a {{> x}} b')).toBe('a  b')
    expect(r('a{{end}}b')).toBe('ab')
    expect(r('keep {{foo bar}} and {{ as text')).toBe('keep {{foo bar}} and {{ as text')
  })

  it('handles an empty body and frontmatter-only files', () => {
    expect(r('')).toBe('')
    expect(r('---\ntitle: T\n---')).toBe('')
    expect(r('---\ntitle: T\n---\n')).toBe('')
  })

  it('preserves Windows line endings', () => {
    const t = '---\r\ntitle: T\r\n---\r\nA\r\n{{if x}}\r\nB {{x}}\r\n{{end}}\r\nC\r\n'
    expect(r(t, { x: 'y' })).toBe('A\r\nB y\r\nC\r\n')
    expect(r(t, { x: '' })).toBe('A\r\nC\r\n')
  })
})

describe('render: built-in variables', () => {
  it('formats date, time and datetime from the injected clock', () => {
    expect(r('{{date}} | {{time}} | {{datetime}}')).toBe('2026-03-05 | 09:07 | 2026-03-05 09:07')
    expect(r('{{time}}', {}, { now: new Date(2026, 11, 31, 23, 59), clipboard: '' })).toBe('23:59')
  })

  it('inserts the clipboard as-is', () => {
    expect(r('<{{clipboard}}>', {}, { now: context.now, clipboard: 'a {{b}}\n' })).toBe(
      '<a {{b}}\n>'
    )
  })

  it('takes precedence over values and declared fields', () => {
    expect(r('{{clipboard}}', { clipboard: 'from values' })).toBe(context.clipboard)
    expect(r(withFields('  date: { type: text, default: D }\n', '{{date}}'))).toBe('2026-03-05')
  })

  it('works in conditions', () => {
    const t = '{{if clipboard}}has{{else}}empty{{end}} {{if date is 2026-03-05}}today{{end}}'
    expect(r(t)).toBe('has today')
    expect(r(t, {}, { now: new Date(2026, 0, 1), clipboard: '' })).toBe('empty ')
  })
})

describe('render: conditionals', () => {
  it('evaluates truthiness per type', () => {
    const t = withFields(
      '  t: { type: text }\n  s: { type: select, options: [A], required: true }\n  m: { type: multiselect, options: [A] }\n  g: { type: toggle }\n  n: { type: number }\n',
      '{{if t}}t{{end}}{{if s}}s{{end}}{{if m}}m{{end}}{{if g}}g{{end}}{{if n}}n{{end}}'
    )
    expect(r(t)).toBe('')
    expect(r(t, { t: '  \n ' })).toBe('')
    expect(r(t, { t: 'x', s: 'A', m: ['A'], g: true, n: 0 })).toBe('tsmgn')
    expect(r(t, { s: 'stale label' })).toBe('')
  })

  it('compares select labels with is, not values', () => {
    const t = withFields(
      '  tone: { type: select, options: { Gentle: be kind, Blunt: be direct } }\n',
      '{{if tone is Blunt}}B{{else}}G{{end}} {{if tone is be direct}}V{{end}}'
    )
    expect(r(t, { tone: 'Blunt' })).toBe('B ')
    expect(r(t, { tone: 'Gentle' })).toBe('G ')
  })

  it('uses trimmed, case-sensitive equality for text and is', () => {
    const t = '{{if lang is Go}}yes{{else}}no{{end}}{{lang}}'
    expect(r(t, { lang: ' Go ' })).toBe('yes Go ')
    expect(r(t, { lang: 'go' })).toBe('nogo')
  })

  it('checks membership with has', () => {
    const t = withFields(
      '  m: { type: multiselect, options: [A, B, C] }\n',
      '{{if m has B}}B{{end}}{{if m is A}}onlyA{{end}}'
    )
    expect(r(t, { m: ['A', 'B'] })).toBe('B')
    expect(r(t, { m: ['A'] })).toBe('onlyA')
  })

  it('compares toggles and numbers with is', () => {
    const t = withFields(
      '  g: { type: toggle }\n  n: { type: number }\n',
      '{{if g is yes}}on{{end}}{{if g is no}}off{{end}}{{if n is 2}}two{{end}}'
    )
    expect(r(t, { g: true, n: 2 })).toBe('ontwo')
    expect(r(t, { g: false, n: 2.0 })).toBe('offtwo')
  })

  it('treats has on non-multiselects, unknown ids and malformed conditions as false', () => {
    expect(r('{{if t has x}}A{{else}}B{{end}}', { t: 'x' })).toBe('B')
    expect(r('{{if nowhere}}A{{else}}B{{end}}')).toBe('B')
    expect(r('{{if}}A{{else}}B{{end}}')).toBe('B')
  })

  it('renders nested blocks and else branches', () => {
    const t = withFields(
      '  a: { type: text }\n  b: { type: text }\n',
      '{{if a}}A{{if b}}B{{else}}b{{end}}{{else}}x{{if b}}B{{end}}{{end}}'
    )
    expect(r(t, { a: '1', b: '1' })).toBe('AB')
    expect(r(t, { a: '1', b: '' })).toBe('Ab')
    expect(r(t, { a: '', b: '1' })).toBe('xB')
    expect(r(t, { a: '', b: '' })).toBe('x')
  })

  it('removes standalone tag lines but keeps inline ones', () => {
    const t = withFields(
      '  x: { type: toggle }\n',
      'A\n{{if x}}\nB\n{{else}}\nC\n{{end}}\nD\nE {{if x}}F{{end}} G\n'
    )
    expect(r(t, { x: true })).toBe('A\nB\nD\nE F G\n')
    expect(r(t, { x: false })).toBe('A\nC\nD\nE  G\n')
  })

  it('renders an unclosed block through to the end of the file', () => {
    const t = withFields('  x: { type: toggle }\n', 'A {{if x}}B')
    expect(r(t, { x: true })).toBe('A B')
    expect(r(t, { x: false })).toBe('A ')
  })

  it('ignores values for ids used only in conditions (undeclared)', () => {
    expect(r('{{if extra}}A{{else}}B{{end}}', { extra: 'yes' })).toBe('B')
    // Once used as a placeholder it is an implicit field and the value counts.
    expect(r('{{if extra}}A{{end}}{{extra}}', { extra: '!' })).toBe('A!')
  })

  it('is deterministic for the same input', () => {
    const parsed = fixture('email-reply')
    expect(render(parsed, { sender_name: 'S' }, context)).toBe(
      render(parsed, { sender_name: 'S' }, context)
    )
  })
})
