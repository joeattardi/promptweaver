import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MiniSearchIndex } from '../search/minisearch-index'
import { Library, LibraryError } from './library'
import { MAX_PROMPT_BYTES } from './scan'
import type { FileEvent, WatchFactory, WatchListener } from './watcher'

/** A watcher that does nothing until the test fires events. */
function fakeWatcher() {
  const listeners: WatchListener[] = []
  const closed: boolean[] = []
  const factory: WatchFactory = async (_root, listener) => {
    const index = listeners.push(listener) - 1
    closed[index] = false
    return {
      close: async () => {
        closed[index] = true
      }
    }
  }
  return {
    factory,
    closed,
    emit: (event: FileEvent, which = listeners.length - 1) => listeners[which]?.onEvent(event)
  }
}

let dir: string
let library: Library
let watcher: ReturnType<typeof fakeWatcher>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-library-'))
  watcher = fakeWatcher()
  library = new Library({ search: new MiniSearchIndex(), watch: watcher.factory, debounceMs: 0 })
})
afterEach(async () => {
  await library.close()
  await rm(dir, { recursive: true, force: true })
})

const path = (rel: string) => join(dir, rel)
async function write(rel: string, content: string) {
  await mkdir(join(path(rel), '..'), { recursive: true })
  await writeFile(path(rel), content)
}
const prompt = (title: string, extra = '', body = 'Body') =>
  `---\ntitle: ${title}\n${extra}---\n${body}\n`
const ids = () => library.snapshot().prompts.map((p) => p.id)
async function fire(type: FileEvent['type'], rel: string) {
  watcher.emit({ type, path: path(rel) })
  await library.settled()
}

describe('open', () => {
  it('lists prompts from nested folders by relative id', async () => {
    await write('summarize.md', prompt('Summarize'))
    await write('code/review.md', prompt('Code Review'))
    await write('code/deep/refactor.md', prompt('Refactor'))
    await library.open(dir)
    expect(ids()).toEqual(['summarize', 'code/review', 'code/deep/refactor'])
    expect(library.snapshot().prompts.map((p) => p.folder)).toEqual(['', 'code', 'code/deep'])
    expect(library.path).toBe(dir)
    expect(library.error).toBeNull()
  })

  it('ignores non-markdown files, dotfiles and hidden folders', async () => {
    await write('ok.md', prompt('OK'))
    await write('notes.txt', 'text')
    await write('.hidden.md', prompt('Hidden'))
    await write('.git/x.md', prompt('Git'))
    await library.open(dir)
    expect(ids()).toEqual(['ok'])
  })

  it('works for a library inside a hidden folder', async () => {
    await write('.lib/a.md', prompt('A'))
    await library.open(path('.lib'))
    expect(ids()).toEqual(['a'])
  })

  it('opens an empty folder', async () => {
    await library.open(dir)
    expect(library.snapshot()).toEqual({ prompts: [], problems: [], aliasConflicts: [] })
  })

  it('rejects a missing folder or a file with a message fit for the user', async () => {
    await expect(library.open(path('nope'))).rejects.toThrow(LibraryError)
    await expect(library.open(path('nope'))).rejects.toThrow('does not exist')
    await write('file.md', 'x')
    await expect(library.open(path('file.md'))).rejects.toThrow('not a folder')
    expect(library.path).toBeNull()
  })

  it('rejects when the watcher cannot start, and does not leave the folder open', async () => {
    const failing = new Library({
      search: new MiniSearchIndex(),
      watch: () => Promise.reject(new Error('ENOSPC: system limit for file watchers')),
      debounceMs: 0
    })
    await expect(failing.open(dir)).rejects.toThrow(/Can't watch this folder/)
    expect(failing.path).toBeNull()
  })

  it('replaces the previous library, closes its watcher and ignores its late events', async () => {
    const other = await mkdtemp(join(tmpdir(), 'pw-library-b-'))
    try {
      await write('a.md', prompt('A'))
      await writeFile(join(other, 'b.md'), prompt('B'))
      await library.open(dir)
      await library.open(other)
      expect(ids()).toEqual(['b'])
      expect(watcher.closed).toEqual([true, false])

      const listener = vi.fn()
      library.onChange(listener)
      await write('late.md', prompt('Late'))
      watcher.emit({ type: 'add', path: path('late.md') }, 0) // from the old watcher
      await library.settled()
      expect(ids()).toEqual(['b'])
      expect(listener).not.toHaveBeenCalled()
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})

describe('summaries', () => {
  it('uses the frontmatter fields and counts problems', async () => {
    await write(
      'review.md',
      '---\ntitle: Code Review\ndescription: Review code\ntags: [code]\naliases: [cr, rv]\nfields:\n  unused: { type: text }\n---\nHi {{topic}}\n{{if x}}\n'
    )
    await library.open(dir)
    expect(library.snapshot().prompts[0]).toEqual({
      id: 'review',
      folder: '',
      title: 'Code Review',
      description: 'Review code',
      tags: ['code'],
      aliases: ['cr', 'rv'],
      conflictingAliases: [],
      errorCount: 1, // unclosed {{if}}
      warningCount: 1 // unused field
    })
  })

  it('falls back to the file name when there is no usable title', async () => {
    await write('quick-note.md', 'Summarize {{topic}}')
    await write('no_title.md', '---\ndescription: x\n---\nBody')
    await write('blank.md', '---\ntitle: "  "\n---\nBody')
    await library.open(dir)
    expect(library.snapshot().prompts.map((p) => p.title)).toEqual([
      'Blank',
      'No title',
      'Quick note'
    ])
  })

  it('still lists files whose frontmatter is broken, flagged with errors', async () => {
    await write('broken.md', '---\ntitle: [oops\n---\nBody')
    await library.open(dir)
    const [broken] = library.snapshot().prompts
    expect(broken?.title).toBe('Broken')
    expect(broken?.errorCount).toBeGreaterThan(0)
  })

  it('sorts top-level prompts first, then folders, with natural ordering of titles', async () => {
    await write('z-top.md', prompt('Zed'))
    await write('b/two.md', prompt('Step 10'))
    await write('b/one.md', prompt('Step 2'))
    await write('a/x.md', prompt('X'))
    await library.open(dir)
    expect(ids()).toEqual(['z-top', 'a/x', 'b/one', 'b/two'])
  })
})

describe('detail', () => {
  it('returns the body, diagnostics with line numbers, and the form', async () => {
    await write(
      'greet.md',
      '---\ntitle: Greet\nfields:\n  name: { type: text, required: true }\n---\nHello {{name}}\n\n{{if}}\nbye {{other}}\n'
    )
    await library.open(dir)
    const detail = library.detail('greet')
    expect(detail?.body).toBe('Hello {{name}}\n\n{{if}}\nbye {{other}}\n')
    expect(detail?.summary.title).toBe('Greet')
    expect(detail?.form.fields.map((f) => [f.id, f.type, f.required, f.implicit])).toEqual([
      ['name', 'text', true, false],
      ['other', 'text', true, true]
    ])
    expect(detail?.diagnostics.map((d) => [d.code, d.severity, d.line])).toEqual([
      ['malformed-block-tag', 'error', 8],
      ['unclosed-block', 'error', 8],
      ['undeclared-placeholder', 'info', 9]
    ])
  })

  it('works for a file with no frontmatter and for unknown ids', async () => {
    await write('plain.md', 'Summarize {{topic}}')
    await library.open(dir)
    const detail = library.detail('plain')
    expect(detail?.body).toBe('Summarize {{topic}}')
    expect(detail?.form.fields.map((f) => f.id)).toEqual(['topic'])
    expect(library.detail('nope')).toBeNull()
  })
})

describe('search', () => {
  beforeEach(async () => {
    await write(
      'code/review.md',
      prompt(
        'Code Review',
        'aliases: [cr]\ntags: [code]\n',
        'Check the {{language}} code.\n{{if strict}}\nBe strict.\n{{else}}\nBe kind.\n{{end}}'
      )
    )
    await write('crud.md', prompt('CRUD endpoints', '', 'Design REST endpoints'))
    await write(
      'summarize.md',
      prompt('Summarize', 'description: Make it shorter\n', 'Condense {{text}}')
    )
    await library.open(dir)
  })

  it('returns summaries, best match first', () => {
    expect(library.search('summ').map((p) => p.id)).toEqual(['summarize'])
    expect(library.search('shorter')[0]?.title).toBe('Summarize')
  })

  it('puts an exact alias match first', () => {
    expect(library.search('cr')[0]?.id).toBe('code/review')
    expect(library.search('CR').map((p) => p.id)).toEqual(['code/review', 'crud'])
  })

  it('searches the template text and placeholder names, but not the tag syntax', () => {
    expect(library.search('condense').map((p) => p.id)).toEqual(['summarize'])
    expect(library.search('language').map((p) => p.id)).toEqual(['code/review'])
    expect(library.search('strict').map((p) => p.id)).toEqual(['code/review'])
    // Code Review has {{if}}, {{else}} and {{end}}, but those aren't indexed.
    expect(library.search('else')).toEqual([])
    expect(library.search('if')).toEqual([])
    expect(library.search('end').map((p) => p.id)).toEqual(['crud']) // "endpoints", not {{end}}
  })

  it('returns nothing for an empty query and respects the limit', () => {
    expect(library.search('')).toEqual([])
    expect(library.search('e', 1)).toHaveLength(1)
  })
})

describe('alias conflicts', () => {
  it('flags every prompt sharing an alias, case-insensitively, and clears when resolved', async () => {
    await write('a.md', prompt('A', 'aliases: [cr, only-a]\n'))
    await write('b.md', prompt('B', 'aliases: [CR]\n'))
    await write('c.md', prompt('C', 'aliases: [other]\n'))
    await library.open(dir)

    const { prompts, aliasConflicts } = library.snapshot()
    expect(aliasConflicts).toEqual([{ alias: 'cr', ids: ['a', 'b'] }])
    expect(prompts.map((p) => [p.id, p.conflictingAliases])).toEqual([
      ['a', ['cr']],
      ['b', ['CR']],
      ['c', []]
    ])
    expect(library.search('cr').map((p) => p.id)).toEqual(['a', 'b'])

    await write('b.md', prompt('B', 'aliases: [bb]\n'))
    await fire('change', 'b.md')
    expect(library.snapshot().aliasConflicts).toEqual([])
    expect(library.snapshot().prompts.every((p) => p.conflictingAliases.length === 0)).toBe(true)
  })

  it('does not count one prompt listing the same alias twice as a conflict', async () => {
    await write('a.md', prompt('A', 'aliases: [cr, CR]\n'))
    await library.open(dir)
    expect(library.snapshot().aliasConflicts).toEqual([])
  })
})

describe('file events', () => {
  beforeEach(async () => {
    await write('a.md', prompt('Alpha'))
    await library.open(dir)
  })

  it('adds new files to the list and the search index', async () => {
    await write('sub/new.md', prompt('Brand New'))
    await fire('add', 'sub/new.md')
    expect(ids()).toEqual(['a', 'sub/new'])
    expect(library.search('brand').map((p) => p.id)).toEqual(['sub/new'])
  })

  it('updates changed files', async () => {
    await write('a.md', prompt('Renamed', 'aliases: [rn]\n'))
    await fire('change', 'a.md')
    expect(library.snapshot().prompts[0]?.title).toBe('Renamed')
    expect(library.search('alpha')).toEqual([])
    expect(library.search('rn')[0]?.id).toBe('a')
  })

  it('removes deleted files', async () => {
    await unlink(path('a.md'))
    await fire('unlink', 'a.md')
    expect(ids()).toEqual([])
    expect(library.search('alpha')).toEqual([])
    expect(library.detail('a')).toBeNull()
  })

  it('treats a rename as a remove plus an add', async () => {
    await unlink(path('a.md'))
    await write('b.md', prompt('Alpha'))
    watcher.emit({ type: 'unlink', path: path('a.md') })
    watcher.emit({ type: 'add', path: path('b.md') })
    await library.settled()
    expect(ids()).toEqual(['b'])
  })

  it('applies a burst of events as one change', async () => {
    const listener = vi.fn()
    library.onChange(listener)
    await write('b.md', prompt('B'))
    await write('c.md', prompt('C'))
    watcher.emit({ type: 'add', path: path('b.md') })
    watcher.emit({ type: 'add', path: path('c.md') })
    watcher.emit({ type: 'change', path: path('b.md') })
    await library.settled()
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('bumps the version only when something actually changed', async () => {
    const listener = vi.fn()
    library.onChange(listener)
    const before = library.version
    await fire('change', 'a.md') // same content
    await fire('unlink', 'never-existed.md') // nothing to remove
    expect(library.version).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    await write('a.md', prompt('Different'))
    await fire('change', 'a.md')
    expect(library.version).toBe(before + 1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe', async () => {
    const listener = vi.fn()
    const off = library.onChange(listener)
    off()
    await write('b.md', prompt('B'))
    await fire('add', 'b.md')
    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores events for files that are not prompts', async () => {
    const listener = vi.fn()
    library.onChange(listener)
    await write('notes.txt', 'x')
    await write('.hidden.md', prompt('H'))
    await fire('add', 'notes.txt')
    await fire('add', '.hidden.md')
    expect(ids()).toEqual(['a'])
    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores events after close', async () => {
    await library.close()
    await write('b.md', prompt('B'))
    watcher.emit({ type: 'add', path: path('b.md') })
    await library.settled()
    expect(library.snapshot().prompts).toEqual([])
  })
})

describe('files that cannot be read', () => {
  it('lists them as problems and not as prompts', async () => {
    await write('good.md', prompt('Good'))
    await write('big.md', 'x'.repeat(MAX_PROMPT_BYTES + 1))
    await writeFile(path('binary.md'), Buffer.from([0x68, 0xff, 0xfe]))
    await library.open(dir)
    const { prompts, problems } = library.snapshot()
    expect(prompts.map((p) => p.id)).toEqual(['good'])
    expect(problems.map((p) => [p.file, p.message])).toEqual([
      ['big.md', expect.stringMatching(/^Too large/)],
      ['binary.md', 'Not valid UTF-8 text.']
    ])
  })

  it('clears the problem once the file is fixed, and flags a file that breaks', async () => {
    await write('a.md', prompt('Alpha'))
    await write('bad.md', 'x'.repeat(MAX_PROMPT_BYTES + 1))
    await library.open(dir)

    await write('bad.md', prompt('Fixed'))
    await fire('change', 'bad.md')
    expect(library.snapshot().problems).toEqual([])
    expect(ids()).toEqual(['a', 'bad'])

    await write('a.md', 'x'.repeat(MAX_PROMPT_BYTES + 1))
    await fire('change', 'a.md')
    expect(ids()).toEqual(['bad'])
    expect(library.snapshot().problems.map((p) => p.file)).toEqual(['a.md'])
    expect(library.search('alpha')).toEqual([])
  })

  it('clears a problem when its file is deleted', async () => {
    await write('bad.md', 'x'.repeat(MAX_PROMPT_BYTES + 1))
    await library.open(dir)
    await unlink(path('bad.md'))
    await fire('unlink', 'bad.md')
    expect(library.snapshot().problems).toEqual([])
  })
})

describe('the folder disappearing', () => {
  it('reports an error and empties the library instead of showing stale prompts', async () => {
    await write('a.md', prompt('Alpha'))
    await library.open(dir)
    const listener = vi.fn()
    library.onChange(listener)

    await rm(dir, { recursive: true, force: true })
    await fire('unlink', 'a.md')

    expect(library.error).toMatch(/missing/)
    expect(library.snapshot().prompts).toEqual([])
    expect(library.search('alpha')).toEqual([])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('clears the error when a library is opened again', async () => {
    await write('a.md', prompt('Alpha'))
    await library.open(dir)
    await rm(dir, { recursive: true, force: true })
    await fire('unlink', 'a.md')
    await mkdir(dir)
    await library.open(dir)
    expect(library.error).toBeNull()
  })
})

describe('large libraries', () => {
  it('loads many files, in batches', async () => {
    await Promise.all(
      Array.from({ length: 300 }, (_, i) => write(`f${i % 5}/p${i}.md`, prompt(`Prompt ${i}`)))
    )
    await library.open(dir)
    expect(ids()).toHaveLength(300)
    expect(library.search('prompt 299')[0]?.id).toBe('f4/p299')
  })
})
