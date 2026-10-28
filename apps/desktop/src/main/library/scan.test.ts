import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_PROMPT_BYTES, displayPath, readPromptFile, scanLibrary } from './scan'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-scan-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const touch = async (rel: string, content = 'x') => {
  const path = join(dir, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
  return path
}
const rel = (paths: string[]) => paths.map((p) => p.slice(dir.length + 1))

describe('scanLibrary', () => {
  it('finds .md files recursively, sorted', async () => {
    await touch('b.md')
    await touch('a/z.md')
    await touch('a/b/deep.md')
    await touch('A.MD')
    expect(rel((await scanLibrary(dir)).files)).toEqual(['A.MD', 'a/b/deep.md', 'a/z.md', 'b.md'])
  })

  it('skips other files, dotfiles, hidden folders and leftover temp files', async () => {
    await touch('ok.md')
    await touch('notes.txt')
    await touch('.hidden.md')
    await touch('.git/HEAD.md')
    await touch('.ok.md.abc123.tmp')
    await touch('sub/.draft.md')
    expect(rel((await scanLibrary(dir)).files)).toEqual(['ok.md'])
  })

  it('returns nothing for an empty folder', async () => {
    expect(await scanLibrary(dir)).toEqual({ files: [], problems: [] })
  })

  it('throws when the folder does not exist or is a file', async () => {
    await expect(scanLibrary(join(dir, 'nope'))).rejects.toThrow()
    await expect(scanLibrary(await touch('file.md'))).rejects.toThrow()
  })

  it('does not follow symlinked folders, but lists symlinked files', async () => {
    if (process.platform === 'win32') return
    await touch('real/inner.md')
    await symlink(join(dir, 'real'), join(dir, 'linked-dir'))
    await symlink(join(dir, 'real', 'inner.md'), join(dir, 'linked-file.md'))
    await symlink(join(dir, 'missing.md'), join(dir, 'broken.md'))
    expect(rel((await scanLibrary(dir)).files)).toEqual(['linked-file.md', 'real/inner.md'])
  })

  it('reports unreadable subfolders instead of silently dropping them', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    await touch('ok.md')
    await touch('locked/secret.md')
    await chmod(join(dir, 'locked'), 0o000)
    try {
      const { files, problems } = await scanLibrary(dir)
      expect(rel(files)).toEqual(['ok.md'])
      expect(problems).toEqual([{ path: join(dir, 'locked'), message: 'Permission denied.' }])
    } finally {
      await chmod(join(dir, 'locked'), 0o755)
    }
  })
})

describe('readPromptFile', () => {
  it('reads UTF-8 text', async () => {
    expect(await readPromptFile(await touch('a.md', 'héllo ✓'))).toEqual({
      kind: 'ok',
      text: 'héllo ✓'
    })
  })

  it('keeps a byte-order mark so saving can write the file back unchanged', async () => {
    expect(await readPromptFile(await touch('a.md', '﻿---\ntitle: T\n---\n'))).toEqual({
      kind: 'ok',
      text: '﻿---\ntitle: T\n---\n'
    })
  })

  it('reports a missing file as missing, not as an error', async () => {
    expect(await readPromptFile(join(dir, 'gone.md'))).toEqual({ kind: 'missing' })
  })

  it('refuses files that are too large', async () => {
    const path = await touch('big.md', 'x'.repeat(MAX_PROMPT_BYTES + 1))
    const result = await readPromptFile(path)
    expect(result.kind).toBe('unreadable')
    expect(result.kind === 'unreadable' && result.message).toMatch(/Too large/)
    expect((await readPromptFile(await touch('edge.md', 'x'.repeat(MAX_PROMPT_BYTES)))).kind).toBe(
      'ok'
    )
  })

  it('refuses invalid UTF-8 rather than corrupting it', async () => {
    const path = join(dir, 'bin.md')
    await writeFile(path, Buffer.from([0x68, 0xff, 0xfe, 0x69]))
    expect(await readPromptFile(path)).toEqual({
      kind: 'unreadable',
      message: 'Not valid UTF-8 text.'
    })
  })

  it('refuses directories and unreadable files', async () => {
    await mkdir(join(dir, 'folder.md'))
    expect((await readPromptFile(join(dir, 'folder.md'))).kind).toBe('unreadable')
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const path = await touch('locked.md')
    await chmod(path, 0o000)
    expect(await readPromptFile(path)).toEqual({
      kind: 'unreadable',
      message: 'Permission denied.'
    })
  })
})

describe('displayPath', () => {
  it('is relative to the library with / separators', () => {
    expect(displayPath(dir, join(dir, 'a', 'b.md'))).toBe('a/b.md')
    expect(displayPath(dir, '/elsewhere/x.md')).toBe('/elsewhere/x.md')
  })
})
