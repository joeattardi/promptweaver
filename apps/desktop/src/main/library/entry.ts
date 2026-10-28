import { formFor, lint, parse } from 'prompt-lang'
import type { BodyNode, Diagnostic, ParsedPrompt } from 'prompt-lang'
import type { DiagnosticView, PromptDetail, PromptSummary } from '../../shared/library'
import type { IndexedPrompt } from '../search/types'
import { folderOf, titleFromId } from './prompt-id'

/** A parsed prompt file held in memory by the library. */
export interface PromptEntry {
  id: string
  text: string
  parsed: ParsedPrompt
  diagnostics: Diagnostic[]
  title: string
  description: string
  tags: string[]
  aliases: string[]
}

export function buildEntry(id: string, text: string): PromptEntry {
  const parsed = parse(text)
  const diagnostics = lint(parsed)
  const fm = parsed.frontmatter
  return {
    id,
    text,
    parsed,
    diagnostics,
    // A file with no frontmatter, or a missing or invalid title, is still listed under its file name.
    title: fm?.title ?? titleFromId(id),
    description: fm?.description ?? '',
    tags: fm?.tags ?? [],
    aliases: (fm?.aliases ?? []).map((a) => a.value.trim()).filter((a) => a !== '')
  }
}

/** The template text after the frontmatter. */
export function bodyOf(entry: PromptEntry): string {
  return entry.text.slice(entry.parsed.body.range.from)
}

/**
 * Text to search: the prose of the template plus placeholder names, without
 * the `{{if}}`/`{{else}}`/`{{end}}` syntax, so searching "end" or "if" doesn't
 * match every prompt that has a conditional.
 */
export function searchableBody(nodes: readonly BodyNode[]): string {
  const parts: string[] = []
  const visit = (list: readonly BodyNode[]): void => {
    for (const node of list) {
      if (node.kind === 'text') parts.push(node.value)
      else if (node.kind === 'placeholder') parts.push(` ${node.id} `)
      else if (node.kind === 'if') {
        visit(node.then)
        visit(node.otherwise)
      }
    }
  }
  visit(nodes)
  return parts.join('')
}

export function toIndexed(entry: PromptEntry): IndexedPrompt {
  return {
    id: entry.id,
    title: entry.title,
    aliases: entry.aliases,
    tags: entry.tags,
    description: entry.description,
    body: searchableBody(entry.parsed.body.nodes)
  }
}

export function toSummary(entry: PromptEntry, conflicted: ReadonlySet<string>): PromptSummary {
  return {
    id: entry.id,
    folder: folderOf(entry.id),
    title: entry.title,
    description: entry.description,
    tags: entry.tags,
    aliases: entry.aliases,
    conflictingAliases: entry.aliases.filter((a) => conflicted.has(aliasKey(a))),
    errorCount: entry.diagnostics.filter((d) => d.severity === 'error').length,
    warningCount: entry.diagnostics.filter((d) => d.severity === 'warning').length
  }
}

export function toDetail(entry: PromptEntry, summary: PromptSummary): PromptDetail {
  return {
    summary,
    body: bodyOf(entry),
    diagnostics: entry.diagnostics.map((d): DiagnosticView => ({
      severity: d.severity,
      code: d.code,
      message: d.message,
      line: lineAt(entry.text, d.range.from)
    })),
    form: formFor(entry.parsed)
  }
}

/** Aliases are compared case-insensitively. */
export function aliasKey(alias: string): string {
  return alias.trim().toLowerCase()
}

function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line++
  return line
}
