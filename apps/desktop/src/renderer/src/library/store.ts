import { create } from 'zustand'
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
  detail: PromptDetail | null
  /** Loads the library and keeps it current. Returns a cleanup function. */
  start: () => () => void
  setQuery: (query: string) => void
  select: (id: string) => void
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
    const id = list.some((p) => p.id === s.selectedId) ? s.selectedId : (list[0]?.id ?? null)
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
    detail: null,

    start() {
      void window.api.getAppInfo().then((info) => set({ appName: info.name }))
      void refresh()
      return window.api.onLibraryChanged(() => void refresh())
    },

    setQuery(query) {
      set({ query })
      if (query.trim() === '') {
        searchSeq++
        set({ hits: null })
        settleSelection()
      } else {
        void runSearch(query)
      }
    },

    select(id) {
      set({ selectedId: id })
      void loadDetail(id)
    },

    chooseFolder: () => act(() => window.api.chooseLibraryFolder()),
    createDefault: () => act(() => window.api.createDefaultLibrary()),
    addStarters: () => act(() => window.api.addStarterPrompts()),
    dismissNotice: () => set({ notice: null })
  }
})
