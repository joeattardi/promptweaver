import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface StarterPrompt {
  /** Path inside the library folder. */
  path: string
  content: string
}

// The starter pack. Written into a new library on first run.
export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    path: 'code/code-review.md',
    content: `---
title: Code Review
description: Review a code change for bugs, readability, and risk
tags: [code, review]
aliases: [cr, review]
format: 1
fields:
  language: { type: select, options: [TypeScript, Python, Go, Rust] }
  focus:
    type: multiselect
    options: [Bugs, Performance, Readability, Security, Tests]
    default: [Bugs, Readability]
  tone:
    type: select
    options:
      Gentle: Be encouraging and suggest improvements diplomatically.
      Blunt: Be direct. Skip praise and list problems in priority order.
  context: { type: textarea, help: What does this change do? }
  code: { type: textarea, required: true, from: clipboard }
---
You are a senior {{language}} engineer reviewing a pull request.

{{if focus}}
Focus on: {{focus}}.
{{end}}
{{tone}}

{{if context}}
## Context
{{context}}
{{end}}

## Code
{{code}}

{{if focus has Security}}
Flag anything that touches user input, auth, or secrets.
{{end}}
`
  },
  {
    path: 'code/explain-code.md',
    content: `---
title: Explain Code
description: Explain a piece of code at the level you need
tags: [code, learning]
aliases: [ex]
format: 1
fields:
  level:
    type: select
    options:
      Beginner: Assume I am new to programming. Avoid jargon and explain every term you use.
      Intermediate: Assume I know the basics. Focus on why it works this way.
      Expert: Be concise. Skip the basics and point out subtle details and trade-offs.
  language: { type: text, help: Leave blank if it is obvious from the code }
  walkthrough: { type: toggle, label: Walk through it line by line }
  code: { type: textarea, required: true, from: clipboard }
---
Explain the following {{if language}}{{language}} {{end}}code.

{{level}}

{{if walkthrough}}
Go through it step by step, quoting each part before you explain it.
{{else}}
Give a short overview first, then cover the important details.
{{end}}

## Code
{{code}}
`
  },
  {
    path: 'writing/reply-to-email.md',
    content: `---
title: Reply to Email
description: Draft a reply to the email on your clipboard
tags: [email, writing]
aliases: [re]
format: 1
fields:
  tone:
    type: select
    options:
      Warm: Write in a warm, friendly tone.
      Formal: Write in a formal, professional tone. Avoid contractions.
      Brief: Keep it to three sentences or fewer.
  decline: { type: toggle, label: Politely decline }
  name: { type: text, label: Your name, required: true }
---
Today is {{date}}. Draft a reply to the email below, written as {{name}}.

{{tone}}
{{if decline}}
Politely decline the request and suggest an alternative if one makes sense.
{{else}}
Agree to the request and confirm the next steps.
{{end}}

{{if clipboard}}
## Email
{{clipboard}}
{{else}}
(I will paste the email in my next message.)
{{end}}
`
  },
  {
    path: 'writing/summarize.md',
    content: `---
title: Summarize
description: Summarize text at the length and style you choose
tags: [writing, summary]
aliases: [sum]
format: 1
fields:
  style:
    type: select
    options:
      Bullet points: Use a bulleted list.
      Paragraph: Write a single paragraph.
      One sentence: Write exactly one sentence.
  max_words: { type: number, label: Maximum words, min: 10, max: 1000, default: 100 }
  audience: { type: text, help: Who is this for? }
  text: { type: textarea, required: true, from: clipboard }
---
Summarize the text below in no more than {{max_words}} words. {{style}}
{{if audience}}
Write it for: {{audience}}.
{{end}}

## Text
{{text}}
`
  },
  {
    path: 'meeting-notes.md',
    content: `---
title: Meeting Notes to Action Items
description: Turn raw meeting notes into decisions and action items
tags: [work, meetings]
aliases: [mn]
format: 1
fields:
  attendees: { type: text, help: Optional. Comma-separated names }
  include_summary: { type: toggle, label: Include a short summary, default: true }
  notes: { type: textarea, required: true, from: clipboard }
---
These are my notes from a meeting on {{date}}.
{{if attendees}}
Attendees: {{attendees}}.
{{end}}

Extract:
1. Decisions that were made.
2. Action items, each with an owner and a due date if one was mentioned.
3. Open questions.
{{if include_summary}}
Start with a two-sentence summary.
{{end}}

## Notes
{{notes}}
`
  },
  {
    path: 'git/commit-message.md',
    content: `---
title: Commit Message
description: Write a commit message from a diff
tags: [git, commit]
aliases: [cm, commit]
format: 1
fields:
  style:
    type: select
    options:
      Conventional Commits: Use the Conventional Commits format with a type and an optional scope.
      Plain: Use a short imperative subject line with no type prefix.
  body: { type: toggle, label: Include a body, default: true }
  why: { type: text, help: Why was this change made? }
  diff: { type: textarea, required: true, from: clipboard }
---
Write a git commit message for the diff below.

{{style}}
Keep the subject line under 72 characters and use the imperative mood ("add", not "added").

{{if body}}
After a blank line, add a short body that explains what changed and why, wrapped at 72 characters.
{{else}}
Write the subject line only.
{{end}}

{{if why}}
The reason for the change: {{why}}
{{end}}

Output only the commit message, with no commentary.

## Diff
{{diff}}
`
  },
  {
    path: 'git/pr-description.md',
    content: `---
title: Pull Request Description
description: Write a PR description from a diff
tags: [git, review]
aliases: [pr]
format: 1
fields:
  context: { type: text, help: Ticket link or background for the reviewer }
  checklist: { type: toggle, label: Include a testing checklist, default: true }
  diff: { type: textarea, required: true, from: clipboard }
---
Write a pull request description for the changes below.

Use these sections: Summary, Changes, and Risks.
{{if checklist}}
Finish with a Testing section written as a checklist of things a reviewer should verify.

{{end}}
Be specific and brief. Do not restate the diff line by line, and do not invent details that are not in it.

{{if context}}
Background: {{context}}
{{end}}

## Diff
{{diff}}
`
  },
  {
    path: 'git/release-notes.md',
    content: `---
title: Release Notes
description: Turn a list of commits into release notes
tags: [git, release, writing]
aliases: [rn, changelog]
format: 1
fields:
  audience:
    type: select
    options:
      Users: Write for end users and focus on visible benefits and fixes.
      Developers: Write for developers and call out breaking changes and API changes.
  version: { type: text, help: For example 2.4.0 }
  commits: { type: textarea, required: true, from: clipboard, help: Paste a git log or a list of merged PRs }
---
Write release notes{{if version}} for version {{version}}{{end}} from the commits below.

{{audience}}

Group the changes under Added, Changed, Fixed and Removed, and leave out any group that has nothing in it. Merge related commits into a single line, and skip chores that do not affect the reader, such as formatting or CI tweaks.

## Commits
{{commits}}
`
  },
  {
    path: 'debug/debug-help.md',
    content: `---
title: Debug Help
description: Work through a bug with the details that matter
tags: [debug]
aliases: [dbg, bug]
format: 1
fields:
  actual: { type: textarea, required: true, label: What happens }
  expected: { type: textarea, label: What should happen }
  tried: { type: textarea, help: What have you already ruled out? }
  code: { type: textarea, from: clipboard }
---
I am debugging a problem and want help finding the cause.

## What happens
{{actual}}

{{if expected}}
## What should happen
{{expected}}
{{end}}

{{if tried}}
## Already tried
{{tried}}
{{end}}

{{if code}}
## Relevant code
{{code}}
{{end}}

List the most likely causes in order, with what to check to confirm or rule out each one. If you need information you do not have, ask me before guessing.
`
  },
  {
    path: 'debug/explain-error.md',
    content: `---
title: Explain Error
description: Explain an error message or stack trace and how to fix it
tags: [debug, errors]
aliases: [err, error]
format: 1
fields:
  stack: { type: text, label: Language or stack, help: For example Node 22 or Django or Rust }
  fix: { type: toggle, label: Suggest a fix, default: true }
  details: { type: textarea, help: What were you doing when it happened? }
  error: { type: textarea, required: true, from: clipboard }
---
Explain this error{{if stack}} from a {{stack}} project{{end}}. Say what it means in plain terms, then identify the most likely cause and point to the line or frame in the trace where the problem starts.

{{if fix}}
Then suggest a fix. If there is more than one plausible cause, list them from most to least likely and say how I can tell them apart.
{{else}}
Do not suggest a fix yet.
{{end}}

{{if details}}
## What I was doing
{{details}}
{{end}}

## Error
{{error}}
`
  },
  {
    path: 'code/convert-code.md',
    content: `---
title: Convert Code
description: Port code from one language or framework to another
tags: [code, migration]
aliases: [cv, convert]
format: 1
fields:
  from: { type: text, label: From, help: Leave blank to detect it from the code }
  to: { type: text, label: To, required: true, help: For example Go or Python 3.12 or React hooks }
  idiomatic: { type: toggle, label: Use idiomatic style in the target, default: true }
  code: { type: textarea, required: true, from: clipboard }
---
Convert this code{{if from}} from {{from}}{{end}} to {{to}}.

{{if idiomatic}}
Write it the way an experienced {{to}} developer would, rather than translating line by line.
{{else}}
Keep the structure close to the original so the two can be compared side by side.

{{end}}
List any behavior that does not map cleanly, such as differences in error handling, types or concurrency.

## Code
{{code}}
`
  },
  {
    path: 'code/docstring.md',
    content: `---
title: Document Code
description: Write doc comments for functions and types
tags: [code, docs]
aliases: [doc, docs]
format: 1
fields:
  style:
    type: select
    options: [JSDoc, Google-style docstring, NumPy-style docstring, Javadoc, Rustdoc, Go doc comment]
  examples: { type: toggle, label: Include usage examples }
  code: { type: textarea, required: true, from: clipboard }
---
Write {{style}} comments for the code below.

Describe what each function or type does and why a caller would use it, then its parameters, return value and the errors it can raise.
{{if examples}}
Add a short usage example to each public function.

{{end}}
Do not restate the code in words. Do not change the code itself, and output it with the comments added.

## Code
{{code}}
`
  },
  {
    path: 'code/naming.md',
    content: `---
title: Naming Help
description: Suggest names for a function, variable, class or file
tags: [code, naming]
aliases: [nm, name]
format: 1
fields:
  kind:
    type: select
    options: [Function, Variable, Class or type, File or module, Database column]
  what: { type: textarea, required: true, label: What does it do?, from: clipboard }
  convention: { type: text, help: For example camelCase or snake_case }
  count: { type: number, min: 3, max: 15, default: 5, label: How many options }
---
Suggest {{count}} names for a {{kind}} described below.

{{if convention}}
Follow this convention: {{convention}}.

{{end}}
Order them from best to worst. Give one line on the trade-off for each, and say which you would pick. Prefer names that say what the thing does over names that say how it works.

## Description
{{what}}
`
  },
  {
    path: 'code/refactor.md',
    content: `---
title: Refactor
description: Improve a piece of code without changing what it does
tags: [code, refactor]
aliases: [rf, refactor]
format: 1
fields:
  goal:
    type: select
    options:
      Readability: Make the code easier to read and follow.
      Simplicity: Remove unnecessary abstraction and reduce the amount of code.
      Testability: Make the code easier to test in isolation.
      Performance: Make the code faster without making it harder to understand.
  keep: { type: toggle, label: Preserve behavior and public API, default: true }
  code: { type: textarea, required: true, from: clipboard }
---
Refactor the code below.

Goal: {{goal}}

{{if keep}}
Do not change its behavior or its public interface.

{{end}}
Explain each change in one line so I can review it, and leave alone anything that is fine as it is. If a change is risky, say so.

## Code
{{code}}
`
  },
  {
    path: 'code/security-check.md',
    content: `---
title: Security Check
description: Look for security problems in a piece of code
tags: [code, security, review]
aliases: [sec]
format: 1
fields:
  language: { type: text, help: Leave blank if it is obvious from the code }
  focus:
    type: multiselect
    options: [Injection, Authentication, Authorization, Secrets handling, Input validation, Dependencies]
    default: [Injection, Input validation]
  code: { type: textarea, required: true, from: clipboard }
---
Review this{{if language}} {{language}}{{end}} code for security problems.

{{if focus}}
Pay particular attention to: {{focus}}.

{{end}}
For each finding give the severity, the location, how it could be exploited, and a concrete fix. Rank findings by severity.

Only report problems that are really in the code. If you find nothing serious, say so rather than inventing issues, and mention what you could not judge from this snippet alone.

## Code
{{code}}
`
  },
  {
    path: 'code/write-tests.md',
    content: `---
title: Write Tests
description: Write unit tests for a piece of code
tags: [code, testing]
aliases: [wt, tests]
format: 1
fields:
  framework: { type: text, help: For example Vitest or pytest or Go testing }
  cover:
    type: multiselect
    options: [Happy path, Edge cases, Error handling, Boundary values]
    default: [Happy path, Edge cases]
  real: { type: toggle, label: Avoid mocks where possible }
  code: { type: textarea, required: true, from: clipboard }
---
Write unit tests for the code below{{if framework}} using {{framework}}{{end}}.

{{if cover}}
Cover: {{cover}}.

{{end}}
Give each test a name that describes the behavior it checks, and keep each test focused on one thing.
{{if real}}
Prefer real objects over mocks, and only mock what crosses a process or network boundary.

{{end}}
If the code has behavior that looks like a bug, point it out instead of writing a test that locks it in.

## Code
{{code}}
`
  },
  {
    path: 'data/regex.md',
    content: `---
title: Regex Builder
description: Build and explain a regular expression
tags: [data, regex]
aliases: [rx, regex]
format: 1
fields:
  flavor:
    type: select
    options: [JavaScript, Python, PCRE, Go, Java]
  match: { type: textarea, required: true, label: What should it match? }
  samples: { type: textarea, help: One per line and include some that should not match }
---
Write a {{flavor}} regular expression that matches the following.

{{match}}

{{if samples}}
Check it against these sample strings and say which ones match:
{{samples}}
{{end}}

Give the pattern on its own line, then a short breakdown of each part. Mention any edge cases it handles badly and any flags it needs.
`
  },
  {
    path: 'data/sql-help.md',
    content: `---
title: SQL Help
description: Write or fix a SQL query for your schema
tags: [data, sql]
aliases: [sql]
format: 1
fields:
  dialect:
    type: select
    options: [PostgreSQL, MySQL, SQLite, SQL Server, BigQuery]
  task: { type: textarea, required: true, label: What do you need?, from: clipboard }
  schema: { type: textarea, help: Paste CREATE TABLE statements or a list of columns }
  explain: { type: toggle, label: Explain the query, default: true }
---
Write a {{dialect}} query for the task below.

{{task}}

{{if schema}}
## Schema
{{schema}}
{{else}}
No schema was provided, so state any table and column names you assume.
{{end}}

{{if explain}}
After the query, explain how it works in a few sentences, and mention anything that could be slow on a large table.
{{else}}
Output only the query.
{{end}}
`
  },
  {
    path: 'shell/shell-command.md',
    content: `---
title: Shell Command
description: Get a command line for a task
tags: [shell, cli]
aliases: [sh, cmd]
format: 1
fields:
  shell:
    type: select
    options: [bash, zsh, fish, PowerShell]
  os:
    type: select
    label: System
    options: [macOS, Linux, Windows]
  task: { type: textarea, required: true, label: What do you want to do? }
  safe: { type: toggle, label: Explain each part and flag anything destructive, default: true }
---
Give me a {{shell}} command for {{os}} that does the following.

{{task}}

{{if safe}}
Explain each part of the command briefly. Warn me before anything that deletes or overwrites data, and show a dry-run version if one exists.
{{else}}
Output only the command.
{{end}}
`
  },
  {
    path: 'design/tradeoffs.md',
    content: `---
title: Weigh Trade-offs
description: Compare options for a technical decision
tags: [design, architecture]
aliases: [tr, tradeoffs]
format: 1
fields:
  decision: { type: text, required: true, label: What are you deciding? }
  options: { type: textarea, help: One option per line }
  constraints: { type: textarea, help: Team size or deadline or existing stack }
  criteria:
    type: multiselect
    options: [Cost, Complexity, Performance, Maintainability, Team familiarity, Time to ship]
    default: [Complexity, Maintainability]
---
Help me decide: {{decision}}

{{if options}}
## Options I am considering
{{options}}
{{else}}
Suggest the realistic options first, and keep it to three or fewer.
{{end}}

{{if constraints}}
## Constraints
{{constraints}}
{{end}}

{{if criteria}}
Weigh the options mainly on: {{criteria}}.

{{end}}
Compare them in a table, then give a recommendation and say what would change your mind. Be direct about uncertainty and do not pad the answer with generic advice.
`
  }
]

export interface WriteStartersResult {
  created: string[]
  /** Starters whose file already exists. They are left exactly as they are. */
  skipped: string[]
}

/**
 * Writes the starter prompts into `root`. Never overwrites: a file that
 * already exists (edited or not) is skipped. (Creating with the exclusive
 * `wx` flag means there is no existing data to lose if a write is cut short.)
 */
export async function writeStarters(root: string): Promise<WriteStartersResult> {
  const created: string[] = []
  const skipped: string[] = []
  for (const starter of STARTER_PROMPTS) {
    const path = join(root, starter.path)
    await mkdir(dirname(path), { recursive: true })
    try {
      await writeFile(path, starter.content, { flag: 'wx' })
      created.push(starter.path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        skipped.push(starter.path)
      } else {
        throw error
      }
    }
  }
  return { created, skipped }
}
