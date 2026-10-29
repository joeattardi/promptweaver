import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { captureProblem } from '../../../shared/capture'
import type {
  LauncherSuggestions,
  LauncherSummon,
  PromptDetail,
  PromptSummary
} from '../../../shared/ipc'
import { buildSections, flatten, moveActive, type LauncherItem } from './model'

export type Step = { kind: 'search' } | { kind: 'form'; detail: PromptDetail }

/** How long "Copied" stays up before the launcher hides, long enough to register and no longer. */
export const COPIED_FLASH_MS = 450

const LOADING: LauncherSuggestions = { status: 'loading', groups: [], favoriteIds: [] }

/**
 * Everything the launcher knows: the search, the form it has moved on to, and
 * what the main process has told it. It starts over each time it is summoned.
 */
export function useLauncher() {
  const [suggestions, setSuggestions] = useState<LauncherSuggestions>(LOADING)
  const [clipboard, setClipboard] = useState('')
  const [query, setQueryState] = useState('')
  const [results, setResults] = useState<PromptSummary[] | null>(null)
  const [active, setActive] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'search' })
  const [copied, setCopied] = useState<{ title: string } | null>(null)
  // Bumped to pull keyboard focus back to the search box.
  const [focusTick, setFocusTick] = useState(0)
  // How many times the launcher has been summoned; the opening animation runs for each.
  const [summonCount, setSummonCount] = useState(0)

  // A slow answer must not replace a newer one, and Enter must not act on a list that is about to change.
  const searchSeq = useRef(0)
  const searching = useRef<Promise<void> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sections = useMemo(
    () => buildSections(query, suggestions, results),
    [query, suggestions, results]
  )
  const items = useMemo(() => flatten(sections), [sections])
  const activeItem: LauncherItem | undefined = items[Math.min(active, items.length - 1)]

  const reset = useCallback(() => {
    searchSeq.current++
    searching.current = null
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
    setStep({ kind: 'search' })
    setQueryState('')
    setResults(null)
    setActive(0)
    setMessage(null)
    setCopied(null)
  }, [])

  useEffect(() => {
    const api = window.api
    const offs = [
      api.onLauncherSummon((summon: LauncherSummon) => {
        reset()
        setClipboard(summon.clipboard)
        setSuggestions(summon.suggestions)
        setFocusTick((n) => n + 1)
        setSummonCount((n) => n + 1)
      }),
      api.onLauncherSuggestions(setSuggestions),
      api.onLauncherHidden(() => {
        reset()
        // What was copied before the launcher opened isn't kept around while it is hidden.
        setClipboard('')
      }),
      api.onFavoritesChanged(({ ids }) => setSuggestions((s) => ({ ...s, favoriteIds: ids })))
    ]
    return () => offs.forEach((off) => off())
  }, [reset])

  const setQuery = useCallback((next: string) => {
    setQueryState(next)
    setMessage(null)
    setActive(0)
    const seq = ++searchSeq.current
    if (next.trim() === '') {
      searching.current = null
      setResults(null)
      return
    }
    const request = window.api.searchPrompts(next).then(
      (found) => {
        if (seq !== searchSeq.current) return
        setResults(found)
        setActive(0)
      },
      () => {
        if (seq === searchSeq.current) setMessage('Search failed. Try again.')
      }
    )
    searching.current = request
    void request.finally(() => {
      if (searching.current === request) searching.current = null
    })
  }, [])

  const move = useCallback(
    (delta: number) => setActive((current) => moveActive(current, delta, items.length)),
    [items.length]
  )

  /** Shows "Copied" and hides the launcher a moment later. */
  const finishCopy = useCallback((title: string) => {
    setCopied({ title })
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => void window.api.hideLauncher(), COPIED_FLASH_MS)
  }, [])

  const newFromClipboard = useCallback(async () => {
    try {
      const result = await window.api.newPromptFromClipboard()
      // On success the main process hides the launcher and opens the prompt, so there is nothing to do here.
      setMessage(captureProblem(result))
    } catch {
      setMessage('Couldn’t save the prompt.')
    }
  }, [])

  const choose = useCallback(
    async (item: LauncherItem) => {
      if (item.kind === 'new-from-clipboard') return newFromClipboard()
      const { id } = item.prompt
      setMessage(null)
      try {
        const detail = await window.api.getPrompt(id)
        if (detail === null) {
          setMessage('That prompt was renamed or deleted.')
          return
        }
        if (detail.form.fields.length > 0) {
          setStep({ kind: 'form', detail })
          return
        }
        // No questions: Enter copies it right away.
        const result = await window.api.copyPrompt(id, {}, clipboard)
        if (result.status === 'copied') finishCopy(detail.summary.title)
        else setMessage('Couldn’t copy that prompt. Try again.')
      } catch {
        setMessage('Couldn’t open that prompt.')
      }
    },
    [clipboard, finishCopy, newFromClipboard]
  )

  /** Enter in the search box: act on the highlighted row, once any search in flight has landed. */
  const chooseActive = useCallback(async () => {
    await searching.current
    if (suggestions.status !== 'ready' && suggestions.status !== 'loading') {
      // No library yet: the only useful thing Enter can do is open the app to set one up.
      await window.api.openMainWindow()
      return
    }
    if (activeItem !== undefined) await choose(activeItem)
  }, [activeItem, choose, suggestions.status])

  const toggleFavorite = useCallback(async (prompt: PromptSummary) => {
    const ids = await window.api.toggleFavorite(prompt.id)
    setSuggestions((s) => ({ ...s, favoriteIds: ids }))
  }, [])

  const backToSearch = useCallback(() => {
    setStep({ kind: 'search' })
    setFocusTick((n) => n + 1)
  }, [])

  return {
    suggestions,
    clipboard,
    query,
    setQuery,
    sections,
    items,
    active: Math.min(active, Math.max(0, items.length - 1)),
    setActive,
    activeItem,
    move,
    message,
    step,
    copied,
    focusTick,
    summonCount,
    choose,
    chooseActive,
    toggleFavorite,
    newFromClipboard,
    finishCopy,
    backToSearch
  }
}
