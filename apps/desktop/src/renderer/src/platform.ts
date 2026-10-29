/** Keyboard conventions that differ by platform, for the shortcut hints and the shortcuts themselves. */
export const isMac = /Mac/.test(navigator.userAgent)

/** What to show for the main modifier key. */
export const MOD = isMac ? '⌘' : 'Ctrl+'

/** Whether the platform's main modifier (Command, or Control elsewhere) is held. */
export function hasMod(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}
