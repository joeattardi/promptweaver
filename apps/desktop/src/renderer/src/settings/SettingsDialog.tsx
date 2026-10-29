import { useEffect, useRef } from 'react'
import { formatAccelerator } from '../../../shared/accelerator'
import { useLibrary } from '../library/store'
import { buttonClass } from '../library/ui'
import { HotkeyRecorder } from './HotkeyRecorder'
import { useSettings } from './store'

/** Settings: the launcher shortcut, starting at login, and the library folder. A modal dialog. */
export function SettingsDialog(): React.JSX.Element {
  const view = useSettings((s) => s.view)
  const open = useSettings((s) => s.open)
  const note = useSettings((s) => s.note)
  const libraryPath = useLibrary((s) => (s.state?.status === 'ready' ? s.state.path : null))
  const busy = useLibrary((s) => s.busy)
  const appName = useLibrary((s) => s.appName) ?? 'the app'
  const dialog = useRef<HTMLDialogElement>(null)
  const { hide, setHotkey, resetHotkey, setLaunchAtLogin } = useSettings.getState()

  // The native dialog gives focus trapping, Escape to close and a backdrop.
  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      aria-labelledby="settings-title"
      onClose={hide}
      className="m-auto w-[34rem] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      {open && view !== null && (
        <div className="flex flex-col gap-6 p-6">
          <h2 id="settings-title" className="text-lg font-semibold tracking-tight">
            Settings
          </h2>

          <section aria-labelledby="shortcut-label" className="flex flex-col gap-2">
            <h3 id="shortcut-label" className="text-sm font-semibold">
              Quick launcher shortcut
            </h3>
            <p id="shortcut-help" className="text-sm text-zinc-600 dark:text-zinc-400">
              Press this from any app to find a prompt, fill it in and copy it.
            </p>
            <div className="flex flex-wrap items-start gap-2">
              <HotkeyRecorder
                id="launcher-hotkey"
                value={view.launcherHotkey}
                platform={view.platform}
                active={view.hotkey.registered}
                describedBy="shortcut-help"
                onChoose={(accelerator) => void setHotkey(accelerator)}
              />
              {view.launcherHotkey !== view.defaultLauncherHotkey && (
                <button type="button" onClick={() => void resetHotkey()} className={buttonClass}>
                  Reset to {formatAccelerator(view.defaultLauncherHotkey, view.platform)}
                </button>
              )}
            </div>
            {!view.hotkey.registered && view.hotkey.error !== null && note === null && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {view.hotkey.error}
              </p>
            )}
            {note !== null && (
              <p
                role={note.kind === 'error' ? 'alert' : 'status'}
                className={`text-sm ${
                  note.kind === 'error'
                    ? 'text-red-700 dark:text-red-400'
                    : note.kind === 'warning'
                      ? 'text-amber-800 dark:text-amber-300'
                      : 'text-green-700 dark:text-green-400'
                }`}
              >
                {note.text}
                {note.kind === 'warning' && ' It is set, but you may want another.'}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={view.launchAtLogin}
                disabled={!view.launchAtLoginAvailable}
                onChange={(e) => void setLaunchAtLogin(e.target.checked)}
                className="size-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              />
              Start {appName} when you log in
            </label>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {view.launchAtLoginAvailable
                ? 'It starts quietly in the menu bar or tray, ready for the shortcut.'
                : 'Available in the installed app, not when running from source.'}
            </p>
          </section>

          {libraryPath !== null && (
            <section aria-labelledby="library-label" className="flex flex-col gap-2">
              <h3 id="library-label" className="text-sm font-semibold">
                Prompt library
              </h3>
              <p className="font-mono text-xs break-all text-zinc-600 dark:text-zinc-400">
                {libraryPath}
              </p>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void useLibrary.getState().chooseFolder()}
                  className={buttonClass}
                >
                  Change folder…
                </button>
              </div>
            </section>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={hide} className={buttonClass} autoFocus>
              Done
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
