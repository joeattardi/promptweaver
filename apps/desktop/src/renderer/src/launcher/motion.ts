// How the launcher's panel appears and disappears. The window is transparent and the panel draws
// itself, so the motion lives here, in the page. Uses the Web Animations API.

/** The panel's opening, in ms. */
export const OPEN_MS = 260
/**
 * The panel's closing, in ms. The main process waits a little longer than this before hiding the
 * window (CLOSE_MS in the main process's launcher-window.ts), so keep this shorter.
 */
export const CLOSE_MS = 120
/** Rows arrive one after another, up to this many; the rest come with the panel. */
const MAX_STAGGERED_ROWS = 9
const ROW_STAGGER_MS = 22

/** Fast at the start and settling gently: the panel snaps into place instead of drifting. */
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'

export interface AnimationLike {
  cancel(): void
  // `never` so a real Animation (whose handler takes an event) fits; we only ever assign a plain function.
  onfinish: ((event: never) => void) | null
}

/** The parts of an element this needs, so it can be tested without a browser. */
export interface MotionTarget {
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): AnimationLike
  style: { opacity: string }
}

export class LauncherMotion {
  private running: AnimationLike[] = []

  constructor(
    private readonly panel: MotionTarget,
    private readonly reducedMotion: () => boolean
  ) {}

  /** The panel pops in: rises, scales up and sharpens, then its rows follow one by one. */
  open(rows: readonly MotionTarget[]): void {
    this.cancel()
    const reduced = this.reducedMotion()
    const panel = this.panel.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translateY(-14px) scale(0.94)', filter: 'blur(10px)' },
            { opacity: 1, transform: 'none', filter: 'blur(0px)' }
          ],
      { duration: reduced ? 90 : OPEN_MS, easing: EASE_OUT, fill: 'both' }
    )
    this.track(panel)
    // The animation now owns the opacity; the parked value must not outlive it.
    this.panel.style.opacity = ''
    if (reduced) return
    rows.slice(0, MAX_STAGGERED_ROWS).forEach((row, i) => {
      this.track(
        row.animate(
          [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'none' }
          ],
          { duration: OPEN_MS, delay: 50 + i * ROW_STAGGER_MS, easing: EASE_OUT, fill: 'backwards' }
        )
      )
    })
  }

  /** The panel shrinks away and fades. It stays gone until it is opened again. */
  close(): void {
    this.cancel()
    const reduced = this.reducedMotion()
    this.track(
      this.panel.animate(
        reduced
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: 'none', filter: 'blur(0px)' },
              { opacity: 0, transform: 'translateY(-8px) scale(0.97)', filter: 'blur(6px)' }
            ],
        { duration: reduced ? 70 : CLOSE_MS, easing: EASE_IN, fill: 'forwards' }
      ),
      false
    )
  }

  /**
   * The window is hidden: park the panel invisible, so the first frame of the next show can't
   * flash it at full strength before the opening animation starts.
   */
  park(): void {
    this.cancel()
    this.panel.style.opacity = '0'
  }

  private track(animation: AnimationLike, cancelWhenDone = true): void {
    this.running.push(animation)
    // Once finished, a fill would pin the end state; drop it so the panel is simply "as styled".
    if (cancelWhenDone) animation.onfinish = () => animation.cancel()
  }

  private cancel(): void {
    for (const animation of this.running) animation.cancel()
    this.running = []
  }
}
