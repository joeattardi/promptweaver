# Launcher measurements

Measured by `e2e/launcher-perf.spec.ts` on the built app (darwin, 25 runs).
The app's time only: no human typing speed, and the global shortcut is pressed in-process.

## Hotkey to first painted frame

Target: under ~100 ms.

| min  | median | p95   | max   |
| ---- | ------ | ----- | ----- |
| 7 ms | 16 ms  | 36 ms | 56 ms |

## Common tasks

| Task                                                         | Keystrokes (incl. hotkey) | App time per step                                                                                                              |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Code review: `cr`, Enter, accept defaults, Cmd+Enter         | 5                         | type `cr`: alias match first: 17 ms<br>Enter: form shown, first field focused: 47 ms<br>Cmd/Ctrl+Enter: on the clipboard: 6 ms |
| Prompt with no questions: `pn`, Enter                        | 4                         | type `pn` and Enter: on the clipboard: 7 ms                                                                                    |
| One typed answer: `standup`, Enter, 20-character note, Enter | 30                        | type `standup`, Enter: form shown: 34 ms<br>Enter: on the clipboard: 4 ms                                                      |
| Capture the clipboard as a new prompt: Cmd+N                 | 2                         | Cmd/Ctrl+N: saved and open in the main window: 203 ms                                                                          |
