import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LauncherSuggestions, LauncherSummon, PromptSummary } from '../../../shared/ipc'
import { detailOf, installApi, REVIEW } from '../test/helpers'
import { App } from './App'
import { COPIED_FLASH_MS } from './useLauncher'

const PLAIN = '---\ntitle: Plain Note\naliases: [pn]\n---\nJust text.\n'
const NEEDS_CODE =
  '---\ntitle: Needs Code\nfields:\n  code: { type: textarea, required: true }\n---\n{{code}}\n'

function prompt(
  id: string,
  title: string,
  aliases: string[] = [],
  description = ''
): PromptSummary {
  return {
    id,
    folder: '',
    title,
    description,
    tags: [],
    aliases,
    conflictingAliases: [],
    errorCount: 0,
    warningCount: 0
  }
}

const REVIEW_PROMPT = prompt('review', 'Code Review', ['cr'], 'Review a change')
const PLAIN_PROMPT = prompt('plain', 'Plain Note', ['pn'], 'A fixed prompt')
const CODE_PROMPT = prompt('needs-code', 'Needs Code')

const SUGGESTIONS: LauncherSuggestions = {
  status: 'ready',
  favoriteIds: ['plain'],
  groups: [
    { kind: 'favorites', prompts: [PLAIN_PROMPT] },
    { kind: 'recent', prompts: [REVIEW_PROMPT] },
    { kind: 'all', prompts: [CODE_PROMPT] }
  ]
}

const DETAILS = {
  review: detailOf(REVIEW, 'review'),
  plain: detailOf(PLAIN, 'plain'),
  'needs-code': detailOf(NEEDS_CODE, 'needs-code')
}

/** The launcher with a fake main process: tests send it a summon the way the hotkey would. */
function setup(overrides: Parameters<typeof installApi>[0] = {}) {
  // More than one part of the page listens for each message, as in the real thing.
  const summonListeners = new Set<(message: LauncherSummon) => void>()
  const hiddenListeners = new Set<() => void>()
  const shownListeners = new Set<() => void>()
  const suggestionListeners = new Set<(s: LauncherSuggestions) => void>()
  const subscribe = <T,>(set: Set<T>) => {
    return (listener: T) => {
      set.add(listener)
      return () => void set.delete(listener)
    }
  }
  const api = installApi({
    onLauncherSummon: subscribe(summonListeners),
    onLauncherHidden: subscribe(hiddenListeners),
    onLauncherShown: subscribe(shownListeners),
    onLauncherSuggestions: subscribe(suggestionListeners),
    searchPrompts: async (query) =>
      [REVIEW_PROMPT, PLAIN_PROMPT, CODE_PROMPT].filter(
        (p) => p.aliases.includes(query) || p.title.toLowerCase().includes(query.toLowerCase())
      ),
    getPrompt: async (id) => DETAILS[id as keyof typeof DETAILS] ?? null,
    ...overrides
  })
  const user = userEvent.setup()
  render(<App />)
  return {
    api,
    user,
    summon: (message: Partial<LauncherSummon> = {}) =>
      act(() => {
        const full = {
          clipboard: 'on the clipboard',
          suggestions: SUGGESTIONS,
          pressedAt: null,
          ...message
        }
        summonListeners.forEach((listener) => listener(full))
      }),
    hide: () => act(() => hiddenListeners.forEach((listener) => listener())),
    shown: () => act(() => shownListeners.forEach((listener) => listener())),
    pushSuggestions: (s: LauncherSuggestions) =>
      act(() => suggestionListeners.forEach((listener) => listener(s)))
  }
}

const search = () => screen.getByRole('combobox', { name: 'Search prompts' })
const optionNames = () => screen.queryAllByRole('option').map((o) => o.getAttribute('aria-label'))
const ctrl = (key: string) => `{Control>}${key}{/Control}`

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('launcher: finding a prompt', () => {
  it('shows favorites, then recents, then the rest, with the box focused', async () => {
    const { summon } = setup()
    await summon()
    expect(search()).toHaveFocus()
    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('All prompts')).toBeInTheDocument()
    expect(optionNames()).toEqual([
      'Plain Note, favorite',
      'Code Review',
      'Needs Code',
      'New prompt from clipboard'
    ])
  })

  it('previews what the new-prompt row would save', async () => {
    const { summon } = setup()
    await summon({ clipboard: '  Summarize this\nplease' })
    expect(screen.getByRole('option', { name: 'New prompt from clipboard' })).toHaveTextContent(
      'Summarize this'
    )
  })

  it('puts the exact alias match first when typing it', async () => {
    const { summon, user, api } = setup()
    await summon()
    await user.type(search(), 'cr')
    await waitFor(() => expect(api.searchPrompts).toHaveBeenLastCalledWith('cr'))
    await waitFor(() => expect(optionNames()[0]).toBe('Code Review'))
    expect(screen.getByRole('option', { name: 'Code Review' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('moves the highlight with the arrow keys and stops at the ends', async () => {
    const { summon, user } = setup()
    await summon()
    const selected = () =>
      screen.getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected()).toBe(0)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(selected()).toBe(2)
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(selected()).toBe(3)
    await user.keyboard('{ArrowUp}')
    expect(selected()).toBe(2)
    expect(search()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]?.id)
  })

  it('says when nothing matches', async () => {
    const { summon, user } = setup()
    await summon()
    await user.type(search(), 'zzz')
    expect(await screen.findByText('No prompts match “zzz”.')).toBeInTheDocument()
  })

  it('uses the answer to the latest search even if an earlier one is slower', async () => {
    let resolveFirst: (value: PromptSummary[]) => void = () => undefined
    const searchPrompts = vi.fn(async (query: string) =>
      query === 'c'
        ? new Promise<PromptSummary[]>((resolve) => (resolveFirst = resolve))
        : [REVIEW_PROMPT]
    )
    const { summon, user } = setup({ searchPrompts })
    await summon()
    await user.type(search(), 'c')
    await user.type(search(), 'r')
    await waitFor(() => expect(optionNames()[0]).toBe('Code Review'))
    await act(async () => resolveFirst([PLAIN_PROMPT]))
    expect(optionNames()[0]).toBe('Code Review')
  })

  it('opens a prompt when it is clicked, without taking focus from the search box', async () => {
    const { summon, user } = setup()
    await summon()
    await user.click(screen.getByRole('option', { name: 'Code Review' }))
    expect(await screen.findByRole('form', { name: 'Fill in the prompt' })).toBeInTheDocument()
  })
})

describe('launcher: answering', () => {
  it('Enter on a prompt with questions shows its form, first field focused', async () => {
    const { summon, user, api } = setup()
    await summon()
    await user.type(search(), 'cr')
    await waitFor(() => expect(optionNames()[0]).toBe('Code Review'))
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'Code Review' })).toBeInTheDocument()
    expect(api.getPrompt).toHaveBeenCalledWith('review')
    await waitFor(() => expect(screen.getByRole('radio', { name: /TypeScript/ })).toHaveFocus())
  })

  it('submits with Ctrl+Enter, using the clipboard from when the hotkey was pressed', async () => {
    const { summon, user, api } = setup()
    await summon({ clipboard: 'captured at hotkey' })
    await user.type(search(), 'cr')
    await waitFor(() => expect(optionNames()[0]).toBe('Code Review'))
    await user.keyboard('{Enter}')
    await screen.findByRole('form', { name: 'Fill in the prompt' })
    // The code field is filled from the clipboard captured at the hotkey.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveValue('captured at hotkey')
    )
    await user.keyboard(ctrl('{Enter}'))
    await waitFor(() => expect(api.copyPrompt).toHaveBeenCalled())
    expect(api.copyPrompt).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({ language: 'TypeScript', code: 'captured at hotkey' }),
      'captured at hotkey'
    )
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument()
  })

  it('hides a moment after copying', async () => {
    const { summon, user, api } = setup()
    await summon()
    await user.click(screen.getByRole('option', { name: 'Needs Code' }))
    await user.type(await screen.findByRole('textbox', { name: /^Code/ }), 'x')
    await user.keyboard(ctrl('{Enter}'))
    await screen.findByText('Copied to clipboard')
    expect(api.hideLauncher).not.toHaveBeenCalled()
    await waitFor(() => expect(api.hideLauncher).toHaveBeenCalled(), {
      timeout: COPIED_FLASH_MS + 1500
    })
  })

  it('focuses the first missing answer instead of copying', async () => {
    const { summon, user, api } = setup({
      openFill: async () => ({ remembered: {}, clipboard: '' })
    })
    await summon({ clipboard: '' })
    await user.click(screen.getByRole('option', { name: 'Needs Code' }))
    const code = await screen.findByRole('textbox', { name: /^Code/ })
    await waitFor(() => expect(code).toHaveFocus())
    await user.keyboard(ctrl('{Enter}'))
    expect(api.copyPrompt).not.toHaveBeenCalled()
    expect(code).toHaveAttribute('aria-invalid', 'true')
    expect(code).toHaveFocus()
  })

  it('Enter on a prompt with no questions copies it straight away', async () => {
    const { summon, user, api } = setup()
    await summon({ clipboard: 'clip' })
    await user.type(search(), 'pn')
    await waitFor(() => expect(optionNames()[0]).toBe('Plain Note, favorite'))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.copyPrompt).toHaveBeenCalledWith('plain', {}, 'clip'))
    expect(screen.queryByRole('form', { name: 'Fill in the prompt' })).not.toBeInTheDocument()
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument()
  })

  it('toggles a live preview with Ctrl+P', async () => {
    const { summon, user } = setup()
    await summon()
    await user.click(screen.getByRole('option', { name: 'Code Review' }))
    await screen.findByRole('form', { name: 'Fill in the prompt' })
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()
    await user.keyboard(ctrl('p'))
    expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent(
      'You are a TypeScript reviewer'
    )
    await user.keyboard(ctrl('p'))
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()
  })

  it('opens the prompt in the main window with Ctrl+E', async () => {
    const { summon, user, api } = setup()
    await summon()
    await user.keyboard('{ArrowDown}')
    await user.keyboard(ctrl('e'))
    expect(api.openInMainWindow).toHaveBeenCalledWith('review')
  })
})

describe('launcher: stepping back and closing', () => {
  it('Escape in the search closes the launcher', async () => {
    const { summon, user, api } = setup()
    await summon()
    await user.keyboard('{Escape}')
    expect(api.hideLauncher).toHaveBeenCalledTimes(1)
  })

  it('Escape in the form goes back to the search, keeping what was typed', async () => {
    const { summon, user, api } = setup()
    await summon()
    await user.type(search(), 'cr')
    await waitFor(() => expect(optionNames()[0]).toBe('Code Review'))
    await user.keyboard('{Enter}')
    await screen.findByRole('form', { name: 'Fill in the prompt' })
    await user.keyboard('{Escape}')
    expect(api.hideLauncher).not.toHaveBeenCalled()
    expect(search()).toHaveValue('cr')
    expect(search()).toHaveFocus()
    expect(optionNames()[0]).toBe('Code Review')
  })

  it('starts over at the search step each time it is summoned', async () => {
    const { summon, user } = setup()
    await summon()
    await user.type(search(), 'cr')
    await waitFor(() => expect(optionNames()[0]).toBe('Code Review'))
    await user.keyboard('{Enter}')
    await screen.findByRole('form', { name: 'Fill in the prompt' })
    await summon()
    expect(screen.queryByRole('form', { name: 'Fill in the prompt' })).not.toBeInTheDocument()
    expect(search()).toHaveValue('')
    expect(search()).toHaveFocus()
  })

  it('resets when it is hidden, so the next show is already clean', async () => {
    const { summon, hide, user } = setup()
    await summon()
    await user.type(search(), 'zzz')
    await hide()
    expect(search()).toHaveValue('')
  })
})

describe('launcher: new prompt from clipboard', () => {
  it('Ctrl+N saves the clipboard as a prompt', async () => {
    const { summon, user, api } = setup({
      newPromptFromClipboard: async () => ({ status: 'created', id: 'x', title: 'X' })
    })
    await summon()
    await user.keyboard(ctrl('n'))
    expect(api.newPromptFromClipboard).toHaveBeenCalledTimes(1)
  })

  it('typing "new" and Enter does the same', async () => {
    const { summon, user, api } = setup({
      newPromptFromClipboard: async () => ({ status: 'created', id: 'x', title: 'X' })
    })
    await summon()
    await user.type(search(), 'new')
    await waitFor(() => expect(optionNames()[0]).toBe('New prompt from clipboard'))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.newPromptFromClipboard).toHaveBeenCalled())
  })

  it('shows a message instead when the clipboard has no text', async () => {
    const { summon, user } = setup({ newPromptFromClipboard: async () => ({ status: 'empty' }) })
    await summon({ clipboard: '' })
    await user.keyboard(ctrl('n'))
    expect(await screen.findByRole('alert')).toHaveTextContent('The clipboard has no text')
    // The launcher stays open so the user can read it.
    expect(search()).toBeInTheDocument()
  })
})

describe('launcher: favorites', () => {
  it('Ctrl+D stars the highlighted prompt', async () => {
    const { summon, user, api } = setup({ toggleFavorite: async () => ['plain', 'review'] })
    await summon()
    await user.keyboard('{ArrowDown}')
    await user.keyboard(ctrl('d'))
    expect(api.toggleFavorite).toHaveBeenCalledWith('review')
    expect(await screen.findByRole('option', { name: 'Code Review, favorite' })).toBeInTheDocument()
  })
})

describe('launcher: before there is a library', () => {
  it('offers to open the app when no library is chosen, and Enter does it', async () => {
    const { summon, user, api } = setup()
    await summon({ suggestions: { status: 'unconfigured', groups: [], favoriteIds: [] } })
    expect(screen.getByText('Choose a folder for your prompts to get started.')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(api.openMainWindow).toHaveBeenCalled()
  })

  it('shows loading, then the prompts once they arrive', async () => {
    const { summon, pushSuggestions } = setup()
    await summon({ suggestions: { status: 'loading', groups: [], favoriteIds: [] } })
    expect(screen.getByText('Loading your library…')).toBeInTheDocument()
    await pushSuggestions(SUGGESTIONS)
    expect(screen.queryByText('Loading your library…')).not.toBeInTheDocument()
    expect(optionNames()).toContain('Code Review')
  })
})

describe('launcher: measuring', () => {
  it('reports the time from the hotkey to the first paint once the window is shown', async () => {
    const { summon, shown, api } = setup()
    await summon({ pressedAt: Date.now() - 5 })
    // Nothing yet: the page keeps rendering while hidden, so only the window being shown counts.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(api.reportLauncherPaint).not.toHaveBeenCalled()
    await shown()
    await waitFor(() => expect(api.reportLauncherPaint).toHaveBeenCalledTimes(1))
    expect(api.reportLauncherPaint.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(60)
  })

  it('reports once per summon', async () => {
    const { summon, shown, api } = setup()
    await summon({ pressedAt: Date.now() })
    await shown()
    await shown()
    await waitFor(() => expect(api.reportLauncherPaint).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(api.reportLauncherPaint).toHaveBeenCalledTimes(1)
  })

  it('reports nothing when not measuring', async () => {
    const { summon, shown, api } = setup()
    await summon({ pressedAt: null })
    await shown()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(api.reportLauncherPaint).not.toHaveBeenCalled()
  })
})

describe('launcher: sizing', () => {
  it('tells the main process how tall its content is', async () => {
    const resizes: number[] = []
    class FakeObserver {
      constructor(private readonly callback: () => void) {}
      observe(): void {
        this.callback()
      }
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 123.2
    } as DOMRect)
    setup({ resizeLauncher: async (height) => void resizes.push(height) })
    await waitFor(() => expect(resizes).toEqual([124]))
    vi.unstubAllGlobals()
  })
})
