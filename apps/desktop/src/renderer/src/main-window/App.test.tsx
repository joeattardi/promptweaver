import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryState, PromptSummary } from '../../../shared/ipc'
import { useLibrary } from '../library/store'
import { useSettings } from '../settings/store'
import { detailOf, installApi, REVIEW, settingsView } from '../test/helpers'
import { App } from './App'

const summary = (id: string, title: string): PromptSummary => ({
  id,
  folder: '',
  title,
  description: `${title} description`,
  tags: [],
  aliases: [],
  conflictingAliases: [],
  errorCount: 0,
  warningCount: 0
})

const PLAIN = '---\ntitle: Plain\n---\nJust text.\n'
const details = { review: detailOf(REVIEW), plain: detailOf(PLAIN, 'plain') }

function ready(revision: number, prompts: PromptSummary[]): LibraryState {
  return {
    status: 'ready',
    revision,
    defaultPath: '/d',
    path: '/lib',
    prompts,
    problems: [],
    aliasConflicts: []
  }
}

const both = [summary('plain', 'Plain'), summary('review', 'Code Review')]

beforeEach(() => {
  useLibrary.setState(useLibrary.getInitialState(), true)
  useSettings.setState(useSettings.getInitialState(), true)
})

function libraryApi(overrides = {}) {
  return installApi({
    getLibraryState: async () => ready(1, both),
    getPrompt: async (id) => details[id as keyof typeof details] ?? null,
    ...overrides
  })
}

describe('main window', () => {
  it('shows a loading screen, then the first prompt ready to fill in', async () => {
    libraryApi()
    render(<App />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: 'Plain' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Prompts' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Copy prompt/ })).toBeInTheDocument()
  })

  it('walks through first run: create a library, then use it', async () => {
    const api = installApi({
      createDefaultLibrary: async () => ({ state: ready(2, both), error: null }),
      getPrompt: async (id) => details[id as keyof typeof details] ?? null
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click(
      await screen.findByRole('button', { name: 'Create a library with starter prompts' })
    )
    expect(api.createDefaultLibrary).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { level: 2, name: 'Plain' })).toBeInTheDocument()
  })

  it('shows a problem opening the saved folder', async () => {
    installApi({
      getLibraryState: async () => ({
        status: 'error',
        revision: 1,
        defaultPath: '/d',
        path: '/gone',
        message: 'The folder is missing.'
      })
    })
    render(<App />)
    expect(await screen.findByText('The folder is missing.')).toBeInTheDocument()
  })

  it('moves through prompts with the arrow keys from the search box, each with its own form', async () => {
    libraryApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { level: 2, name: 'Plain' })
    expect(screen.getByRole('combobox', { name: 'Search prompts' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Code Review' })
    ).toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: 'Note' })).toBeInTheDocument()
    // Focus stays in the search box so the list keeps responding to the keyboard.
    expect(screen.getByRole('combobox', { name: 'Search prompts' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(await screen.findByRole('heading', { level: 2, name: 'Plain' })).toBeInTheDocument()
  })

  it('searches, showing the matches, or that there are none', async () => {
    const api = libraryApi({
      searchPrompts: async (q: string) => (q === 'code' ? [summary('review', 'Code Review')] : [])
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { level: 2, name: 'Plain' })
    await user.type(screen.getByRole('combobox', { name: 'Search prompts' }), 'code')
    expect(api.searchPrompts).toHaveBeenLastCalledWith('code')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Code Review' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.type(screen.getByRole('combobox', { name: 'Search prompts' }), 'zz')
    expect(await screen.findByText(/No prompts match/)).toBeInTheDocument()
    expect(screen.getByText('Select a match to see it here.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('heading', { level: 2, name: 'Plain' })).toBeInTheDocument()
  })

  it('refreshes when the library changes on disk', async () => {
    let listener: (() => void) | undefined
    let state = ready(1, both)
    libraryApi({
      getLibraryState: async () => state,
      onLibraryChanged: (l: () => void) => {
        listener = l
        return () => undefined
      }
    })
    render(<App />)
    await screen.findByRole('heading', { level: 2, name: 'Plain' })
    state = ready(2, [...both, summary('new', 'Brand New')])
    act(() => listener?.())
    expect(await screen.findByRole('option', { name: /Brand New/ })).toBeInTheDocument()
    expect(screen.getByText('3 prompts')).toBeInTheDocument()
  })

  it('shows the add-starters screen for an empty library', async () => {
    const api = libraryApi({
      getLibraryState: async () => ready(1, []),
      addStarterPrompts: vi.fn(async () => ({ state: ready(2, both), error: null }))
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add starter prompts' }))
    await waitFor(() => expect(api.addStarterPrompts).toHaveBeenCalled())
    expect(await screen.findByRole('heading', { level: 2, name: 'Plain' })).toBeInTheDocument()
  })
})

describe('main window: working with the launcher', () => {
  it('saves the clipboard as a new prompt from the header button', async () => {
    const api = libraryApi({
      newPromptFromClipboard: async () => ({ status: 'created', id: 'plain', title: 'Plain' })
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'New from clipboard' }))
    expect(api.newPromptFromClipboard).toHaveBeenCalledTimes(1)
    // The main process then asks for the new prompt to be shown, so there is no error here.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when there is nothing on the clipboard to save', async () => {
    libraryApi({ newPromptFromClipboard: async () => ({ status: 'empty' }) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'New from clipboard' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The clipboard has no text')
  })

  it('shows the prompt the launcher asks for, clearing any search', async () => {
    let select: (payload: { id: string }) => void = () => undefined
    libraryApi({
      searchPrompts: async () => [summary('plain', 'Plain')],
      onSelectPrompt: (listener: typeof select) => {
        select = listener
        return () => undefined
      }
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { level: 2, name: 'Plain' })
    await user.type(screen.getByRole('combobox', { name: 'Search prompts' }), 'pl')
    act(() => select({ id: 'review' }))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Code Review' })
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Search prompts' })).toHaveValue('')
  })

  it('waits for a just-created prompt to reach the list before showing it', async () => {
    let select: (payload: { id: string }) => void = () => undefined
    let changed: () => void = () => undefined
    let state = ready(1, both)
    libraryApi({
      getLibraryState: async () => state,
      getPrompt: async (id: string) =>
        id === 'brand-new'
          ? detailOf('---\ntitle: Brand New\n---\nHello\n', 'brand-new')
          : (details[id as keyof typeof details] ?? null),
      onSelectPrompt: (listener: typeof select) => {
        select = listener
        return () => undefined
      },
      onLibraryChanged: (listener: () => void) => {
        changed = listener
        return () => undefined
      }
    })
    render(<App />)
    await screen.findByRole('heading', { level: 2, name: 'Plain' })
    // The request arrives before the window has heard that the file exists.
    act(() => select({ id: 'brand-new' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Plain' })).toBeInTheDocument()
    state = ready(2, [...both, summary('brand-new', 'Brand New')])
    act(() => changed())
    expect(await screen.findByRole('heading', { level: 2, name: 'Brand New' })).toBeInTheDocument()
  })

  it('does what it was opened to do: show a prompt, a message and the settings', async () => {
    libraryApi({
      takePendingAction: async () => ({
        selectId: 'review',
        notice: 'The clipboard has no text',
        openSettings: true
      }),
      getSettings: async () => settingsView()
    })
    render(<App />)
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Code Review' })
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The clipboard has no text')
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('opens the settings from the header', async () => {
    libraryApi({ getSettings: async () => settingsView() })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings…' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('stars and unstars the selected prompt', async () => {
    const api = libraryApi({ toggleFavorite: async () => ['plain'] })
    const user = userEvent.setup()
    render(<App />)
    const star = await screen.findByRole('button', { name: 'Favorite' })
    expect(star).toHaveAttribute('aria-pressed', 'false')
    await user.click(star)
    expect(api.toggleFavorite).toHaveBeenCalledWith('plain')
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('option', { name: /Plain, favorite/ })).toBeInTheDocument()
  })

  it('warns when the launcher shortcut could not be registered, and offers to change it', async () => {
    libraryApi({
      getSettings: async () =>
        settingsView({ hotkey: { registered: false, error: '⌃⌥Space is already used.' } })
    })
    const user = userEvent.setup()
    render(<App />)
    const warning = await screen.findByText(/shortcut isn’t working/)
    expect(warning.closest('[role=alert]')).toHaveTextContent('⌃⌥Space is already used.')
    await user.click(screen.getByRole('button', { name: 'Choose a shortcut' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })
})
