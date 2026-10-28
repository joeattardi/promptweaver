import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isIgnored } from './watcher'

const root = join('/', 'lib')

describe('isIgnored', () => {
  it('keeps the library folder, its subfolders and .md files', () => {
    expect(isIgnored(root, root, false)).toBe(false)
    expect(isIgnored(root, join(root, 'code'), false)).toBe(false)
    expect(isIgnored(root, join(root, 'code', 'review.md'), true)).toBe(false)
    expect(isIgnored(root, join(root, 'review'), false)).toBe(false) // no stats yet: could be a folder
  })

  it('ignores non-markdown files, dotfiles, hidden folders and temp files', () => {
    expect(isIgnored(root, join(root, 'notes.txt'), true)).toBe(true)
    expect(isIgnored(root, join(root, '.hidden.md'), true)).toBe(true)
    expect(isIgnored(root, join(root, '.git'), false)).toBe(true)
    expect(isIgnored(root, join(root, '.git', 'x.md'), true)).toBe(true)
    expect(isIgnored(root, join(root, '.a.md.1f2e3d.tmp'), true)).toBe(true)
  })

  it('does not ignore a library that sits inside a hidden folder', () => {
    const hidden = join('/', 'home', '.config', 'prompts')
    expect(isIgnored(hidden, hidden, false)).toBe(false)
    expect(isIgnored(hidden, join(hidden, 'a.md'), true)).toBe(false)
    expect(isIgnored(hidden, join(hidden, '.git'), false)).toBe(true)
  })

  it('never ignores the folders above the library', () => {
    expect(isIgnored(root, join('/'), false)).toBe(false)
  })
})
