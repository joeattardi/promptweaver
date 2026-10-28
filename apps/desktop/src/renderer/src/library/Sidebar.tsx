import { useEffect } from 'react'
import type { PromptSummary } from '../../../shared/ipc'
import { useLibrary, visiblePrompts } from './store'

type Row =
  { kind: 'folder'; folder: string } | { kind: 'prompt'; prompt: PromptSummary; index: number }

/** Prompts in order, with a heading before each folder when browsing (not searching). */
function rowsFor(prompts: PromptSummary[], grouped: boolean): Row[] {
  const rows: Row[] = []
  let folder = ''
  prompts.forEach((prompt, index) => {
    if (grouped && prompt.folder !== folder) {
      folder = prompt.folder
      if (folder !== '') rows.push({ kind: 'folder', folder })
    }
    rows.push({ kind: 'prompt', prompt, index })
  })
  return rows
}

const optionId = (index: number): string => `prompt-option-${index}`

/** Search box and prompt list, as an ARIA combobox controlling a listbox. */
export function Sidebar(): React.JSX.Element {
  const query = useLibrary((s) => s.query)
  const prompts = useLibrary(visiblePrompts)
  const selectedId = useLibrary((s) => s.selectedId)
  const { setQuery, select } = useLibrary.getState()

  const searching = query.trim() !== ''
  const selectedIndex = prompts.findIndex((p) => p.id === selectedId)
  const rows = rowsFor(prompts, !searching)

  // Keep the selected option in view as the arrow keys move through a long list.
  useEffect(() => {
    if (selectedIndex >= 0) {
      document.getElementById(optionId(selectedIndex))?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    const move = (to: number): void => {
      const target = prompts[Math.max(0, Math.min(prompts.length - 1, to))]
      if (target) select(target.id)
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(selectedIndex + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(selectedIndex - 1)
        break
      case 'Escape':
        if (query !== '') {
          event.preventDefault()
          setQuery('')
        }
        break
    }
  }

  return (
    <div className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-700">
      <div className="p-3">
        <label htmlFor="library-search" className="sr-only">
          Search prompts
        </label>
        <input
          id="library-search"
          type="search"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Search prompts…"
          role="combobox"
          aria-expanded="true"
          aria-controls="prompt-list"
          aria-autocomplete="list"
          aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:border-zinc-600 dark:bg-zinc-800"
        />
        <p className="sr-only" role="status" aria-live="polite">
          {searching ? `${prompts.length} ${prompts.length === 1 ? 'match' : 'matches'}` : ''}
        </p>
      </div>

      {prompts.length === 0 && searching ? (
        <p className="px-4 py-2 text-sm text-zinc-500 dark:text-zinc-400">
          No prompts match “{query.trim()}”.
        </p>
      ) : (
        <ul
          id="prompt-list"
          role="listbox"
          aria-label="Prompts"
          // Clicking an option shouldn't pull focus out of the search box.
          onMouseDown={(e) => e.preventDefault()}
          className="min-h-0 flex-1 overflow-y-auto pb-2"
        >
          {rows.map((row) =>
            row.kind === 'folder' ? (
              <li
                key={`folder:${row.folder}`}
                role="presentation"
                className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
              >
                {row.folder}
              </li>
            ) : (
              <PromptOption
                key={row.prompt.id}
                prompt={row.prompt}
                index={row.index}
                selected={row.prompt.id === selectedId}
                onSelect={() => select(row.prompt.id)}
              />
            )
          )}
        </ul>
      )}
    </div>
  )
}

function PromptOption(props: {
  prompt: PromptSummary
  index: number
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { prompt } = props
  const flags = [
    prompt.errorCount > 0
      ? `${prompt.errorCount} ${prompt.errorCount === 1 ? 'error' : 'errors'}`
      : null,
    prompt.conflictingAliases.length > 0 ? 'alias conflict' : null
  ].filter((f): f is string => f !== null)

  return (
    // The listbox is driven from the search box (aria-activedescendant), so options aren't focusable themselves.
    <li
      id={optionId(props.index)}
      role="option"
      aria-selected={props.selected}
      aria-label={`${prompt.title}${prompt.folder ? `, in ${prompt.folder}` : ''}${flags.length ? `, ${flags.join(', ')}` : ''}`}
      onClick={props.onSelect}
      className="mx-2 cursor-pointer rounded-md px-2 py-1.5 aria-selected:bg-blue-600 aria-selected:text-white hover:bg-zinc-100 aria-selected:hover:bg-blue-600 dark:hover:bg-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{prompt.title}</span>
        {flags.length > 0 && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            {flags.join(' · ')}
          </span>
        )}
      </div>
      {prompt.description !== '' && (
        <div
          className={`truncate text-xs ${props.selected ? 'text-blue-100' : 'text-zinc-500 dark:text-zinc-400'}`}
        >
          {prompt.description}
        </div>
      )}
    </li>
  )
}
