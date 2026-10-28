import { useState } from 'react'
import type { FormField } from 'prompt-lang'
import type { DiagnosticView } from '../../../shared/library'
import type { PromptDetail } from '../../../shared/ipc'
import { FillPanel } from '../fill/FillPanel'
import { useLibrary, type ReadyLibrary } from './store'

const SEVERITY_LABEL: Record<DiagnosticView['severity'], string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note'
}

const SEVERITY_CLASS: Record<DiagnosticView['severity'], string> = {
  error: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  info: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
}

/** The selected prompt: fill it in and copy it, or look at its details. Phase 5 adds the editor. */
export function DetailPane(props: { library: ReadyLibrary }): React.JSX.Element {
  const detail = useLibrary((s) => s.detail)
  const query = useLibrary((s) => s.query)

  if (detail === null) {
    return (
      <section aria-label="Prompt details" className="p-8 text-sm text-zinc-500 dark:text-zinc-400">
        {query.trim() !== '' ? 'Select a match to see it here.' : 'Select a prompt to see it here.'}
      </section>
    )
  }
  return <Detail detail={detail} library={props.library} />
}

type Tab = 'fill' | 'details'

const TABS: { id: Tab; label: string }[] = [
  { id: 'fill', label: 'Fill in' },
  { id: 'details', label: 'Details' }
]

function Detail(props: { detail: PromptDetail; library: ReadyLibrary }): React.JSX.Element {
  const { summary } = props.detail
  // Kept while moving between prompts, so the tab you were on stays put.
  const [tab, setTab] = useState<Tab>('fill')

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length]
    if (next) {
      setTab(next.id)
      document.getElementById(tabId(next.id))?.focus()
    }
  }

  return (
    <section aria-label="Prompt details" className="min-h-0 overflow-y-auto p-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{summary.title}</h2>
        <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{summary.id}.md</p>
        {summary.description !== '' && <p className="mt-3">{summary.description}</p>}
      </header>

      <div
        role="tablist"
        aria-label="Prompt view"
        className="mt-5 flex gap-1 border-b border-zinc-200 dark:border-zinc-700"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={tabId(t.id)}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={panelId(t.id)}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKeyDown}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-blue-600 ${
              tab === t.id
                ? 'border-blue-600 text-zinc-900 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="mt-5">
        {tab === 'fill' ? (
          // Keyed so each prompt starts with its own answers.
          <FillPanel
            key={summary.id}
            detail={props.detail}
            onShowDetails={() => setTab('details')}
          />
        ) : (
          <Details detail={props.detail} library={props.library} />
        )}
      </div>
    </section>
  )
}

const tabId = (tab: Tab): string => `detail-tab-${tab}`
const panelId = (tab: Tab): string => `detail-panel-${tab}`

/** Everything about a prompt except filling it in: aliases, tags, problems, questions and the template. */
function Details(props: { detail: PromptDetail; library: ReadyLibrary }): React.JSX.Element {
  const { summary, body, diagnostics, form } = props.detail
  const conflicts = props.library.aliasConflicts.filter((c) =>
    summary.conflictingAliases.some((a) => a.trim().toLowerCase() === c.alias)
  )

  return (
    <>
      {(summary.tags.length > 0 || summary.aliases.length > 0) && (
        <dl className="mt-4 flex flex-col gap-2 text-sm">
          {summary.aliases.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-zinc-500 dark:text-zinc-400">Aliases</dt>
              {summary.aliases.map((alias) => (
                <dd
                  key={alias}
                  className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                    summary.conflictingAliases.includes(alias)
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
                      : 'bg-zinc-100 dark:bg-zinc-800'
                  }`}
                >
                  {alias}
                </dd>
              ))}
            </div>
          )}
          {summary.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-zinc-500 dark:text-zinc-400">Tags</dt>
              {summary.tags.map((tag) => (
                <dd
                  key={tag}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
                >
                  {tag}
                </dd>
              ))}
            </div>
          )}
        </dl>
      )}

      {conflicts.map((c) => (
        <p
          key={c.alias}
          role="note"
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          The alias <span className="font-mono">{c.alias}</span> is used by more than one prompt:{' '}
          {c.ids.join(', ')}. Typing it in the launcher will list all of them.
        </p>
      ))}

      {diagnostics.length > 0 && <Problems diagnostics={diagnostics} />}

      <h3 className="mt-6 mb-2 text-sm font-semibold">Questions</h3>
      {form.fields.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          None. This prompt is copied as it is.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {form.fields.map((field) => (
            <li
              key={field.id}
              className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
            >
              <FieldRow field={field} />
            </li>
          ))}
        </ol>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold">Template</h3>
      {/* Prompt text is shown as plain text only. */}
      <pre className="max-h-96 overflow-auto rounded-md bg-zinc-100 p-3 font-mono text-xs break-words whitespace-pre-wrap dark:bg-zinc-800">
        {body === '' ? '(empty)' : body}
      </pre>
    </>
  )
}

function Problems(props: { diagnostics: DiagnosticView[] }): React.JSX.Element {
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold">Things to look at</h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {props.diagnostics.map((d, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span
              className={`shrink-0 rounded px-1.5 text-xs font-medium ${SEVERITY_CLASS[d.severity]}`}
            >
              {SEVERITY_LABEL[d.severity]}
            </span>
            <span>
              {d.message} <span className="text-zinc-500 dark:text-zinc-400">(line {d.line})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FieldRow(props: { field: FormField }): React.JSX.Element {
  const { field } = props
  const options =
    field.type === 'select' || field.type === 'multiselect' ? field.options.map((o) => o.label) : []
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{field.label}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {field.type}
          {field.required ? ', required' : ''}
          {field.type === 'text' || field.type === 'textarea'
            ? field.from
              ? ', from clipboard'
              : ''
            : ''}
        </span>
        {field.implicit && (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            not declared in the frontmatter
          </span>
        )}
      </div>
      {field.help !== undefined && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{field.help}</p>
      )}
      {options.length > 0 && (
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">{options.join(' · ')}</p>
      )}
    </>
  )
}
