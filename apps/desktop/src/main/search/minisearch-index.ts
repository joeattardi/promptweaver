import MiniSearch from 'minisearch'
import type { IndexedPrompt, SearchIndex, SearchResult } from './types'

const DEFAULT_LIMIT = 50

/** Field weights, heaviest first: aliases, title, tags, description, body. */
const BOOST = { aliases: 5, title: 4, tags: 3, description: 2, body: 1 }

interface Doc {
  id: string
  title: string
  aliases: string
  tags: string
  description: string
  body: string
}

/** Case- and accent-insensitive form, used for both indexed terms and alias lookup. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Light typo tolerance: one edit per ~5 letters, and none for very short terms. */
function fuzzyFor(term: string): number | false {
  return term.length < 4 ? false : 0.2
}

export class MiniSearchIndex implements SearchIndex {
  private readonly mini = new MiniSearch<Doc>({
    fields: ['aliases', 'title', 'tags', 'description', 'body'],
    processTerm: normalize,
    searchOptions: {
      boost: BOOST,
      prefix: true,
      fuzzy: fuzzyFor,
      maxFuzzy: 2,
      combineWith: 'AND'
    }
  })
  /** Normalized alias to the ids that declare it. */
  private readonly idsByAlias = new Map<string, Set<string>>()
  /** Normalized aliases per id, so removal can clean up `idsByAlias`. */
  private readonly aliasesById = new Map<string, string[]>()

  index(prompts: IndexedPrompt[]): void {
    this.mini.removeAll()
    this.idsByAlias.clear()
    this.aliasesById.clear()
    for (const prompt of prompts) this.update(prompt)
  }

  update(prompt: IndexedPrompt): void {
    this.remove(prompt.id)
    this.mini.add({
      id: prompt.id,
      title: prompt.title,
      aliases: prompt.aliases.join(' '),
      tags: prompt.tags.join(' '),
      description: prompt.description,
      body: prompt.body
    })
    const aliases = prompt.aliases.map((a) => normalize(a.trim())).filter((a) => a !== '')
    this.aliasesById.set(prompt.id, aliases)
    for (const alias of aliases) {
      const ids = this.idsByAlias.get(alias) ?? new Set<string>()
      ids.add(prompt.id)
      this.idsByAlias.set(alias, ids)
    }
  }

  remove(id: string): void {
    if (this.mini.has(id)) this.mini.discard(id)
    for (const alias of this.aliasesById.get(id) ?? []) {
      const ids = this.idsByAlias.get(alias)
      ids?.delete(id)
      if (ids?.size === 0) this.idsByAlias.delete(alias)
    }
    this.aliasesById.delete(id)
  }

  search(query: string, opts?: { limit?: number }): SearchResult[] {
    const trimmed = query.trim()
    if (trimmed === '') return []

    const ranked = this.mini.search(trimmed)
    // Exact alias matches come first by construction, not by score: they are
    // placed ahead of the ranked results, then given a score that keeps the
    // list in descending order.
    const aliasIds = [...(this.idsByAlias.get(normalize(trimmed)) ?? [])].sort()
    const aliasScore = (ranked[0]?.score ?? 0) + 1
    const results: SearchResult[] = aliasIds.map((id) => ({ id, score: aliasScore }))
    const seen = new Set(aliasIds)
    for (const hit of ranked) {
      const id = String(hit.id)
      if (!seen.has(id)) results.push({ id, score: hit.score })
    }
    return results.slice(0, Math.max(0, opts?.limit ?? DEFAULT_LIMIT))
  }
}
