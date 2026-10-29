import { create } from 'zustand'
import { captureProblem } from '../../../shared/capture'
import { useSettings } from '../settings/store'
import type {
  LibraryActionResult,
  LibraryState,
  PromptDetail,
  PromptSummary
} from '../../../shared/ipc'

export type ReadyLibrary = Extract<LibraryState, { status: 'ready' }>

interface LibraryStore {
  appName: string | null
  state: LibraryState | null
  /** Why the last action failed, to show the user. */
  notice: string | null
  busy: boolean
  query: string
  /** Search results for `query`, once they have arrived. */
  hits: PromptSummary[] | null
  selectedId: string | null
  /** A prompt to select as soon as it appears in the list (one just created or opened from elsewhere). */
  focusId: string | null
  detail: PromptDetail | null
  /** Ids of starred prompts. */
  favoriteIds: string[]
  /** Loads the library and keeps it current. Returns a cleanup function. */
  start: () => () => void
  setQuery: (query: string) => void
  select: (id: string) => void
  /** Clears the search and selects this prompt, waiting for it to appear if it hasn't yet. */
  reveal: (id: string) => void
  toggleFavorite: (id: string) => Promise<void>
  newFromClipboard: () => Promise<void>
  chooseFolder: () => Promise<void>
  createDefault: () => Promise<void>
  addStarters: () => Promise<void>
  dismissNotice: () => void
}

// Slow replies must not overwrite newer ones: each kind of request keeps a
// counter, and a reply is dropped if a newer request has started.
let refreshSeq = 0
let searchSeq = 0
let detailSeq = 0

const NONE: PromptSummary[] = []

/** The prompts the list shows: search results when searching, else everything. */
export function visiblePrompts(s: Pick<LibraryStore, 'state' | 'query' | 'hits'>): PromptSummary[] {
  if (s.state?.status !== 'ready') return NONE
  return s.query.trim() !== '' && s.hits !== null ? s.hits : s.state.prompts
}

export const useLibrary = create<LibraryStore>()((set, get) => {
  /** Accepts a state unless it is older than the one already held. */
  function acceptState(state: LibraryState): void {
    const current = get().state
    if (current === null || state.revision >= current.revision) set({ state })
  }

  /** Keeps the selection on a visible prompt (the first, if the old one is gone) and loads its detail. */
  function settleSelection(): void {
    const s = get()
    const list = visiblePrompts(s)
    let id: string | null
    if (s.focusId !== null && list.some((p) => p.id === s.focusId)) {
      id = s.focusId
      set({ focusId: null })
    } else if (s.focusId !== null && s.state?.status === 'ready') {
      // Asked for a prompt that the list doesn't have yet: stay where we are until it arrives.
      id = s.selectedId
    } else {
      id = list.some((p) => p.id === s.selectedId) ? s.selectedId : (list[0]?.id ?? null)
    }
    if (id !== s.selectedId) set({ selectedId: id })
    void loadDetail(id)
  }

  async function loadDetail(id: string | null): Promise<void> {
    const seq = ++detailSeq
    if (id === null) {
      set({ detail: null })
      return
    }
    const detail = await window.api.getPrompt(id)
    if (seq === detailSeq) set({ detail })
  }

  async function runSearch(query: string): Promise<void> {
    const seq = ++searchSeq
    const hits = await window.api.searchPrompts(query)
    if (seq !== searchSeq) return
    set({ hits })
    settleSelection()
  }

  async function refresh(): Promise<void> {
    const seq = ++refreshSeq
    const state = await window.api.getLibraryState()
    if (seq !== refreshSeq) return
    acceptState(state)
    const { query } = get()
    if (query.trim() !== '') await runSearch(query)
    else settleSelection()
  }

  async function act(action: () => Promise<LibraryActionResult>): Promise<void> {
    set({ busy: true })
    try {
      const result = await action()
      acceptState(result.state)
      set({ notice: result.error })
      const { query } = get()
      if (query.trim() !== '') await runSearch(query)
      else settleSelection()
    } catch (error) {
      set({
        notice: `Something went wrong: ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      set({ busy: false })
    }
  }

  return {
    appName: null,
    state: null,
    notice: null,
    busy: false,
    query: '',
    hits: null,
    selectedId: null,
    focusId: null,
    detail: null,
    favoriteIds: [],

    start() {
      const api = window.api
      const offs = [
        api.onLibraryChanged(() => void refresh()),
        api.onFavoritesChanged(({ ids }) => set({ favoriteIds: ids })),
        api.onSelectPrompt(({ id }) => get().reveal(id)),
        api.onNotice(({ message }) => set({ notice: message }))
      ]
      void api.getAppInfo().then((info) => set({ appName: info.name }))
      void api.getFavorites().then((ids) => set({ favoriteIds: ids }))
      void refresh()
      // Subscribed first, so nothing the main process sends from here on is missed.
      void api.takePendingAction().then((action) => {
        if (action.selectId !== undefined) get().reveal(action.selectId)
        if (action.notice !== undefined) set({ notice: action.notice })
        if (action.openSettings) useSettings.getState().show()
      })
      return () => offs.forEach((off) => off())
    },

    setQuery(query) {
      set({ query, focusId: null })
      if (query.trim() === '') {
        searchSeq++
        set({ hits: null })
        settleSelection()
      } else {
        void runSearch(query)
      }
    },

    select(id) {
      set({ selectedId: id, focusId: null })
      void loadDetail(id)
    },

    reveal(id) {
      searchSeq++
      set({ query: '', hits: null, focusId: id })
      settleSelection()
    },

    async toggleFavorite(id) {
      try {
        set({ favoriteIds: await window.api.toggleFavorite(id) })
      } catch (error) {
        set({
          notice: `Couldn’t change the favorite: ${error instanceof Error ? error.message : String(error)}`
        })
      }
    },

    async newFromClipboard() {
      try {
        const result = await window.api.newPromptFromClipboard()
        // On success the main process asks this window to show the new prompt.
        set({ notice: captureProblem(result) })
      } catch (error) {
        set({
          notice: `Something went wrong: ${error instanceof Error ? error.message : String(error)}`
        })
      }
    },

    chooseFolder: () => act(() => window.api.chooseLibraryFolder()),
    createDefault: () => act(() => window.api.createDefaultLibrary()),
    addStarters: () => act(() => window.api.addStarterPrompts()),
    dismissNotice: () => set({ notice: null })
  }
})
