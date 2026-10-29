import { vi } from 'vitest'
import { formFor, parse, type FormModel } from 'prompt-lang'
import type { PromptDetail, RendererApi, SettingsView } from '../../../shared/ipc'

export const REVIEW = `---
title: Code Review
description: Review a change
fields:
  language: { type: select, options: [TypeScript, Python, Go] }
  focus: { type: multiselect, options: [Bugs, Performance, Security], default: [Bugs] }
  tone:
    type: select
    options:
      Gentle: Be encouraging.
      Blunt: Be direct.
  strict: { type: toggle }
  count: { type: number, min: 1, max: 5 }
  note: { type: text, help: Anything else? }
  code: { type: textarea, required: true, from: clipboard }
---
You are a {{language}} reviewer. {{tone}}
{{if focus}}
Focus on: {{focus}}.
{{end}}
Strict: {{strict}} ({{count}}) {{note}}
{{code}}
Clipboard: {{clipboard}}
`

export function formOf(text: string): FormModel {
  return formFor(parse(text))
}

/** A prompt as the main process would send it, built from its file text. */
export function detailOf(text: string, id = 'review', errorCount = 0): PromptDetail {
  const parsed = parse(text)
  return {
    summary: {
      id,
      folder: '',
      title: parsed.frontmatter?.title ?? id,
      description: '',
      tags: [],
      aliases: [],
      conflictingAliases: [],
      errorCount,
      warningCount: 0
    },
    source: text,
    body: text.slice(parsed.body.range.from),
    diagnostics: [],
    form: formFor(parsed)
  }
}

export function settingsView(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    launcherHotkey: 'Control+Alt+Space',
    defaultLauncherHotkey: 'Control+Alt+Space',
    hotkey: { registered: true, error: null },
    launchAtLogin: false,
    launchAtLoginAvailable: true,
    platform: 'darwin',
    ...overrides
  }
}

type ApiMocks = { [K in keyof RendererApi]: ReturnType<typeof vi.fn<RendererApi[K]>> }

/** Installs a fake `window.api` whose methods are spies with harmless defaults. */
export function installApi(overrides: Partial<RendererApi> = {}): ApiMocks {
  const api = {
    getAppInfo: vi.fn<RendererApi['getAppInfo']>(async () => ({
      name: 'Promptweaver',
      version: '0',
      platform: 'darwin'
    })),
    getLibraryState: vi.fn<RendererApi['getLibraryState']>(async () => ({
      status: 'unconfigured',
      revision: 1,
      defaultPath: '/Users/me/Documents/Promptweaver'
    })),
    chooseLibraryFolder: vi.fn<RendererApi['chooseLibraryFolder']>(),
    createDefaultLibrary: vi.fn<RendererApi['createDefaultLibrary']>(),
    addStarterPrompts: vi.fn<RendererApi['addStarterPrompts']>(),
    getPrompt: vi.fn<RendererApi['getPrompt']>(async () => null),
    searchPrompts: vi.fn<RendererApi['searchPrompts']>(async () => []),
    openFill: vi.fn<RendererApi['openFill']>(async () => ({ remembered: {}, clipboard: '' })),
    readClipboard: vi.fn<RendererApi['readClipboard']>(async () => ''),
    copyPrompt: vi.fn<RendererApi['copyPrompt']>(async () => ({ status: 'copied' })),
    takePendingAction: vi.fn<RendererApi['takePendingAction']>(async () => ({})),
    newPromptFromClipboard: vi.fn<RendererApi['newPromptFromClipboard']>(async () => ({
      status: 'empty'
    })),
    getFavorites: vi.fn<RendererApi['getFavorites']>(async () => []),
    toggleFavorite: vi.fn<RendererApi['toggleFavorite']>(async () => []),
    getSettings: vi.fn<RendererApi['getSettings']>(async () => settingsView()),
    setLauncherHotkey: vi.fn<RendererApi['setLauncherHotkey']>(async () => ({
      ok: true,
      warning: null,
      settings: settingsView()
    })),
    setLaunchAtLogin: vi.fn<RendererApi['setLaunchAtLogin']>(async () => settingsView()),
    hideLauncher: vi.fn<RendererApi['hideLauncher']>(async () => undefined),
    resizeLauncher: vi.fn<RendererApi['resizeLauncher']>(async () => undefined),
    openInMainWindow: vi.fn<RendererApi['openInMainWindow']>(async () => undefined),
    openMainWindow: vi.fn<RendererApi['openMainWindow']>(async () => undefined),
    reportLauncherPaint: vi.fn<RendererApi['reportLauncherPaint']>(async () => undefined),
    onLibraryChanged: vi.fn<RendererApi['onLibraryChanged']>(() => () => undefined),
    onLauncherSummon: vi.fn<RendererApi['onLauncherSummon']>(() => () => undefined),
    onLauncherSuggestions: vi.fn<RendererApi['onLauncherSuggestions']>(() => () => undefined),
    onLauncherShown: vi.fn<RendererApi['onLauncherShown']>(() => () => undefined),
    onLauncherHidden: vi.fn<RendererApi['onLauncherHidden']>(() => () => undefined),
    onFavoritesChanged: vi.fn<RendererApi['onFavoritesChanged']>(() => () => undefined),
    onSettingsChanged: vi.fn<RendererApi['onSettingsChanged']>(() => () => undefined),
    onOpenSettings: vi.fn<RendererApi['onOpenSettings']>(() => () => undefined),
    onSelectPrompt: vi.fn<RendererApi['onSelectPrompt']>(() => () => undefined),
    onNotice: vi.fn<RendererApi['onNotice']>(() => () => undefined),
    ...Object.fromEntries(
      Object.entries(overrides).map(([name, fn]) => [
        name,
        vi.fn(fn as (...args: never[]) => unknown)
      ])
    )
  } as ApiMocks
  window.api = api as unknown as RendererApi
  return api
}
