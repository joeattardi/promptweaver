import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryState, PromptSummary } from '../../../shared/ipc'
import { useLibrary } from '../library/store'
import { detailOf, installApi, REVIEW } from '../test/helpers'
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
