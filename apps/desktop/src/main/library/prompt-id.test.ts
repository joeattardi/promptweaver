import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { folderOf, idFromPath, isPromptFileName, titleFromId } from './prompt-id'

const root = join('/', 'lib')

describe('idFromPath', () => {
  it('is the relative path without the extension, with / separators', () => {
    expect(idFromPath(root, join(root, 'review.md'))).toBe('review')
    expect(idFromPath(root, join(root, 'code', 'review.md'))).toBe('code/review')
    expect(idFromPath(root, join(root, 'a', 'b', 'c.md'))).toBe('a/b/c')
  })

  it('accepts any case for the extension and keeps dots in names', () => {
    expect(idFromPath(root, join(root, 'NOTES.MD'))).toBe('NOTES')
    expect(idFromPath(root, join(root, 'v1.2 plan.md'))).toBe('v1.2 plan')
  })

  it('rejects other files, hidden files and folders, and the folder itself', () => {
    expect(idFromPath(root, join(root, 'notes.txt'))).toBeNull()
    expect(idFromPath(root, join(root, '.hidden.md'))).toBeNull()
    expect(idFromPath(root, join(root, '.git', 'x.md'))).toBeNull()
    expect(idFromPath(root, join(root, 'ok', '.draft.md'))).toBeNull()
    expect(idFromPath(root, join(root, '.md'))).toBeNull()
    expect(idFromPath(root, root)).toBeNull()
  })

  it('rejects paths outside the library', () => {
    expect(idFromPath(root, join('/', 'other', 'x.md'))).toBeNull()
    expect(idFromPath(root, join(root, '..', 'x.md'))).toBeNull()
    expect(idFromPath(root, join('/', 'libx', 'x.md'))).toBeNull()
  })

  it('works when the library itself is inside a hidden folder', () => {
    const hidden = join('/', 'home', '.config', 'prompts')
    expect(idFromPath(hidden, join(hidden, 'a.md'))).toBe('a')
  })
})

describe('isPromptFileName', () => {
  it('matches .md files that are not dotfiles', () => {
    expect(isPromptFileName('a.md')).toBe(true)
    expect(isPromptFileName('A.MD')).toBe(true)
    expect(isPromptFileName('a.md.tmp')).toBe(false)
    expect(isPromptFileName('.a.md')).toBe(false)
    expect(isPromptFileName('md')).toBe(false)
  })
})

describe('folderOf and titleFromId', () => {
  it('splits the folder from the id', () => {
    expect(folderOf('review')).toBe('')
    expect(folderOf('code/review')).toBe('code')
    expect(folderOf('a/b/c')).toBe('a/b')
  })

  it('makes a title from the file name', () => {
    expect(titleFromId('code-review')).toBe('Code review')
    expect(titleFromId('work/meeting_notes')).toBe('Meeting notes')
    expect(titleFromId('Already Fine')).toBe('Already Fine')
    expect(titleFromId('x')).toBe('X')
    expect(titleFromId('日本語')).toBe('日本語')
    expect(titleFromId('--')).toBe('--')
  })
})
