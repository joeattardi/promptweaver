import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic, writeFileAtomicNew } from './atomic-write'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-atomic-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('writeFileAtomic', () => {
  it('creates a new file', async () => {
    await writeFileAtomic(join(dir, 'a.txt'), 'hello')
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('hello')
  })

  it('replaces an existing file and leaves no temp files behind', async () => {
    await writeFile(join(dir, 'a.txt'), 'old')
    await writeFileAtomic(join(dir, 'a.txt'), 'new ✓')
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('new ✓')
    expect(await readdir(dir)).toEqual(['a.txt'])
  })

  it('keeps the permissions of the file it replaces', async () => {
    if (process.platform === 'win32') return
    await writeFile(join(dir, 'a.txt'), 'old')
    await chmod(join(dir, 'a.txt'), 0o640)
    await writeFileAtomic(join(dir, 'a.txt'), 'new')
    expect((await stat(join(dir, 'a.txt'))).mode & 0o777).toBe(0o640)
  })

  it('rejects, and leaves nothing behind, when the folder does not exist', async () => {
    await expect(writeFileAtomic(join(dir, 'missing', 'a.txt'), 'x')).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })

  it('cleans up its temp file when the rename fails', async () => {
    // A non-empty directory at the target path makes the final rename fail.
    await mkdir(join(dir, 'target'))
    await writeFile(join(dir, 'target', 'keep.txt'), 'keep')
    await expect(writeFileAtomic(join(dir, 'target'), 'x')).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['target'])
    expect(await readFile(join(dir, 'target', 'keep.txt'), 'utf8')).toBe('keep')
  })
})

describe('writeFileAtomicNew', () => {
  it('creates a new file and leaves no temp files behind', async () => {
    expect(await writeFileAtomicNew(join(dir, 'a.txt'), 'hello')).toBe(true)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('hello')
    expect(await readdir(dir)).toEqual(['a.txt'])
  })

  it('never replaces a file that is already there', async () => {
    await writeFile(join(dir, 'a.txt'), 'mine')
    expect(await writeFileAtomicNew(join(dir, 'a.txt'), 'theirs')).toBe(false)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('mine')
    expect(await readdir(dir)).toEqual(['a.txt'])
  })

  it('lets only one of two simultaneous creates win', async () => {
    const results = await Promise.all([
      writeFileAtomicNew(join(dir, 'a.txt'), 'one'),
      writeFileAtomicNew(join(dir, 'a.txt'), 'two')
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await readdir(dir)).toEqual(['a.txt'])
  })

  it('fails without leaving a temp file when the folder is missing', async () => {
    await expect(writeFileAtomicNew(join(dir, 'nope', 'a.txt'), 'x')).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})
