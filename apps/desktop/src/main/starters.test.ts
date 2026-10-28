import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formFor, lint, parse, render, validateValues } from 'prompt-lang'
import type { FieldValue } from 'prompt-lang'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STARTER_PROMPTS, writeStarters } from './starters'

describe('STARTER_PROMPTS', () => {
  it.each(STARTER_PROMPTS.map((s) => [s.path, s] as const))(
    '%s is a clean, valid prompt',
    (_path, starter) => {
      expect(lint(parse(starter.content))).toEqual([])
    }
  )

  it('has unique, relative .md paths and unique aliases', () => {
    const paths = STARTER_PROMPTS.map((s) => s.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every((p) => p.endsWith('.md') && !p.startsWith('/') && !p.includes('..'))).toBe(
      true
    )
    const aliases = STARTER_PROMPTS.flatMap(
      (s) => parse(s.content).frontmatter?.aliases.map((a) => a.value) ?? []
    )
    expect(aliases.length).toBeGreaterThan(0)
    expect(new Set(aliases).size).toBe(aliases.length)
  })

  it('spans a top-level file and folders, to show categories', () => {
    const folders = new Set(
      STARTER_PROMPTS.map((s) => (s.path.includes('/') ? s.path.split('/')[0] : ''))
    )
    expect(folders.has('')).toBe(true)
    expect(folders.size).toBeGreaterThanOrEqual(3)
  })

  it('renders every starter with sample answers, leaving no template syntax behind', () => {
    const context = {
      now: new Date(2026, 2, 5, 9, 7),
      clipboard: 'Please send the report by Friday.'
    }
    for (const starter of STARTER_PROMPTS) {
      const parsed = parse(starter.content)
      const values: Record<string, FieldValue> = {}
      for (const field of formFor(parsed).fields) {
        if (field.type === 'text' || field.type === 'textarea')
          values[field.id] = `sample ${field.id}`
      }
      expect(validateValues(parsed, values)).toEqual([])
      const output = render(parsed, values, context)
      expect(output, starter.path).not.toMatch(/\{\{|\}\}/)
      expect(output.trim().length).toBeGreaterThan(50)
    }
  })

  it('renders the Code Review starter to the documented example', () => {
    const parsed = parse(STARTER_PROMPTS[0]?.content ?? '')
    expect(formFor(parsed).fields.map((f) => f.id)).toEqual([
      'language',
      'focus',
      'tone',
      'context',
      'code'
    ])
    expect(render(parsed, { code: 'x' }, { now: new Date(), clipboard: '' })).toContain(
      'You are a senior TypeScript engineer'
    )
  })
})

describe('writeStarters', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pw-starters-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('creates every starter, including folders', async () => {
    const result = await writeStarters(dir)
    expect(result.created.sort()).toEqual(STARTER_PROMPTS.map((s) => s.path).sort())
    expect(result.skipped).toEqual([])
    for (const starter of STARTER_PROMPTS) {
      expect(await readFile(join(dir, starter.path), 'utf8')).toBe(starter.content)
    }
  })

  it('never overwrites a file that exists, and reports it as skipped', async () => {
    await mkdir(join(dir, 'code'))
    await writeFile(join(dir, 'code', 'code-review.md'), 'my own edited version')
    const result = await writeStarters(dir)
    expect(result.skipped).toEqual(['code/code-review.md'])
    expect(result.created).toHaveLength(STARTER_PROMPTS.length - 1)
    expect(await readFile(join(dir, 'code', 'code-review.md'), 'utf8')).toBe(
      'my own edited version'
    )
  })

  it('does nothing the second time', async () => {
    await writeStarters(dir)
    const again = await writeStarters(dir)
    expect(again.created).toEqual([])
    expect(again.skipped).toHaveLength(STARTER_PROMPTS.length)
  })

  it('leaves unrelated files alone and fails loudly when the folder is not writable', async () => {
    await writeFile(join(dir, 'mine.md'), 'mine')
    await writeStarters(dir)
    expect((await readdir(dir)).includes('mine.md')).toBe(true)
    await writeFile(join(dir, 'blocker'), 'a file, not a folder')
    await expect(writeStarters(join(dir, 'blocker'))).rejects.toThrow()
  })
})
