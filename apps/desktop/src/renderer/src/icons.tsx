// Small inline icons, drawn with currentColor so they follow the text color.

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

export function SearchIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={props.className}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  )
}

export function StarIcon(props: { filled: boolean; className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={props.className} fill={props.filled ? 'currentColor' : 'none'}>
      <path d="m8 1.8 1.9 4 4.3.5-3.2 3 .9 4.3L8 11.4l-3.9 2.2.9-4.3-3.2-3 4.3-.5z" />
    </svg>
  )
}

export function BackIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={props.className}>
      <path d="M9.5 3 4.5 8l5 5" />
    </svg>
  )
}

export function CheckIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} strokeWidth={2} className={props.className}>
      <path d="m3 8.5 3.3 3.2L13 4.5" />
    </svg>
  )
}

export function PlusIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={props.className}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}
