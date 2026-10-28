import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Library } from './library/library'
import { fakeWatcher } from './library/fake-watcher'
import { LibraryService } from './library-service'
import { MiniSearchIndex } from './search/minisearch-index'
import { SettingsStore } from './settings'
import { STARTER_PROMPTS } from './starters'

let root: string
let defaultPath: string
let settingsPath: string
let picked: string | null
let watcher: ReturnType<typeof fakeWatcher>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pw-service-'))
  defaultPath = join(root, 'Documents', 'Promptweaver')
  settingsPath = join(root, 'settings.json')
  picked = null
  watcher = fakeWatcher()
})
afterEach(() => rm(root, { recursive: true, force: true }))

const libraries: Library[] = []
async function createService() {
  const settings = await SettingsStore.open(settingsPath)
  const library = new Library({
    search: new MiniSearchIndex(),
    watch: watcher.factory,
    debounceMs: 0
  })
  libraries.push(library)
  const service = new LibraryService({
    settings,
    library,
    defaultPath,
    pickFolder: async () => picked
  })
  return { service, settings, library }
}
afterEach(async () => {
  await Promise.all(libraries.splice(0).map((l) => l.close()))
})

async function folderWith(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(root, name)
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await writeFile(join(dir, rel), content)
  }
  await mkdir(dir, { recursive: true })
  return dir
}
const prompt = (title: string) => `---\ntitle: ${title}\n---\nBody\n`

describe('first run', () => {
  it('starts unconfigured and creates nothing on disk', async () => {
    const { service } = await createService()
    await service.start()
    expect(service.state()).toMatchObject({ status: 'unconfigured', defaultPath })
    expect(await readdir(root)).toEqual([])
  })

  it('creates the default library with the starter prompts and remembers it', async () => {
    const { service } = await createService()
    await service.start()
    const result = await service.createDefault()

    expect(result.error).toBeNull()
    expect(result.state.status).toBe('ready')
    if (result.state.status !== 'ready') return
    expect(result.state.path).toBe(defaultPath)
    expect(result.state.prompts).toHaveLength(STARTER_PROMPTS.length)
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ libraryPath: defaultPath })

    // A fresh start finds the same library.
    const next = await createService()
    await next.service.start()
    expect(next.service.state()).toMatchObject({ status: 'ready', path: defaultPath })
  })

  it('uses an existing default folder as it is when it already has prompts', async () => {
    await folderWith('Documents/Promptweaver', { 'mine.md': prompt('Mine') })
    const { service } = await createService()
    await service.start()
    const { state } = await service.createDefault()
    expect(state.status === 'ready' && state.prompts.map((p) => p.id)).toEqual(['mine'])
    expect(await readdir(defaultPath)).toEqual(['mine.md'])
  })

  it('fills an existing but empty default folder with the starters', async () => {
    await mkdir(defaultPath, { recursive: true })
    const { service } = await createService()
    await service.start()
    const { state } = await service.createDefault()
    expect(state.status === 'ready' && state.prompts).toHaveLength(STARTER_PROMPTS.length)
  })

  it('reports a failure to create the folder and stays unconfigured', async () => {
    await writeFile(join(root, 'Documents'), 'a file where a folder should be')
    const { service } = await createService()
    await service.start()
    const result = await service.createDefault()
    expect(result.error).toMatch(/Couldn't create .*Promptweaver/)
    expect(result.state.status).toBe('unconfigured')
    await expect(readFile(settingsPath, 'utf8')).rejects.toThrow()
  })
})

describe('choosing a folder', () => {
  it('opens the picked folder without touching its files, and remembers it', async () => {
    const mine = await folderWith('mine', { 'a.md': prompt('A'), 'sub/b.md': prompt('B') })
    picked = mine
    const { service } = await createService()
    await service.start()
    const result = await service.chooseFolder()
    expect(result.error).toBeNull()
    expect(result.state.status === 'ready' && result.state.prompts.map((p) => p.id)).toEqual([
      'a',
      'sub/b'
    ])
    expect(await readdir(mine)).toEqual(['a.md', 'sub'])
    expect(JSON.parse(await readFile(settingsPath, 'utf8')).libraryPath).toBe(mine)
  })

  it('does nothing when the picker is cancelled', async () => {
    const mine = await folderWith('mine', { 'a.md': prompt('A') })
    picked = mine
    const { service } = await createService()
    await service.start()
    await service.chooseFolder()
    picked = null
    const result = await service.chooseFolder()
    expect(result.error).toBeNull()
    expect(result.state).toMatchObject({ status: 'ready', path: mine })
  })

  it('opens an empty folder as an empty library', async () => {
    picked = await folderWith('empty', {})
    const { service } = await createService()
    await service.start()
    const { state } = await service.chooseFolder()
    expect(state).toMatchObject({ status: 'ready', prompts: [], problems: [] })
  })

  it('keeps the previous library, and its setting, when the new folder cannot be opened', async () => {
    const mine = await folderWith('mine', { 'a.md': prompt('A') })
    picked = mine
    const { service } = await createService()
    await service.start()
    await service.chooseFolder()

    picked = join(root, 'does-not-exist')
    const result = await service.chooseFolder()
    expect(result.error).toMatch(/Couldn't open .*does-not-exist.*does not exist/)
    expect(result.state).toMatchObject({ status: 'ready', path: mine })
    expect(result.state.status === 'ready' && result.state.prompts.map((p) => p.id)).toEqual(['a'])
    expect(JSON.parse(await readFile(settingsPath, 'utf8')).libraryPath).toBe(mine)
  })

  it('stays unconfigured when the very first pick fails', async () => {
    picked = join(root, 'nope')
    const { service } = await createService()
    await service.start()
    const result = await service.chooseFolder()
    expect(result.error).toMatch(/Couldn't open/)
    expect(result.state.status).toBe('unconfigured')
  })
})

describe('a saved library that has gone away', () => {
  it('reports an error state with the path and a reason, and recovers once a folder is chosen', async () => {
    await writeFile(settingsPath, JSON.stringify({ libraryPath: join(root, 'unplugged') }))
    const { service } = await createService()
    await service.start()
    expect(service.state()).toMatchObject({
      status: 'error',
      path: join(root, 'unplugged'),
      message: expect.stringContaining('does not exist')
    })

    picked = await folderWith('new', { 'a.md': prompt('A') })
    const { state } = await service.chooseFolder()
    expect(state).toMatchObject({ status: 'ready', path: picked })
  })

  it('keeps the saved setting, so the library returns when the folder does', async () => {
    const gone = join(root, 'unplugged')
    await writeFile(settingsPath, JSON.stringify({ libraryPath: gone }))
    const first = await createService()
    await first.service.start()
    expect(first.service.state().status).toBe('error')
    await folderWith('unplugged', { 'a.md': prompt('A') })
    const second = await createService()
    await second.service.start()
    expect(second.service.state()).toMatchObject({ status: 'ready', path: gone })
  })

  it('reports an error if the folder vanishes while running', async () => {
    const mine = await folderWith('mine', { 'a.md': prompt('A') })
    picked = mine
    const { service } = await createService()
    await service.start()
    await service.chooseFolder()
    await rm(mine, { recursive: true })
    watcher.emit({ type: 'unlink', path: join(mine, 'a.md') })
    await vi.waitFor(() => expect(service.state().status).toBe('error'))
    expect(service.state()).toMatchObject({ status: 'error', path: mine })
  })

  it('keeps the saved folder when re-picking it fails', async () => {
    const gone = join(root, 'unplugged')
    await writeFile(settingsPath, JSON.stringify({ libraryPath: gone }))
    const { service } = await createService()
    await service.start()
    picked = gone
    const result = await service.chooseFolder()
    expect(result.error).toMatch(/does not exist/)
    expect(result.state).toMatchObject({
      status: 'error',
      message: expect.stringContaining('does not exist')
    })
  })
})

describe('adding starter prompts', () => {
  it('adds missing starters, and never overwrites a file the user edited', async () => {
    picked = await folderWith('mine', { 'code/code-review.md': 'my own version' })
    const { service } = await createService()
    await service.start()
    await service.chooseFolder()
    const result = await service.addStarters()
    expect(result.error).toBeNull()
    expect(result.state.status === 'ready' && result.state.prompts).toHaveLength(
      STARTER_PROMPTS.length
    )
    expect(await readFile(join(picked, 'code', 'code-review.md'), 'utf8')).toBe('my own version')
  })

  it('needs a library first', async () => {
    const { service } = await createService()
    await service.start()
    const result = await service.addStarters()
    expect(result.error).toBe('Choose a library folder first.')
    expect(result.state.status).toBe('unconfigured')
  })
})

describe('reading and searching', () => {
  it('serves details and search results from the open library', async () => {
    picked = await folderWith('mine', {
      'review.md': '---\ntitle: Code Review\naliases: [cr]\n---\nReview {{code}}\n',
      'other.md': prompt('Other')
    })
    const { service } = await createService()
    await service.start()
    await service.chooseFolder()
    expect(service.search('cr').map((p) => p.id)).toEqual(['review'])
    expect(service.detail('review')?.form.fields.map((f) => f.id)).toEqual(['code'])
    expect(service.detail('missing')).toBeNull()
    expect(service.search('')).toEqual([])
  })

  it('whenReady resolves after the saved library loads', async () => {
    const mine = await folderWith('mine', { 'a.md': prompt('A') })
    await writeFile(settingsPath, JSON.stringify({ libraryPath: mine }))
    const { service } = await createService()
    void service.start()
    await service.whenReady()
    expect(service.state()).toMatchObject({ status: 'ready' })
  })
})

describe('change notifications', () => {
  it('notifies on file changes and on actions, with a rising version', async () => {
    const mine = await folderWith('mine', { 'a.md': prompt('A') })
    picked = mine
    const { service, library } = await createService()
    await service.start()
    const listener = vi.fn()
    service.onChange(listener)
    const before = service.version

    await service.chooseFolder()
    expect(listener).toHaveBeenCalled()
    const afterAction = service.version
    expect(afterAction).toBeGreaterThan(before)

    await writeFile(join(mine, 'b.md'), prompt('B'))
    watcher.emit({ type: 'add', path: join(mine, 'b.md') })
    await library.settled()
    expect(service.version).toBeGreaterThan(afterAction)
    expect(service.state().status === 'ready' && service.state()).toMatchObject({
      prompts: [{ id: 'a' }, { id: 'b' }]
    })
  })
})
