import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'prompt-lang'
import { buildEntry } from './library/entry'
import { CaptureService, promptFileFor, slugify, titleFromText } from './capture-service'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-capture-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

function service(clipboard: string, libraryPath: string | null = dir) {
  const refresh = vi.fn(async () => undefined)
  return {
    refresh,
    service: new CaptureService({
      libraryPath: () => libraryPath,
      readClipboard: () => clipboard,
      refresh
    })
  }
}

describe('titleFromText', () => {
  it('uses the first line', () => {
    expect(titleFromText('Summarize this article\nin three bullets')).toBe('Summarize this article')
  })

  it('skips blank lines, code fences and rules, and strips heading marks', () => {
    expect(titleFromText('\n\n```ts\nconst x = 1')).toBe('const x = 1')
    expect(titleFromText('---\n## Plan the week')).toBe('Plan the week')
    expect(titleFromText('```\n---\n***')).toBe('Untitled prompt')
  })

  it('collapses runs of whitespace', () => {
    expect(titleFromText('  a \t  b  ')).toBe('a b')
  })

  it('cuts a long first line at a word and adds an ellipsis', () => {
    const title = titleFromText(`${'word '.repeat(30)}end`)
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
    expect(title).toMatch(/^(word )+word…$/)
  })

  it('cuts one very long word without a break', () => {
    expect(titleFromText('x'.repeat(200))).toBe(`${'x'.repeat(60)}…`)
  })

  it('works for non-latin text', () => {
    expect(titleFromText('こんにちは世界\n続き')).toBe('こんにちは世界')
  })
})

describe('slugify', () => {
  it('lower-cases and joins words with dashes', () => {
    expect(slugify('Summarize This: Article!')).toBe('summarize-this-article')
  })

  it('drops accents but keeps other scripts', () => {
    expect(slugify('Café résumé')).toBe('cafe-resume')
    expect(slugify('こんにちは')).toBe('こんにちは')
  })

  it('never produces a path', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
    expect(slugify('a/b\\c')).toBe('a-b-c')
  })

  it('falls back when nothing is left', () => {
    expect(slugify('???')).toBe('untitled-prompt')
  })

  it('keeps names short without a trailing dash', () => {
    const slug = slugify(`${'abcd '.repeat(30)}`)
    expect(slug.length).toBeLessThanOrEqual(50)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('promptFileFor', () => {
  const context = { now: new Date(2026, 0, 1), clipboard: '' }

  it('makes a file that parses to the title and renders back to the text', () => {
    const text = 'Fix this bug\nin {{ the code }} and \\{{ more }} and {{{x}}}\n{{if a}}\n'
    const entry = buildEntry('fix', promptFileFor('Fix this bug', text))
    expect(entry.title).toBe('Fix this bug')
    expect(entry.diagnostics).toEqual([])
    expect(render(entry.parsed, {}, context)).toBe(text)
  })

  it('adds a final newline when the text has none', () => {
    expect(promptFileFor('Hi', 'Hi there').endsWith('Hi there\n')).toBe(true)
  })

  it('quotes titles that YAML would misread', () => {
    for (const title of [
      'yes',
      'null',
      '2026 plan',
      'Why: because',
      '# not a comment',
      'say "hi"'
    ]) {
      const entry = buildEntry('t', promptFileFor(title, 'body'))
      expect(entry.title).toBe(title)
      expect(entry.diagnostics).toEqual([])
    }
  })

  it('leaves ordinary titles unquoted', () => {
    expect(promptFileFor('Summarize this article', 'x')).toContain(
      'title: Summarize this article\n'
    )
  })
})

describe('CaptureService.createFromClipboard', () => {
  it('writes the clipboard to a new prompt file and refreshes the library', async () => {
    const { service: capture, refresh } = service('Explain {{this}} to me\nslowly')
    const result = await capture.createFromClipboard()
    expect(result).toEqual({
      status: 'created',
      id: 'explain-this-to-me',
      title: 'Explain {{this}} to me'
    })
    const text = await readFile(join(dir, 'explain-this-to-me.md'), 'utf8')
    const entry = buildEntry('explain-this-to-me', text)
    expect(entry.title).toBe('Explain {{this}} to me')
    expect(entry.diagnostics).toEqual([])
    expect(render(entry.parsed, {}, { now: new Date(), clipboard: '' })).toBe(
      'Explain {{this}} to me\nslowly\n'
    )
    expect(refresh).toHaveBeenCalledWith([join(dir, 'explain-this-to-me.md')])
  })

  it('gives each capture its own name and never overwrites an existing prompt', async () => {
    await writeFile(join(dir, 'notes.md'), 'MINE')
    const first = await service('Notes\none').service.createFromClipboard()
    const second = await service('Notes\ntwo').service.createFromClipboard()
    expect(first).toMatchObject({ status: 'created', id: 'notes-2' })
    expect(second).toMatchObject({ status: 'created', id: 'notes-3' })
    expect(await readFile(join(dir, 'notes.md'), 'utf8')).toBe('MINE')
    expect((await readdir(dir)).sort()).toEqual(['notes-2.md', 'notes-3.md', 'notes.md'])
  })

  it('falls back to "Untitled prompt"', async () => {
    const result = await service('```\n```').service.createFromClipboard()
    expect(result).toMatchObject({
      status: 'created',
      id: 'untitled-prompt',
      title: 'Untitled prompt'
    })
  })

  it('normalizes Windows line endings', async () => {
    await service('Title\r\nline two\r\n').service.createFromClipboard()
    expect(await readFile(join(dir, 'title.md'), 'utf8')).not.toContain('\r')
  })

  it.each(['', '   ', '\n\t\n'])('creates nothing for an empty clipboard (%j)', async (text) => {
    const { service: capture, refresh } = service(text)
    expect(await capture.createFromClipboard()).toEqual({ status: 'empty' })
    expect(await readdir(dir)).toEqual([])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('asks for a library first when there is none', async () => {
    expect(await service('text', null).service.createFromClipboard()).toEqual({
      status: 'no-library'
    })
  })

  it('reports a folder that can no longer be written to', async () => {
    const result = await service('text', join(dir, 'gone')).service.createFromClipboard()
    expect(result).toMatchObject({ status: 'error' })
  })
})
