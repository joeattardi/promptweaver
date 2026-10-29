import appIcon from '../../../../build/icon.png'

/** A key cap, for the shortcut hints. */
export function Kbd(props: { children: string }): React.JSX.Element {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-[5px] bg-black/[0.07] px-1 py-px font-sans text-[11px] leading-4 font-medium text-current/80 dark:bg-white/[0.12]">
      {props.children}
    </kbd>
  )
}

export interface HintItem {
  keys: string
  label: string
}

/** The row of shortcut hints along the bottom of the launcher. */
export function HintBar(props: {
  hints: readonly HintItem[]
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 border-t border-black/[0.07] px-4 py-2 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400">
      {props.hints.map((hint) => (
        <span key={hint.label} className="flex items-center gap-1.5">
          <Kbd>{hint.keys}</Kbd>
          {hint.label}
        </span>
      ))}
      {props.trailing !== undefined && <span className="ml-auto">{props.trailing}</span>}
      {/* Decorative, and quiet: the app's mark in the corner. */}
      <img
        src={appIcon}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`size-[18px] shrink-0 opacity-60 select-none ${props.trailing === undefined ? 'ml-auto' : ''}`}
      />
    </div>
  )
}
