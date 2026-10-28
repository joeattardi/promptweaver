import { describe, expect, it } from 'vitest'
import * as lang from './index'

describe('public API', () => {
  it('exposes the documented functions', () => {
    for (const name of [
      'parse',
      'lint',
      'render',
      'formFor',
      'validateValues',
      'describe'
    ] as const) {
      expect(typeof lang[name]).toBe('function')
    }
    expect(Object.keys(lang.edits).sort()).toEqual([
      'EditError',
      'makeField',
      'removeField',
      'renameField',
      'reorderFields',
      'updateField',
      'wrapIf'
    ])
  })

  it('runs the launcher loop end to end: parse, ask, validate, render', () => {
    const parsed = lang.parse(
      '---\ntitle: Greet\nfields:\n  name: { type: text, required: true }\n---\nHello {{name}} on {{date}}!'
    )
    const form = lang.formFor(parsed)
    expect(form.fields.map((f) => f.id)).toEqual(['name'])
    expect(lang.validateValues(parsed, {})).toHaveLength(1)
    const values = { name: 'Ada' }
    expect(lang.validateValues(parsed, values)).toEqual([])
    expect(lang.render(parsed, values, { now: new Date(2026, 0, 2), clipboard: '' })).toBe(
      'Hello Ada on 2026-01-02!'
    )
  })
})
