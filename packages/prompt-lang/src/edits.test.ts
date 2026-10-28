import { describe, expect, it } from 'vitest'
import { isMap, isScalar, type Pair } from 'yaml'
import {
  EditError,
  makeField,
  removeField,
  renameField,
  reorderFields,
  updateField,
  wrapIf
} from './edits'
import { lint } from './lint'
import { parse, type ParsedPrompt } from './parse'
import { render } from './render'
import { applyChanges, fixtureText } from './test-utils'
import type { TextChange } from './types'

const COMMENTED = `---
# Prompt metadata
title: Review
tags: [code]
fields:
  # Which language
  language: { type: select, options: [TypeScript, Go] } # inline note
  focus:
    type: multiselect # pick several
    options: [Bugs, Tests]
    default: [Bugs]

  notes: { type: textarea, help: Anything else? }
# trailing comment
format: 1
---
Review this {{language}} code.
{{if focus has Bugs}}
Look for bugs.
{{end}}
{{notes}}
`

const COMMENTS = [
  '# Prompt metadata',
  '# Which language',
  '# inline note',
  '# pick several',
  '# trailing comment'
]

function topKeys(p: ParsedPrompt): string[] {
  const root = p.frontmatter?.document.contents
  if (!isMap(root)) return []
  return (root.items as Pair[]).map((i) => (isScalar(i.key) ? String(i.key.value) : '?'))
}

/** Applies changes, re-parses, and checks the frontmatter is still sound. */
function apply(text: string, changes: TextChange[]) {
  // Changes come back sorted and non-overlapping.
  for (let i = 1; i < changes.length; i++) {
    const prev = changes[i - 1]
    const cur = changes[i]
    expect(prev && cur && prev.to <= cur.from).toBe(true)
  }
  const out = applyChanges(text, changes)
  const parsed = parse(out)
  const broken = parsed.diagnostics.filter((d) =>
    ['yaml-syntax', 'invalid-frontmatter', 'duplicate-field-id'].includes(d.code)
  )
  expect(broken).toEqual([])
  return { out, parsed, ids: parsed.fields.map((f) => f.id) }
}

function expectCommentsKept(out: string, comments = COMMENTS) {
  for (const c of comments) expect(out).toContain(c)
}

const sel = (text: string, needle: string) => {
  const from = text.indexOf(needle)
  if (from === -1) throw new Error(`no ${needle}`)
  return { from, to: from + needle.length }
}

describe('edits.makeField', () => {
  it('replaces the selection with a placeholder and declares a field with it as default', () => {
    const text = COMMENTED
    const { out, parsed, ids } = apply(
      text,
      makeField(parse(text), sel(text, 'Look for bugs'), 'task')
    )
    expect(ids).toEqual(['language', 'focus', 'notes', 'task'])
    expect(out).toContain('{{task}}.\n')
    expect(out).toContain(
      '  notes: { type: textarea, help: Anything else? }\n  task: { type: text, default: Look for bugs }\n# trailing comment'
    )
    expectCommentsKept(out)
    expect(topKeys(parsed)).toEqual(['title', 'tags', 'fields', 'format'])
    // Rendering with defaults gives the same prompt as before.
    expect(render(parsed, { notes: 'n' })).toBe(render(parse(text), { notes: 'n' }))
  })

  it('makes a textarea for multi-line selections, in block style', () => {
    const text = '---\ntitle: T\nfields:\n  a: { type: text }\n---\n{{a}}\nLine one\nLine two\n'
    const { out, parsed } = apply(
      text,
      makeField(parse(text), sel(text, 'Line one\nLine two'), 'body')
    )
    expect(out).toContain(
      '  body:\n    type: textarea\n    default: |-\n      Line one\n      Line two\n'
    )
    expect(parsed.fields[1]).toMatchObject({ type: 'textarea', default: 'Line one\nLine two' })
  })

  it('quotes defaults that would otherwise change meaning', () => {
    const text = '---\ntitle: T\n---\nAnswer: yes: true #1'
    const { parsed } = apply(text, makeField(parse(text), sel(text, 'yes: true #1'), 'x'))
    expect(parsed.fields[0]).toMatchObject({ default: 'yes: true #1' })
  })

  it('creates frontmatter for a file without any', () => {
    const text = 'Summarize the French Revolution.'
    const { out, parsed } = apply(
      text,
      makeField(parse(text), sel(text, 'the French Revolution'), 'topic')
    )
    expect(out).toBe(
      '---\ntitle: Untitled prompt\nfields:\n  topic: { type: text, default: the French Revolution }\n---\nSummarize {{topic}}.'
    )
    expect(lint(parsed)).toEqual([])
  })

  it('works when the selection starts at the very beginning of a bare file', () => {
    const text = 'Topic here'
    const { out } = apply(text, makeField(parse(text), sel(text, 'Topic'), 't'))
    expect(out.endsWith('---\n{{t}} here')).toBe(true)
  })

  it('adds a fields map when the frontmatter has none, or an empty one', () => {
    const none = '---\ntitle: T\n---\nHello world'
    expect(apply(none, makeField(parse(none), sel(none, 'world'), 'who')).out).toBe(
      '---\ntitle: T\nfields:\n  who: { type: text, default: world }\n---\nHello {{who}}'
    )
    const empty = '---\ntitle: T\nfields:\nformat: 1\n---\nHello world'
    expect(apply(empty, makeField(parse(empty), sel(empty, 'world'), 'who')).out).toBe(
      '---\ntitle: T\nfields:\n  who: { type: text, default: world }\nformat: 1\n---\nHello {{who}}'
    )
  })

  it('appends to a flow-style fields map', () => {
    const text = '---\ntitle: T\nfields: { a: { type: text } }\n---\n{{a}} world'
    expect(apply(text, makeField(parse(text), sel(text, 'world'), 'b')).out).toBe(
      '---\ntitle: T\nfields: { a: { type: text }, b: { type: text, default: world } }\n---\n{{a}} {{b}}'
    )
  })

  it('inserts a placeholder with no default for an empty selection', () => {
    const text = '---\ntitle: T\n---\nHi !'
    const at = text.indexOf('!')
    expect(apply(text, makeField(parse(text), { from: at, to: at }, 'name')).out).toBe(
      '---\ntitle: T\nfields:\n  name: { type: text }\n---\nHi {{name}}!'
    )
  })

  it('declares an id that was an implicit field', () => {
    const text = 'Use {{topic}} about cats'
    const { parsed } = apply(text, makeField(parse(text), sel(text, 'cats'), 'topic'))
    expect(parsed.implicitFields).toEqual([])
  })

  it('keeps Windows line endings', () => {
    const text = '---\r\ntitle: T\r\nfields:\r\n  a: { type: text }\r\n---\r\n{{a}} world\r\n'
    const { out } = apply(text, makeField(parse(text), sel(text, 'world'), 'b'))
    expect(out).toBe(
      '---\r\ntitle: T\r\nfields:\r\n  a: { type: text }\r\n  b: { type: text, default: world }\r\n---\r\n{{a}} {{b}}\r\n'
    )
  })

  it('rejects bad ids, existing ids, built-ins, and selections outside the body', () => {
    const p = parse(COMMENTED)
    const body = sel(COMMENTED, 'Look')
    expect(() => makeField(p, body, 'bad-id')).toThrow(EditError)
    expect(() => makeField(p, body, 'notes')).toThrow(/already exists/)
    expect(() => makeField(p, body, 'date')).toThrow(/built-in/)
    expect(() => makeField(p, sel(COMMENTED, 'Review\n'), 'x')).toThrow(/inside the prompt body/)
  })

  it('refuses to edit broken frontmatter YAML', () => {
    const text = '---\ntitle: [oops\n---\nHello world'
    expect(() => makeField(parse(text), sel(text, 'world'), 'x')).toThrow(/YAML/)
  })
})

describe('edits.renameField', () => {
  it('renames the key, placeholders and conditions together', () => {
    const { out, parsed, ids } = apply(COMMENTED, renameField(parse(COMMENTED), 'focus', 'areas'))
    expect(ids).toEqual(['language', 'areas', 'notes'])
    expect(out).toContain('  areas:\n    type: multiselect # pick several')
    expect(out).toContain('{{if areas has Bugs}}')
    expect(out).not.toContain('focus')
    expectCommentsKept(out)
    expect(lint(parsed)).toEqual([])
  })

  it('renames every occurrence, including nested and repeated ones', () => {
    const text =
      '---\ntitle: T\nfields:\n  a: { type: text }\n---\n{{a}} {{if a}}{{if a is x}}{{a}}{{end}}{{end}}'
    const { out } = apply(text, renameField(parse(text), 'a', 'b'))
    expect(out).toBe(
      '---\ntitle: T\nfields:\n  b: { type: text }\n---\n{{b}} {{if b}}{{if b is x}}{{b}}{{end}}{{end}}'
    )
  })

  it('renames implicit fields and condition-only ids in the body', () => {
    const text = '{{topic}} {{if topic}}x{{end}}'
    expect(apply(text, renameField(parse(text), 'topic', 'subject')).out).toBe(
      '{{subject}} {{if subject}}x{{end}}'
    )
  })

  it('is a no-op for the same id and rejects conflicts', () => {
    const p = parse(COMMENTED)
    expect(renameField(p, 'notes', 'notes')).toEqual([])
    expect(() => renameField(p, 'notes', 'focus')).toThrow(/already exists/)
    expect(() => renameField(p, 'notes', '1x')).toThrow(EditError)
    expect(() => renameField(p, 'nothing', 'x')).toThrow(/not used/)
  })
})

describe('edits.removeField', () => {
  it('removes a block-style field with comment lines directly above it', () => {
    const { out, ids, parsed } = apply(COMMENTED, removeField(parse(COMMENTED), 'language'))
    expect(ids).toEqual(['focus', 'notes'])
    expect(out).not.toContain('# Which language')
    expect(out).not.toContain('# inline note')
    expectCommentsKept(out, ['# Prompt metadata', '# pick several', '# trailing comment'])
    expect(topKeys(parsed)).toEqual(['title', 'tags', 'fields', 'format'])
    // The body still refers to it, so it becomes an implicit field.
    expect(parsed.implicitFields.map((f) => f.id)).toEqual(['language'])
  })

  it('removes a multi-line field and keeps neighbours intact', () => {
    const { out } = apply(COMMENTED, removeField(parse(COMMENTED), 'focus'))
    expect(out).toContain(
      '  language: { type: select, options: [TypeScript, Go] } # inline note\n\n  notes:'
    )
  })

  it('removes the last field, leaving an empty fields map', () => {
    const text = '---\ntitle: T\nfields:\n  a: { type: text }\n---\nx'
    const { out, ids } = apply(text, removeField(parse(text), 'a'))
    expect(out).toBe('---\ntitle: T\nfields:\n---\nx')
    expect(ids).toEqual([])
  })

  it('removes entries from flow-style maps', () => {
    const text =
      '---\ntitle: T\nfields: { a: { type: text }, b: { type: toggle }, c: { type: text } }\n---\n'
    expect(apply(text, removeField(parse(text), 'b')).out).toContain(
      'fields: { a: { type: text }, c: { type: text } }'
    )
    expect(apply(text, removeField(parse(text), 'c')).out).toContain(
      'fields: { a: { type: text }, b: { type: toggle } }'
    )
    expect(apply(text, removeField(parse(text), 'a')).out).toContain(
      'fields: { b: { type: toggle }, c: { type: text } }'
    )
    const one = '---\ntitle: T\nfields: { a: { type: text } }\n---\n'
    expect(apply(one, removeField(parse(one), 'a')).out).toContain('fields: {  }')
  })

  it('rejects unknown fields', () => {
    expect(() => removeField(parse(COMMENTED), 'nope')).toThrow(/not declared/)
    expect(() => removeField(parse('{{x}}'), 'x')).toThrow(/not declared/)
  })
})

describe('edits.reorderFields', () => {
  it('moves block-style fields verbatim, with their comments', () => {
    const { out, ids, parsed } = apply(
      COMMENTED,
      reorderFields(parse(COMMENTED), ['notes', 'language', 'focus'])
    )
    expect(ids).toEqual(['notes', 'language', 'focus'])
    expectCommentsKept(out)
    expect(out).toContain(
      '  # Which language\n  language: { type: select, options: [TypeScript, Go] } # inline note\n'
    )
    expect(topKeys(parsed)).toEqual(['title', 'tags', 'fields', 'format'])
    // Only the fields region changed.
    expect(out.slice(0, out.indexOf('fields:'))).toBe(
      COMMENTED.slice(0, COMMENTED.indexOf('fields:'))
    )
    expect(out.slice(out.indexOf('# trailing'))).toBe(
      COMMENTED.slice(COMMENTED.indexOf('# trailing'))
    )
  })

  it('reorders the Code Review fixture and round-trips back', () => {
    const text = fixtureText('code-review')
    const once = apply(
      text,
      reorderFields(parse(text), ['code', 'language', 'focus', 'tone', 'context'])
    )
    expect(once.ids).toEqual(['code', 'language', 'focus', 'tone', 'context'])
    const back = apply(
      once.out,
      reorderFields(once.parsed, ['language', 'focus', 'tone', 'context', 'code'])
    )
    expect(back.out).toBe(text)
  })

  it('reorders flow-style maps', () => {
    const text = '---\ntitle: T\nfields: { a: { type: text }, b: { type: toggle } }\n---\n'
    expect(apply(text, reorderFields(parse(text), ['b', 'a'])).out).toContain(
      'fields: { b: { type: toggle }, a: { type: text } }'
    )
  })

  it('returns no changes for the current order and rejects incomplete lists', () => {
    const p = parse(COMMENTED)
    expect(reorderFields(p, ['language', 'focus', 'notes'])).toEqual([])
    expect(() => reorderFields(p, ['language', 'focus'])).toThrow(EditError)
    expect(() => reorderFields(p, ['language', 'focus', 'focus'])).toThrow(EditError)
    expect(() => reorderFields(p, ['language', 'focus', 'other'])).toThrow(EditError)
  })
})

describe('edits.updateField', () => {
  it('replaces existing scalar values in place without touching anything else', () => {
    const changes = updateField(parse(COMMENTED), 'notes', { help: 'What else should I know?' })
    const { out, parsed } = apply(COMMENTED, changes)
    expect(out).toBe(COMMENTED.replace('help: Anything else?', 'help: What else should I know?'))
    expect(parsed.fields[2]).toMatchObject({ help: 'What else should I know?' })
  })

  it('quotes scalar values when needed', () => {
    const { parsed } = apply(
      COMMENTED,
      updateField(parse(COMMENTED), 'notes', { help: 'Note: #1, [x]' })
    )
    expect(parsed.fields[2]).toMatchObject({ help: 'Note: #1, [x]' })
  })

  it('adds keys to a flow-style definition, keeping its style and key order', () => {
    const { out } = apply(
      COMMENTED,
      updateField(parse(COMMENTED), 'notes', { required: true, label: 'Notes' })
    )
    expect(out).toContain(
      '  notes: { type: textarea, help: Anything else?, required: true, label: Notes }\n# trailing comment'
    )
  })

  it('updates block-style definitions, keeping comments inside them', () => {
    const { out, parsed } = apply(
      COMMENTED,
      updateField(parse(COMMENTED), 'focus', { label: 'Focus areas', default: ['Bugs', 'Tests'] })
    )
    expect(out).toContain(
      '  focus:\n    type: multiselect # pick several\n    options: [Bugs, Tests]\n    default: [Bugs, Tests]\n    label: Focus areas\n'
    )
    expectCommentsKept(out)
    expect(parsed.fields[1]).toMatchObject({ label: 'Focus areas', default: ['Bugs', 'Tests'] })
  })

  it('removes keys set to null', () => {
    const { out } = apply(COMMENTED, updateField(parse(COMMENTED), 'notes', { help: null }))
    expect(out).toContain('  notes: { type: textarea }\n')
  })

  it('replaces options with a list or a label-to-value map', () => {
    const list = apply(
      COMMENTED,
      updateField(parse(COMMENTED), 'language', { options: ['Go', 'Rust'] })
    )
    expect(list.parsed.fields[0]).toMatchObject({ options: [{ label: 'Go' }, { label: 'Rust' }] })
    expect(list.out).toContain(
      '# Which language\n  language: { type: select, options: [Go, Rust] } # inline note\n'
    )
    const map = apply(
      COMMENTED,
      updateField(parse(COMMENTED), 'language', { options: { Go: 'Golang', Rust: 'Rust lang' } })
    )
    expect(map.parsed.fields[0]).toMatchObject({
      options: [
        { label: 'Go', value: 'Golang' },
        { label: 'Rust', value: 'Rust lang' }
      ]
    })
  })

  it('drops keys that do not fit a new type', () => {
    const { parsed, out } = apply(
      COMMENTED,
      updateField(parse(COMMENTED), 'focus', { type: 'text' })
    )
    expect(parsed.fields[1]).toMatchObject({ type: 'text' })
    expect(out).not.toContain('options: [Bugs, Tests]')
    expect(out).not.toContain('default: [Bugs]')
    expectCommentsKept(out)
    const toSelect = apply(
      COMMENTED,
      updateField(parse(COMMENTED), 'notes', { type: 'select', options: ['A'] })
    )
    expect(toSelect.out).toContain('  notes: { type: select, help: Anything else?, options: [A] }')
  })

  it('keeps the padding style of flow collections in the edited field', () => {
    const text = '---\ntitle: T\nfields:\n  s: {type: select, options: [A, B]}\n---\n{{s}}'
    expect(apply(text, updateField(parse(text), 's', { required: true })).out).toContain(
      '  s: {type: select, options: [A, B], required: true}\n'
    )
  })

  it('updates fields in flow-style fields maps', () => {
    const text = '---\ntitle: T\nfields: { a: { type: text }, b: { type: toggle } }\n---\n'
    expect(apply(text, updateField(parse(text), 'a', { required: true })).out).toContain(
      'fields: { a: { type: text, required: true }, b: { type: toggle } }'
    )
  })

  it('rewrites a broken definition into a valid one', () => {
    const text = '---\ntitle: T\nfields:\n  a: text\n---\n{{a}}'
    const { out, parsed } = apply(text, updateField(parse(text), 'a', { type: 'textarea' }))
    expect(out).toContain('  a: { type: textarea }\n')
    expect(parsed.fields[0]).toMatchObject({ type: 'textarea' })
  })

  it('fills in an empty definition', () => {
    const text = '---\ntitle: T\nfields:\n  a:\n  b: { type: text }\n---\n{{a}}{{b}}'
    const { out } = apply(text, updateField(parse(text), 'a', { type: 'toggle' }))
    expect(out).toContain('  a: { type: toggle }\n  b: { type: text }\n')
  })

  it('returns no changes for an empty patch and rejects unknown fields', () => {
    expect(updateField(parse(COMMENTED), 'notes', {})).toEqual([])
    expect(() => updateField(parse(COMMENTED), 'nope', { label: 'x' })).toThrow(EditError)
  })
})

describe('edits.wrapIf', () => {
  it('puts tags on their own lines when wrapping whole lines', () => {
    const text =
      '---\ntitle: T\nfields:\n  strict: { type: toggle }\n---\nIntro\nBe strict.\nOutro\n'
    const { out, parsed } = apply(text, wrapIf(parse(text), sel(text, 'Be strict.\n'), 'strict'))
    expect(out).toContain('Intro\n{{if strict}}\nBe strict.\n{{end}}\nOutro\n')
    expect(render(parsed, { strict: false })).toBe('Intro\nOutro\n')
    expect(render(parsed, { strict: true })).toBe('Intro\nBe strict.\nOutro\n')
  })

  it('handles whole lines selected without their newline, and at end of file', () => {
    const text = 'A\nB\nC'
    expect(apply(text, wrapIf(parse(text), sel(text, 'B'), 'x')).out).toBe(
      'A\n{{if x}}\nB\n{{end}}\nC'
    )
    expect(apply(text, wrapIf(parse(text), sel(text, 'C'), 'x')).out).toBe(
      'A\nB\n{{if x}}\nC\n{{end}}'
    )
  })

  it('wraps inline for partial lines', () => {
    const text = 'Please be brief and kind.'
    expect(apply(text, wrapIf(parse(text), sel(text, 'brief and '), 'tone is Blunt')).out).toBe(
      'Please be {{if tone is Blunt}}brief and {{end}}kind.'
    )
  })

  it('keeps Windows line endings', () => {
    const text = 'A\r\nB\r\nC\r\n'
    expect(apply(text, wrapIf(parse(text), sel(text, 'B\r\n'), 'x')).out).toBe(
      'A\r\n{{if x}}\r\nB\r\n{{end}}\r\nC\r\n'
    )
  })

  it('rejects invalid conditions and ranges outside the body', () => {
    const text = '---\ntitle: T\n---\nBody'
    const p = parse(text)
    expect(() => wrapIf(p, sel(text, 'Body'), '')).toThrow(EditError)
    expect(() => wrapIf(p, sel(text, 'Body'), 'x equals y')).toThrow(/"is" or "has"/)
    expect(() => wrapIf(p, sel(text, 'title'), 'x')).toThrow(/inside the prompt body/)
  })
})
