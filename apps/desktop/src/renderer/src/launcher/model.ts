import type { LauncherSuggestions, PromptSummary } from '../../../shared/ipc'

export const NEW_FROM_CLIPBOARD_LABEL = 'New prompt from clipboard'

export type GroupKind = 'favorites' | 'recent' | 'all' | 'results' | 'actions'

export type LauncherItem =
  { kind: 'prompt'; prompt: PromptSummary; favorite: boolean } | { kind: 'new-from-clipboard' }

/** A run of rows under one heading (the heading is left out for search results). */
export interface LauncherSection {
  kind: GroupKind
  /** Shown above the rows; null for none. */
  heading: string | null
  items: LauncherItem[]
}

const HEADINGS: Record<LauncherSuggestions['groups'][number]['kind'], string> = {
  favorites: 'Favorites',
  recent: 'Recent',
  all: 'All prompts'
}

/** Typing "new" (or a longer start of the action's name) puts the action first; "ne" puts it last. */
function actionPlacement(query: string): 'first' | 'last' | 'hidden' {
  const q = query.trim().toLowerCase()
  if (q === '') return 'last'
  if (!NEW_FROM_CLIPBOARD_LABEL.toLowerCase().startsWith(q)) return 'hidden'
  return q.length >= 3 ? 'first' : q.length === 2 ? 'last' : 'hidden'
}

const isExactAlias = (prompt: PromptSummary, query: string): boolean => {
  const q = query.trim().toLowerCase()
  return prompt.aliases.some((alias) => alias.trim().toLowerCase() === q)
}

/**
 * The sections to show. With nothing typed: favorites, recents, the rest, then
 * the "new" action. With a query: the matches (an exact alias match is already
 * first, from the search), with the action added only if the query is the
 * start of its name.
 */
export function buildSections(
  query: string,
  suggestions: LauncherSuggestions,
  results: readonly PromptSummary[] | null
): LauncherSection[] {
  const favoriteIds = new Set(suggestions.favoriteIds)
  const asItem = (prompt: PromptSummary): LauncherItem => ({
    kind: 'prompt',
    prompt,
    favorite: favoriteIds.has(prompt.id)
  })
  const action: LauncherItem = { kind: 'new-from-clipboard' }

  if (query.trim() === '') {
    const sections: LauncherSection[] = suggestions.groups.map((group) => ({
      kind: group.kind,
      heading: HEADINGS[group.kind],
      items: group.prompts.map(asItem)
    }))
    // Only offer to capture once the library exists to put it in.
    if (suggestions.status === 'ready') {
      sections.push({ kind: 'actions', heading: null, items: [action] })
    }
    return sections
  }

  const matches = (results ?? []).map(asItem)
  const placement = suggestions.status === 'ready' ? actionPlacement(query) : 'hidden'
  if (placement === 'hidden') return [{ kind: 'results', heading: null, items: matches }]
  if (placement === 'last') return [{ kind: 'results', heading: null, items: [...matches, action] }]

  // First, unless a prompt's alias is exactly what was typed: that is the muscle-memory path.
  const [top] = results ?? []
  const aliasFirst = top !== undefined && isExactAlias(top, query)
  const items = aliasFirst ? [matches[0], action, ...matches.slice(1)] : [action, ...matches]
  return [{ kind: 'results', heading: null, items: items.filter((i) => i !== undefined) }]
}

/** The rows of all sections, in the order the arrow keys walk them. */
export function flatten(sections: readonly LauncherSection[]): LauncherItem[] {
  return sections.flatMap((s) => s.items)
}

/** The next active row for an arrow key, stopping at the ends (a long list shouldn't wrap by accident). */
export function moveActive(current: number, delta: number, count: number): number {
  if (count === 0) return 0
  return Math.max(0, Math.min(count - 1, current + delta))
}

/** A DOM id for a row, so the search box can point at it with aria-activedescendant. */
export const optionId = (index: number): string => `launcher-option-${index}`

/** The clipboard as one short line for the "new prompt" row. */
export function clipboardPreview(clipboard: string): string {
  const line = clipboard
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .find((l) => l !== '')
  if (line === undefined) return 'The clipboard has no text'
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}
