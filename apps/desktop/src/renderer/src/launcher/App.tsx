export function App(): React.JSX.Element {
  return (
    <main className="flex h-screen flex-col overflow-hidden rounded-xl bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <label className="sr-only" htmlFor="launcher-search">
        Search prompts
      </label>
      <input
        id="launcher-search"
        autoFocus
        placeholder="Search prompts…"
        className="border-b border-zinc-200 bg-transparent px-4 py-3 text-lg outline-none placeholder:text-zinc-400 dark:border-zinc-700"
      />
      <p className="p-4 text-sm text-zinc-500">Quick launcher placeholder.</p>
    </main>
  )
}
