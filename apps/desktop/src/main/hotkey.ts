import { checkAccelerator, formatAccelerator } from '../shared/accelerator'
import type { HotkeyStatus } from '../shared/ipc'

/** The part of Electron's `globalShortcut` this needs. */
export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
}

export type ApplyResult = { ok: true; accelerator: string } | { ok: false; error: string }

/**
 * Owns the one global shortcut that summons the launcher. Changing it either
 * works or leaves the old one in place; the user is never left without a
 * shortcut because they tried a bad one.
 */
export class HotkeyManager {
  private active: string | null = null
  private failure: string | null = null

  constructor(
    private readonly shortcuts: ShortcutApi,
    private readonly onPress: () => void,
    private readonly platform: NodeJS.Platform
  ) {}

  /** The shortcut that is registered right now, or null. */
  get accelerator(): string | null {
    return this.active
  }

  status(): HotkeyStatus {
    return { registered: this.active !== null, error: this.failure }
  }

  /**
   * Registers `accelerator`, replacing the current shortcut only if that works.
   * Used at startup too, where a failure is kept as the status to show the user.
   */
  apply(accelerator: string): ApplyResult {
    const checked = checkAccelerator(accelerator)
    if (!checked.ok) return this.fail(checked.reason, false)
    const next = checked.accelerator
    if (next === this.active) return { ok: true, accelerator: next }

    const label = formatAccelerator(next, this.platform)
    let registered = false
    try {
      registered = this.shortcuts.register(next, this.onPress)
    } catch {
      // Electron throws for an accelerator it can't parse; that is the same as "can't use it".
    }
    // Some systems report success for a shortcut another app holds; ask again to be sure.
    if (!registered || !this.shortcuts.isRegistered(next)) {
      if (registered) this.shortcuts.unregister(next)
      return this.fail(
        `${label} is already used by another app or by the system. Choose a different shortcut.`,
        true
      )
    }

    if (this.active !== null) this.shortcuts.unregister(this.active)
    this.active = next
    this.failure = null
    return { ok: true, accelerator: next }
  }

  /** Unregisters the shortcut, at quit. */
  dispose(): void {
    if (this.active !== null) this.shortcuts.unregister(this.active)
    this.active = null
  }

  private fail(error: string, keepStatus: boolean): ApplyResult {
    // When there is a working shortcut the status stays "registered"; the error is only returned.
    // With none (startup), the error is the status so the main window can say why.
    if (!keepStatus || this.active === null) this.failure = error
    return { ok: false, error }
  }
}
