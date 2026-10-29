import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_RECENTS, MAX_REMEMBERED_PROMPTS, StateStore } from './state'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-state-'))
  file = join(dir, 'state.json')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('StateStore', () => {
  it('starts empty without creating the file', async () => {
    const state = await StateStore.open(file)
    expect(state.lastValues('review')).toEqual({})
    expect(await readdir(dir)).toEqual([])
  })

  it('persists remembered values and reloads them', async () => {
    const state = await StateStore.open(file)
    await state.remember('review', { language: 'Go', focus: ['Bugs'], strict: true, count: null })
    const reopened = await StateStore.open(file)
    expect(reopened.lastValues('review')).toEqual({
      language: 'Go',
      focus: ['Bugs'],
      strict: true,
      count: null
    })
    expect(reopened.lastValues('other')).toEqual({})
  })

  it('replaces the values for a prompt and forgets it when given none', async () => {
    const state = await StateStore.open(file)
    await state.remember('review', { language: 'Go' })
    await state.remember('review', { language: 'Rust' })
    expect(state.lastValues('review')).toEqual({ language: 'Rust' })
    await state.remember('review', {})
    expect(JSON.parse(await readFile(file, 'utf8')).lastValues).toEqual({})
  })

  it('keeps keys it does not know about', async () => {
    await writeFile(file, JSON.stringify({ somethingNew: ['a'], lastValues: {} }))
    const state = await StateStore.open(file)
    await state.remember('review', { language: 'Go' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      somethingNew: ['a'],
      lastValues: { review: { language: 'Go' } },
      favorites: [],
      recents: []
    })
  })

  it('drops the least recently used prompts past the limit', async () => {
    const state = await StateStore.open(file)
    for (let i = 0; i < MAX_REMEMBERED_PROMPTS + 2; i++) await state.remember(`p${i}`, { a: 'x' })
    await state.remember('p3', { a: 'y' }) // used again, so it moves to the newest end
    expect(state.lastValues('p0')).toEqual({})
    expect(state.lastValues('p1')).toEqual({})
    expect(state.lastValues('p2')).toEqual({ a: 'x' })
    expect(state.lastValues('p3')).toEqual({ a: 'y' })
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')).lastValues)).toHaveLength(
      MAX_REMEMBERED_PROMPTS
    )
  })

  it('does not lose a change when two arrive at once', async () => {
    const state = await StateStore.open(file)
    await Promise.all([state.remember('a', { x: '1' }), state.remember('b', { x: '2' })])
    const reopened = await StateStore.open(file)
    expect(reopened.lastValues('a')).toEqual({ x: '1' })
    expect(reopened.lastValues('b')).toEqual({ x: '2' })
  })

  it('does not mistake Object.prototype members for remembered prompts', async () => {
    const state = await StateStore.open(file)
    for (const id of ['constructor', 'toString', '__proto__'])
      expect(state.lastValues(id)).toEqual({})
    await state.remember('constructor', { x: '1' })
    expect((await StateStore.open(file)).lastValues('constructor')).toEqual({ x: '1' })
    await state.remember('__proto__', { x: '1' })
    expect((await StateStore.open(file)).lastValues('__proto__')).toEqual({})
    expect(({} as Record<string, unknown>)['x']).toBeUndefined()
  })

  it('moves a file with the wrong shape aside and starts empty', async () => {
    await writeFile(file, JSON.stringify({ lastValues: { review: { language: { nested: 1 } } } }))
    const state = await StateStore.open(file)
    expect(state.lastValues('review')).toEqual({})
    expect((await readdir(dir)).some((f) => f.startsWith('state.json.invalid-'))).toBe(true)
  })

  describe('favorites', () => {
    it('stars and unstars a prompt, keeping the order they were starred in', async () => {
      const state = await StateStore.open(file)
      expect(await state.toggleFavorite('b')).toBe(true)
      expect(await state.toggleFavorite('a')).toBe(true)
      expect(state.favorites()).toEqual(['b', 'a'])
      expect(state.isFavorite('a')).toBe(true)
      expect(await state.toggleFavorite('b')).toBe(false)
      expect(state.favorites()).toEqual(['a'])
      expect((await StateStore.open(file)).favorites()).toEqual(['a'])
    })
  })

  describe('recents', () => {
    it('puts the prompt just used first and lists each prompt once', async () => {
      const state = await StateStore.open(file)
      await state.markUsed('a')
      await state.markUsed('b')
      await state.markUsed('a')
      expect(state.recents()).toEqual(['a', 'b'])
      expect((await StateStore.open(file)).recents()).toEqual(['a', 'b'])
    })

    it('forgets the least recently used past the limit', async () => {
      const state = await StateStore.open(file)
      for (let i = 0; i < MAX_RECENTS + 3; i++) await state.markUsed(`p${i}`)
      expect(state.recents()).toHaveLength(MAX_RECENTS)
      expect(state.recents()[0]).toBe(`p${MAX_RECENTS + 2}`)
      expect(state.recents()).not.toContain('p0')
    })

    it('does not lose a change made while another is being saved', async () => {
      const state = await StateStore.open(file)
      await Promise.all([
        state.markUsed('a'),
        state.toggleFavorite('b'),
        state.remember('c', { x: '1' })
      ])
      const reopened = await StateStore.open(file)
      expect(reopened.recents()).toEqual(['a'])
      expect(reopened.favorites()).toEqual(['b'])
      expect(reopened.lastValues('c')).toEqual({ x: '1' })
    })
  })
})
