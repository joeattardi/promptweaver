// The search interface the rest of the app depends on. Nothing outside
// minisearch-index.ts may import MiniSearch, so the engine can be swapped
// without touching anything else.

export interface IndexedPrompt {
  /** Path relative to the library folder, without `.md`. */
  id: string
  title: string
  aliases: string[]
  tags: string[]
  description: string
  /** Template text, used for body search. */
  body: string
}

export interface SearchResult {
  id: string
  /** Higher is better. Results are returned in descending score order. */
  score: number
}

export interface SearchIndex {
  /** (Re)build from scratch, discarding anything indexed before. */
  index(prompts: IndexedPrompt[]): void
  /** Add or replace one prompt. */
  update(prompt: IndexedPrompt): void
  /** Remove one prompt. Unknown ids are ignored. */
  remove(id: string): void
  /**
   * Prompts matching `query`, best first. An exact alias match always ranks
   * first. An empty query returns nothing: favorites and recents for an empty
   * query are app state, not the index's job.
   */
  search(query: string, opts?: { limit?: number }): SearchResult[]
}
