import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore } from './settings'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-settings-'))
  file = join(dir, 'settings.json')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('uses defaults when the file does not exist, without creating it', async () => {
    const settings = await SettingsStore.open(file)
    expect(settings.get().libraryPath).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('defaults the launcher hotkey and launch at login', async () => {
    const settings = await SettingsStore.open(file)
    expect(settings.get().launcherHotkey).toBe('Control+Alt+Space')
    expect(settings.get().launchAtLogin).toBe(false)
  })

  it('persists the launcher settings', async () => {
    const settings = await SettingsStore.open(file)
    await settings.update({ launcherHotkey: 'Control+Alt+K', launchAtLogin: true })
    const reopened = (await SettingsStore.open(file)).get()
    expect(reopened.launcherHotkey).toBe('Control+Alt+K')
    expect(reopened.launchAtLogin).toBe(true)
  })

  it('persists updates and reloads them', async () => {
    const settings = await SettingsStore.open(file)
    await settings.update({ libraryPath: '/Users/me/Prompts' })
    expect(settings.get().libraryPath).toBe('/Users/me/Prompts')
    expect((await SettingsStore.open(file)).get().libraryPath).toBe('/Users/me/Prompts')
  })

  it('keeps keys it does not know about', async () => {
    await writeFile(file, JSON.stringify({ libraryPath: '/a', somethingNew: 'Alt+K' }))
    const settings = await SettingsStore.open(file)
    await settings.update({ libraryPath: '/b' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      libraryPath: '/b',
      somethingNew: 'Alt+K'
    })
  })

  it('moves an unparseable file aside instead of overwriting it', async () => {
    await writeFile(file, '{ not json')
    const settings = await SettingsStore.open(file)
    expect(settings.get().libraryPath).toBeNull()
    const files = await readdir(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^settings\.json\.invalid-\d+$/)
    expect(await readFile(join(dir, files[0] ?? ''), 'utf8')).toBe('{ not json')
  })

  it('moves a file with the wrong shape aside too', async () => {
    await writeFile(file, JSON.stringify({ libraryPath: 42 }))
    const settings = await SettingsStore.open(file)
    expect(settings.get().libraryPath).toBeNull()
    expect((await readdir(dir)).some((f) => f.startsWith('settings.json.invalid-'))).toBe(true)
  })

  it('leaves in-memory settings alone when saving fails', async () => {
    const settings = await SettingsStore.open(join(dir, 'missing-dir', 'settings.json'))
    await expect(settings.update({ libraryPath: '/x' })).rejects.toThrow()
    expect(settings.get().libraryPath).toBeNull()
  })
})
