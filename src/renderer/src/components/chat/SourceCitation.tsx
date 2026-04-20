/**
 * SourceCitation — inline source reference displayed below AI responses.
 */

interface SourceCitationProps {
  index: number
  title: string
  snippet: string
  timestamp: string
  score: number
  sourceType: string
  sourceUrl: string | null
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'bg-emerald-500'
  if (score >= 0.6) return 'bg-amber-400'
  return 'bg-red-400'
}

export function SourceCitation({
  index,
  title,
  snippet,
  timestamp,
  score,
  sourceType,
  sourceUrl
}: SourceCitationProps): React.JSX.Element {
  const timeStr = new Date(timestamp).toLocaleString()
  const scorePct = Math.round(score * 100)

  return (
    <div className="flex gap-2 rounded border border-zinc-700/60 bg-zinc-800/50 px-2 py-1.5 text-[10px]">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-sky-600/80 text-[9px] font-bold text-white">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium text-zinc-300">{title}</p>
          <span className={`shrink-0 rounded-full px-1 py-0.5 text-[8px] font-bold text-white ${scoreColor(score)}`}>
            {scorePct}%
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-zinc-500">{snippet}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[9px] text-zinc-600">
          <span className="rounded bg-zinc-700/60 px-1 py-0.5">{sourceType}</span>
          <span>{timeStr}</span>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline" onClick={(e) => e.stopPropagation()}>
              ↗ link
            </a>
          )}
        </div>
      </div>
    </div>
  )
}