import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { Launched } from './app'
import { expect, test } from './fixtures'

// Measures the launcher against the targets in CLAUDE.md and records the numbers.
// The run writes test-results/launcher-perf.md; copy it into docs/launcher-performance.md when it changes.
//
// Everything here is measured inside the app, without a human's typing speed, so the
// numbers are the app's share of the time. Keystroke counts are exact.

const RUNS = 25
/** Budget for hotkey to first painted frame, from CLAUDE.md ("under ~100 ms"). */
const PAINT_BUDGET_MS = 100

const search = (page: Page) => page.getByRole('combobox', { name: 'Search prompts' })
const form = (page: Page) => page.getByRole('form', { name: 'Fill in the prompt' })

function stats(values: number[]): { median: number; p95: number; max: number; min: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return {
    min: sorted[0] ?? 0,
    median: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1] ?? 0
  }
}

async function summon(app: Launched): Promise<void> {
  expect(await app.press()).toBe(true)
  await expect(search(app.launcher)).toBeFocused()
}

async function dismiss(app: Launched): Promise<void> {
  // Escape rather than the hotkey: if the system took focus away the launcher is already gone,
  // and pressing the hotkey would bring it back.
  await app.launcher.keyboard.press('Escape')
  await expect.poll(() => app.launcherVisible()).toBe(false)
}

function paintTimes(app: Launched): number[] {
  return app
    .perfLines()
    .map((line) => /first paint: (\d+) ms/.exec(line)?.[1])
    .filter((ms): ms is string => ms !== undefined)
    .map(Number)
}

interface Task {
  name: string
  /** What the person types, as keystrokes after the hotkey. */
  keystrokes: string[]
  /** How long the app took, step by step, in ms. */
  steps: { label: string; ms: number }[]
}

/** Runs a keystroke and returns how long until `done` holds. */
async function timed(done: () => Promise<unknown>, act: () => Promise<void>): Promise<number> {
  const start = Date.now()
  await act()
  await done()
  return Date.now() - start
}

test('the launcher meets its speed targets', async ({ app }) => {
  test.setTimeout(120_000)

  // 1. Hotkey to first paint, over repeated summons.
  for (let i = 0; i < RUNS; i++) {
    const before = paintTimes(app).length
    await summon(app)
    // Stay up until the page has reported its first frame, as a person looking at it would.
    await expect.poll(() => paintTimes(app).length).toBeGreaterThan(before)
    await dismiss(app)
  }
  const paints = paintTimes(app).slice(-RUNS)
  const paint = stats(paints)

  // 2. Common tasks: keystrokes, and the app's time at each step.
  const tasks: Task[] = []
  const { launcher, clipboard } = app

  // `cr`, Enter, answer (accept the defaults), Cmd+Enter.
  {
    await clipboard.write('func main() {}')
    await summon(app)
    const steps: Task['steps'] = []
    steps.push({
      label: 'type `cr`: alias match first',
      ms: await timed(
        () =>
          expect(launcher.getByRole('option', { name: /Code Review/ })).toHaveAttribute(
            'aria-selected',
            'true'
          ),
        () => launcher.keyboard.type('cr')
      )
    })
    steps.push({
      label: 'Enter: form shown, first field focused',
      ms: await timed(
        async () => {
          await expect(form(launcher)).toBeVisible()
          await expect(launcher.getByRole('radio', { name: /TypeScript/ })).toBeFocused()
        },
        () => launcher.keyboard.press('Enter')
      )
    })
    steps.push({
      label: 'Cmd/Ctrl+Enter: on the clipboard',
      ms: await timed(
        () => expect.poll(() => clipboard.read()).toContain('You are a TypeScript reviewer'),
        () => launcher.keyboard.press('ControlOrMeta+Enter')
      )
    })
    await expect.poll(() => app.launcherVisible()).toBe(false)
    tasks.push({
      name: 'Code review: `cr`, Enter, accept defaults, Cmd+Enter',
      keystrokes: ['hotkey', 'c', 'r', 'Enter', 'Cmd+Enter'],
      steps
    })
  }

  // A prompt with no questions: `pn`, Enter.
  {
    await clipboard.write('')
    await summon(app)
    const copied = await timed(
      () => expect.poll(() => clipboard.read()).toContain('Just a fixed prompt'),
      async () => {
        await launcher.keyboard.type('pn')
        await launcher.keyboard.press('Enter')
      }
    )
    await expect.poll(() => app.launcherVisible()).toBe(false)
    tasks.push({
      name: 'Prompt with no questions: `pn`, Enter',
      keystrokes: ['hotkey', 'p', 'n', 'Enter'],
      steps: [{ label: 'type `pn` and Enter: on the clipboard', ms: copied }]
    })
  }

  // One typed answer: `standup`, Enter, a short note, Enter.
  {
    await summon(app)
    const note = 'shipped the launcher'
    const steps: Task['steps'] = []
    steps.push({
      label: 'type `standup`, Enter: form shown',
      ms: await timed(
        () => expect(launcher.getByRole('textbox', { name: 'Notes' })).toBeFocused(),
        async () => {
          await launcher.keyboard.type('standup')
          await launcher.keyboard.press('Enter')
        }
      )
    })
    await launcher.keyboard.type(note)
    steps.push({
      label: 'Enter: on the clipboard',
      ms: await timed(
        () => expect.poll(() => clipboard.read()).toContain(note),
        () => launcher.keyboard.press('Enter')
      )
    })
    await expect.poll(() => app.launcherVisible()).toBe(false)
    tasks.push({
      name: 'One typed answer: `standup`, Enter, 20-character note, Enter',
      keystrokes: ['hotkey', ...'standup'.split(''), 'Enter', ...note.split(''), 'Enter'],
      steps
    })
  }

  // Capture: Cmd+N.
  {
    await clipboard.write('Explain this error in plain words')
    await summon(app)
    const created = await timed(
      () =>
        expect(
          app.main.getByRole('heading', { level: 2, name: 'Explain this error in plain words' })
        ).toBeVisible(),
      () => launcher.keyboard.press('ControlOrMeta+n')
    )
    tasks.push({
      name: 'Capture the clipboard as a new prompt: Cmd+N',
      keystrokes: ['hotkey', 'Cmd+N'],
      steps: [{ label: 'Cmd/Ctrl+N: saved and open in the main window', ms: created }]
    })
  }

  // Write the numbers down.
  const lines: string[] = [
    '# Launcher measurements',
    '',
    `Measured by \`e2e/launcher-perf.spec.ts\` on the built app (${process.platform}, ${RUNS} runs).`,
    "The app's time only: no human typing speed, and the global shortcut is pressed in-process.",
    '',
    '## Hotkey to first painted frame',
    '',
    `Target: under ~${PAINT_BUDGET_MS} ms.`,
    '',
    '| min | median | p95 | max |',
    '| --- | --- | --- | --- |',
    `| ${paint.min} ms | ${paint.median} ms | ${paint.p95} ms | ${paint.max} ms |`,
    '',
    '## Common tasks',
    '',
    '| Task | Keystrokes (incl. hotkey) | App time per step |',
    '| --- | --- | --- |',
    ...tasks.map(
      (t) =>
        `| ${t.name} | ${t.keystrokes.length} | ${t.steps.map((s) => `${s.label}: ${s.ms} ms`).join('<br>')} |`
    ),
    ''
  ]
  const out = join(__dirname, '..', 'test-results')
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'launcher-perf.md'), lines.join('\n'))
  console.log(lines.join('\n'))

  expect(paint.median, `median hotkey-to-paint ${paint.median} ms`).toBeLessThan(PAINT_BUDGET_MS)
  expect(paint.p95, `p95 hotkey-to-paint ${paint.p95} ms`).toBeLessThan(PAINT_BUDGET_MS * 2)
})
