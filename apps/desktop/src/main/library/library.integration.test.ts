import { mkdir, mkdtemp, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../atomic-write'
import { MiniSearchIndex } from '../search/minisearch-index'
import { Library } from './library'
import { chokidarWatch } from './watcher'

// These use the real file watcher, so they wait for events to arrive.
let dir: string
let library: Library

beforeEach(async () => {
  // realpath: on macOS the temp dir is a symlink, and watcher paths are resolved.
  dir = await realpath(await mkdtemp(join(tmpdir(), 'pw-watch-')))
  library = new Library({ search: new MiniSearchIndex(), watch: chokidarWatch })
})
afterEach(async () => {
  await library.close()
  await rm(dir, { recursive: true, force: true })
})

const prompt = (title: string) => `---\ntitle: ${title}\n---\nBody\n`

async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
const ids = () => library.snapshot().prompts.map((p) => p.id)

describe('Library with the real file watcher', () => {
  it(
    'picks up added, edited, renamed and deleted files, including atomic saves',
    { timeout: 30_000 },
    async () => {
      await writeFile(join(dir, 'a.md'), prompt('Alpha'))
      await library.open(dir)
      expect(ids()).toEqual(['a'])

      // A new file in a new folder.
      await mkdir(join(dir, 'sub'))
      await writeFile(join(dir, 'sub', 'b.md'), prompt('Bravo'))
      await until(() => ids().includes('sub/b'), 'the new file')
      expect(library.search('bravo').map((p) => p.id)).toEqual(['sub/b'])

      // An edit made the way editors do it (temp file, then rename over the original).
      await writeFileAtomic(join(dir, 'a.md'), prompt('Alpha Edited'))
      await until(
        () => library.snapshot().prompts.some((p) => p.title === 'Alpha Edited'),
        'the edit'
      )
      expect(library.search('edited').map((p) => p.id)).toEqual(['a'])

      // A rename.
      await rename(join(dir, 'sub', 'b.md'), join(dir, 'sub', 'renamed.md'))
      await until(() => ids().includes('sub/renamed') && !ids().includes('sub/b'), 'the rename')

      // A delete.
      await unlink(join(dir, 'a.md'))
      await until(() => !ids().includes('a'), 'the delete')
      expect(library.search('alpha')).toEqual([])
      expect(ids()).toEqual(['sub/renamed'])
    }
  )

  it('does not report editor temp files or non-markdown files', { timeout: 30_000 }, async () => {
    await library.open(dir)
    await writeFile(join(dir, 'notes.txt'), 'x')
    await writeFile(join(dir, '.a.md.abc123.tmp'), prompt('Temp'))
    await writeFile(join(dir, 'real.md'), prompt('Real'))
    await until(() => ids().includes('real'), 'the real file')
    expect(ids()).toEqual(['real'])
  })

  it('works for a library inside a hidden folder', { timeout: 30_000 }, async () => {
    const hidden = join(dir, '.config', 'prompts')
    await mkdir(hidden, { recursive: true })
    await library.open(hidden)
    await writeFile(join(hidden, 'a.md'), prompt('Alpha'))
    await until(() => ids().includes('a'), 'a file in a hidden-folder library')
  })
})
