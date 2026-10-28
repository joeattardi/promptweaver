import type { DiagnosticCode, FormModel, Severity } from 'prompt-lang'

/** One prompt in the library list. Plain data, sent to every window over IPC. */
export interface PromptSummary {
  /** Path relative to the library folder, without `.md`, with `/` separators. */
  id: string
  /** Folder part of the id: '' at the top level, else e.g. `code` or `work/reviews`. */
  folder: string
  title: string
  description: string
  tags: string[]
  aliases: string[]
  /** Aliases (as written) that at least one other prompt also declares. */
  conflictingAliases: string[]
  errorCount: number
  warningCount: number
}

export interface DiagnosticView {
  severity: Severity
  code: DiagnosticCode
  message: string
  /** 1-based line in the file. */
  line: number
}

export interface PromptDetail {
  summary: PromptSummary
  /** The whole file, which the form window parses to render a live preview. */
  source: string
  /** The template text after the frontmatter. */
  body: string
  diagnostics: DiagnosticView[]
  form: FormModel
}

/** Two or more prompts claiming the same alias (compared case-insensitively). */
export interface AliasConflict {
  alias: string
  ids: string[]
}

/** A file that could not be loaded as a prompt. */
export interface LibraryProblem {
  /** The file's path relative to the library folder, as shown to the user. */
  file: string
  message: string
}

interface LibraryStateBase {
  /** Increases every time anything about the library changes. */
  revision: number
  /** Where "Create library" on the welcome screen would put it. */
  defaultPath: string
}

export type LibraryState =
  | (LibraryStateBase & { status: 'unconfigured' })
  | (LibraryStateBase & { status: 'error'; path: string; message: string })
  | (LibraryStateBase & {
      status: 'ready'
      path: string
      prompts: PromptSummary[]
      problems: LibraryProblem[]
      aliasConflicts: AliasConflict[]
    })
