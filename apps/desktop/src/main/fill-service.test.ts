import { describe, expect, it, vi } from 'vitest'
import type { Values } from 'prompt-lang'
import { FillService, rememberable } from './fill-service'
import { buildEntry } from './library/entry'
import { formFor, parse } from 'prompt-lang'

const REVIEW = `---
title: Review
fields:
  language: { type: select, options: [TypeScript, Go] }
  strict: { type: toggle }
  code: { type: textarea, required: true, from: clipboard }
---
{{language}} {{strict}} on {{date}}:
{{code}}
Copied: {{clipboard}}
`

function setup(clipboardText = 'on the clipboard') {
  const entries = new Map([['review', buildEntry('review', REVIEW)]])
  const remembered = new Map<string, Values>([['review', { language: 'Go' }]])
  const written: string[] = []
  const remember = vi.fn(async (id: string, values: Values) => {
    remembered.set(id, values)
  })
  const service = new FillService({
    prompts: { entry: (id) => entries.get(id) ?? null },
    state: { lastValues: (id) => remembered.get(id) ?? {}, remember },
    clipboard: {
      readText: async () => clipboardText,
      writeText: async (text) => void written.push(text)
    },
    now: () => new Date(2026, 0, 5, 9, 7)
  })
  return { service, written, remember, remembered }
}

describe('FillService.open', () => {
  it('gives the remembered values and the current clipboard', async () => {
    const { service } = setup('hello')
    expect(await service.open('review')).toEqual({
      remembered: { language: 'Go' },
      clipboard: 'hello'
    })
  })

  it('gives null for an unknown prompt', async () => {
    expect(await setup().service.open('nope')).toBeNull()
  })
})

describe('FillService.readClipboard', () => {
  it('gives the clipboard text as it is now', async () => {
    expect(await setup('fresh').service.readClipboard()).toBe('fresh')
  })
})

describe('FillService.copy', () => {
  it('renders with the supplied clipboard and the clock, and writes the result', async () => {
    const { service, written } = setup()
    const result = await service.copy(
      'review',
      { language: 'Go', strict: true, code: 'x := 1' },
      'snapshot'
    )
    expect(result).toEqual({ status: 'copied' })
    expect(written).toEqual(['Go yes on 2026-01-05:\nx := 1\nCopied: snapshot\n'])
  })

  it('copies nothing and reports the issues when an answer is missing', async () => {
    const { service, written, remember } = setup()
    const result = await service.copy('review', { language: 'Go', code: '  ' }, '')
    expect(result).toMatchObject({
      status: 'invalid',
      issues: [{ fieldId: 'code', code: 'required' }]
    })
    expect(written).toEqual([])
    expect(remember).not.toHaveBeenCalled()
  })

  it('reports a prompt that has gone', async () => {
    const { service, written } = setup()
    expect(await service.copy('nope', {}, '')).toEqual({ status: 'missing' })
    expect(written).toEqual([])
  })

  it('remembers the answers except the clipboard-filled ones', async () => {
    const { service, remembered } = setup()
    await service.copy('review', { language: 'TypeScript', strict: false, code: 'secret' }, '')
    expect(remembered.get('review')).toEqual({ language: 'TypeScript', strict: false })
  })

  it('still reports success if the answers could not be saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service, written, remember } = setup()
    remember.mockRejectedValueOnce(new Error('disk full'))
    expect(await service.copy('review', { code: 'x' }, '')).toEqual({ status: 'copied' })
    expect(written).toHaveLength(1)
    vi.restoreAllMocks()
  })
})

describe('rememberable', () => {
  const fields = formFor(parse(REVIEW)).fields

  it('leaves out values for fields that no longer exist and fields filled from the clipboard', () => {
    expect(rememberable(fields, { language: 'Go', gone: 'x', code: 'pasted' })).toEqual({
      language: 'Go'
    })
  })

  it('keeps explicit nulls', () => {
    expect(rememberable(fields, { language: null })).toEqual({ language: null })
  })
})
