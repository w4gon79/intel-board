interface HeaderBarProps {
  onOpenSettings: () => void
  onOpenAI: () => void
  onOpenAbout: () => void
}

export function HeaderBar({ onOpenSettings, onOpenAI, onOpenAbout }: HeaderBarProps): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold tracking-tight text-zinc-100">Intel Board</h1>
        <span className="rounded-full bg-emerald-950/80 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
          Live
        </span>
      </div>
      <nav className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenAbout}
          className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          About
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          Settings
        </button>
        <button
          type="button"
          onClick={onOpenAI}
          className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          AI
        </button>
      </nav>
    </header>
  )
}