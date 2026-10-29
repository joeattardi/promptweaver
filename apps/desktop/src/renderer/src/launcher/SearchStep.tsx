import { useEffect, useRef } from 'react'
import { hasMod, isMac, MOD } from '../platform'
import { HintBar, Kbd } from './Kbd'
import { PlusIcon, SearchIcon, StarIcon } from '../icons'
import {
  clipboardPreview,
  NEW_FROM_CLIPBOARD_LABEL,
  optionId,
  type LauncherItem,
  type LauncherSection
} from './model'
import type { useLauncher } from './useLauncher'

type LauncherState = ReturnType<typeof useLauncher>

const LISTBOX_ID = 'launcher-results'

/** The search box and the list under it, as an ARIA combobox controlling a listbox. */
export function SearchStep(props: { launcher: LauncherState }): React.JSX.Element {
  const { launcher } = props
  const input = useRef<HTMLInputElement>(null)
  const { query, items, sections, active, activeItem } = launcher

  // Focus the search box whenever the launcher is summoned or returns from the form.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [launcher.focusTick])
  // Escape closes the launcher, wherever focus is in the window.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      void window.api.hideLauncher()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  // The window can regain focus without a new summon (clicking back into it).
  useEffect(() => {
    const focus = (): void => input.current?.focus()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])
  // Keep the highlighted row in view as the arrow keys walk a long list.
  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  }, [active, items.length])

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return
    const mod = hasMod(event)
    // On a Mac, Ctrl+N and Ctrl+P also move, as they do in every text field there. Elsewhere Ctrl is the main modifier.
    const emacs = isMac && event.ctrlKey && !event.metaKey && !event.altKey
    const key = event.key.toLowerCase()
    if (event.key === 'ArrowDown' || (emacs && key === 'n')) {
      event.preventDefault()
      launcher.move(1)
    } else if (event.key === 'ArrowUp' || (emacs && key === 'p')) {
      event.preventDefault()
      launcher.move(-1)
    } else if (event.key === 'PageDown') {
      event.preventDefault()
      launcher.move(5)
    } else if (event.key === 'PageUp') {
      event.preventDefault()
      launcher.move(-5)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void launcher.chooseActive()
    } else if (mod && key === 'n') {
      event.preventDefault()
      void launcher.newFromClipboard()
    } else if (mod && key === 'd' && activeItem?.kind === 'prompt') {
      event.preventDefault()
      void launcher.toggleFavorite(activeItem.prompt)
    } else if (mod && key === 'e' && activeItem?.kind === 'prompt') {
      event.preventDefault()
      void window.api.openInMainWindow(activeItem.prompt.id)
    }
  }

  const hints = [
    { keys: '↵', label: 'Select' },
    { keys: '↑↓', label: 'Move' },
    { keys: `${MOD}N`, label: 'New from clipboard' },
    ...(activeItem?.kind === 'prompt'
      ? [
          { keys: `${MOD}D`, label: activeItem.favorite ? 'Unfavorite' : 'Favorite' },
          { keys: `${MOD}E`, label: 'Edit' }
        ]
      : []),
    { keys: 'esc', label: 'Close' }
  ]

  return (
    <>
      <div className="flex items-center gap-3 px-5">
        <SearchIcon className="size-[18px] shrink-0 text-zinc-500 dark:text-zinc-400" />
        <label htmlFor="launcher-search" className="sr-only">
          Search prompts
        </label>
        <input
          ref={input}
          id="launcher-search"
          type="text"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={items.length > 0 ? optionId(active) : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search prompts, or type an alias…"
          value={query}
          onChange={(e) => launcher.setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-[19px] text-zinc-900 outline-none placeholder:text-zinc-500/80 dark:text-zinc-100 dark:placeholder:text-zinc-400/70"
        />
        <Kbd>esc</Kbd>
      </div>

      <div
        id={LISTBOX_ID}
        role="listbox"
        aria-label="Prompts"
        // Clicking a row must not pull focus out of the search box.
        onMouseDown={(e) => e.preventDefault()}
        className={`max-h-[352px] overflow-y-auto overscroll-contain ${items.length > 0 ? 'border-t border-black/[0.07] pt-1 pb-2 dark:border-white/10' : ''}`}
      >
        {sectionsWithOffsets(sections).map(({ section, start }) => (
          <Section
            key={`${section.kind}`}
            section={section}
            start={start}
            active={active}
            query={query}
            clipboard={launcher.clipboard}
            onHover={launcher.setActive}
            onChoose={(item) => void launcher.choose(item)}
          />
        ))}
      </div>

      <Status launcher={launcher} />
      <HintBar hints={hints} />
    </>
  )
}

/** Each section with the index of its first row, so rows can know their place in the whole list. */
function sectionsWithOffsets(
  sections: readonly LauncherSection[]
): { section: LauncherSection; start: number }[] {
  let start = 0
  return sections.map((section) => {
    const entry = { section, start }
    start += section.items.length
    return entry
  })
}

function Section(props: {
  section: LauncherSection
  start: number
  active: number
  query: string
  clipboard: string
  onHover: (index: number) => void
  onChoose: (item: LauncherItem) => void
}): React.JSX.Element {
  const { section } = props
  const headingId = `launcher-heading-${section.kind}`
  return (
    <div
      role="group"
      aria-labelledby={section.heading !== null ? headingId : undefined}
      aria-label={section.heading === null ? 'Matches' : undefined}
    >
      {section.heading !== null && (
        <div
          id={headingId}
          className="px-5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400"
        >
          {section.heading}
        </div>
      )}
      {section.items.map((item, i) => {
        const index = props.start + i
        return (
          <Row
            key={item.kind === 'prompt' ? item.prompt.id : item.kind}
            item={item}
            index={index}
            selected={index === props.active}
            query={props.query}
            clipboard={props.clipboard}
            onHover={() => props.onHover(index)}
            onChoose={() => props.onChoose(item)}
          />
        )
      })}
    </div>
  )
}

function Row(props: {
  item: LauncherItem
  index: number
  selected: boolean
  query: string
  clipboard: string
  onHover: () => void
  onChoose: () => void
}): React.JSX.Element {
  const { item } = props
  const isAction = item.kind === 'new-from-clipboard'
  const title = isAction ? NEW_FROM_CLIPBOARD_LABEL : item.prompt.title
  const description = isAction ? clipboardPreview(props.clipboard) : item.prompt.description

  return (
    // The listbox is driven from the search box (aria-activedescendant), so rows aren't focusable themselves.
    <div
      id={optionId(props.index)}
      role="option"
      aria-selected={props.selected}
      aria-label={isAction ? title : `${title}${item.favorite ? ', favorite' : ''}`}
      onMouseMove={props.selected ? undefined : props.onHover}
      onClick={props.onChoose}
      className="group mx-2 flex cursor-default items-center gap-3 rounded-[10px] px-3 py-2 aria-selected:bg-blue-600 aria-selected:text-white"
    >
      {isAction && (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.06] group-aria-selected:bg-white/20 dark:bg-white/10">
          <PlusIcon />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[15px] leading-5 font-medium">{title}</span>
          {!isAction && item.prompt.folder !== '' && (
            <span className="shrink-0 text-xs text-zinc-500 group-aria-selected:text-blue-100 dark:text-zinc-400">
              {item.prompt.folder}
            </span>
          )}
        </span>
        {description !== '' && (
          <span
            className={`block truncate text-[13px] leading-[18px] text-zinc-600 group-aria-selected:text-blue-100 dark:text-zinc-400 ${isAction ? 'italic' : ''}`}
          >
            {description}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {!isAction &&
          item.prompt.aliases.slice(0, 2).map((alias) => (
            <span
              key={alias}
              className={`rounded px-1.5 py-0.5 font-mono text-xs group-aria-selected:bg-white/20 ${
                alias.toLowerCase() === props.query.trim().toLowerCase()
                  ? 'bg-blue-600/15 text-blue-800 dark:bg-blue-400/25 dark:text-blue-200'
                  : 'bg-black/[0.06] text-zinc-600 dark:bg-white/10 dark:text-zinc-300'
              }`}
            >
              {alias}
            </span>
          ))}
        {!isAction && item.favorite && (
          <StarIcon filled className="size-3.5 text-amber-500 group-aria-selected:text-white" />
        )}
      </span>
    </div>
  )
}

/** A line under the list for anything that isn't a row: loading, an empty library, no matches, a problem. */
function Status(props: { launcher: LauncherState }): React.JSX.Element | null {
  const { launcher } = props
  const { suggestions, query, items, message } = launcher
  let text: string | null = null
  let action: { label: string; run: () => void } | null = null

  if (message !== null) {
    text = message
  } else if (suggestions.status === 'loading') {
    text = 'Loading your library…'
  } else if (suggestions.status === 'unconfigured') {
    text = 'Choose a folder for your prompts to get started.'
    action = { label: 'Open Promptweaver', run: () => void window.api.openMainWindow() }
  } else if (suggestions.status === 'error') {
    text = 'Your library folder can’t be opened.'
    action = { label: 'Open Promptweaver', run: () => void window.api.openMainWindow() }
  } else if (query.trim() !== '' && items.every((i) => i.kind !== 'prompt')) {
    text = `No prompts match “${query.trim()}”.`
  }
  if (text === null) return null

  return (
    <div
      role={message !== null ? 'alert' : 'status'}
      className="flex items-center gap-3 border-t border-black/[0.07] px-5 py-3 text-sm text-zinc-700 dark:border-white/10 dark:text-zinc-300"
    >
      <span className="min-w-0 flex-1">{text}</span>
      {action !== null && (
        <button
          type="button"
          onClick={action.run}
          className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
