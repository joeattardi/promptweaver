import type { FormField } from 'prompt-lang'
import type { DiagnosticView } from '../../../shared/library'
import type { PromptDetail } from '../../../shared/ipc'
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

/** Read-only view of the selected prompt. Phase 3 adds the fill-in form; Phase 5 the editor. */
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

function Detail(props: { detail: PromptDetail; library: ReadyLibrary }): React.JSX.Element {
  const { summary, body, diagnostics, form } = props.detail
  const conflicts = props.library.aliasConflicts.filter((c) =>
    summary.conflictingAliases.some((a) => a.trim().toLowerCase() === c.alias)
  )

  return (
    <section aria-label="Prompt details" className="min-h-0 overflow-y-auto p-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{summary.title}</h2>
        <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{summary.id}.md</p>
        {summary.description !== '' && <p className="mt-3">{summary.description}</p>}
      </header>

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
    </section>
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
