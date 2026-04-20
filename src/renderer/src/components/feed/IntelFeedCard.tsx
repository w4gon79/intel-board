/**
 * IntelFeedCard — single intelligence item in the feed.
 *
 * Color-coded by tier:
 *   ALERT  → red accent
 *   WATCH  → amber accent
 *   CONTEXT → sky/blue accent
 *
 * AI Sensemaking items (categories includes 'ai-sensemaking') get special
 * visual treatment: brain icon badge, severity-colored accents, and
 * expandable analytical assessment.
 */

import type { IntelItem, IntelTier } from '../../../../shared/types'
import { linkifyText } from '../../utils/linkify'

interface IntelFeedCardProps {
  item: IntelItem
  /** Whether this card is selected / expanded */
  selected?: boolean
  onClick?: () => void
}

const TIER_CONFIG: Record<IntelTier, { bg: string; border: string; badge: string; label: string }> = {
  ALERT: {
    bg: 'bg-red-950/40',
    border: 'border-red-500/50',
    badge: 'bg-red-600 text-red-100',
    label: 'ALERT'
  },
  WATCH: {
    bg: 'bg-amber-950/30',
    border: 'border-amber-500/40',
    badge: 'bg-amber-600 text-amber-100',
    label: 'WATCH'
  },
  CONTEXT: {
    bg: 'bg-sky-950/20',
    border: 'border-sky-500/30',
    badge: 'bg-sky-700 text-sky-100',
    label: 'CONTEXT'
  }
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  return `${diffDay}d ago`
}

// ── AI Sense-Making Detection ──

/** Check if an intel item is an AI sense-making analysis */
function isAiSenseMaking(item: IntelItem): boolean {
  return item.categories?.includes('ai-sensemaking') ?? false
}

// ── Social Media Detection ──

/** Check if an intel item is from social media */
function isSocialPost(item: IntelItem): boolean {
  return item.categories?.includes('social') ?? false
}

// ── Economic Anomaly Detection ──

/** Check if an intel item is an economic anomaly */
function isEconomicAnomaly(item: IntelItem): boolean {
  return item.categories?.includes('economic') ?? false
}

/** Get economic indicator icon based on category */
function getEconomicIcon(item: IntelItem): string {
  const categories = item.categories || []
  if (categories.includes('commodity')) return '📈'
  if (categories.includes('currency')) return '💱'
  if (categories.includes('shipping')) return '🚢'
  return '📊'
}

/** Get social source detail (subreddit or 'bluesky') */
function getSocialSource(item: IntelItem): string | null {
  if (!isSocialPost(item)) return null
  const categories = item.categories || []
  if (categories.includes('reddit')) {
    // Extract subreddit from sources field: "Reddit r/geopolitics: https://..."
    const sourcesStr = Array.isArray(item.sources) ? item.sources.join(' ') : String(item.sources ?? '')
    const match = sourcesStr.match(/Reddit (r\/\w+)/)
    return match ? match[1] : 'Reddit'
  }
  if (categories.includes('bluesky')) return 'BlueSky'
  return 'Social'
}

/** Extract severity from AI sensemaking categories */
function getSeverity(item: IntelItem): 'low' | 'moderate' | 'high' | 'critical' | null {
  if (!isAiSenseMaking(item)) return null
  const severities = ['low', 'moderate', 'high', 'critical'] as const
  for (const s of severities) {
    if (item.categories?.includes(s)) return s
  }
  return null
}

const SEVERITY_COLORS: Record<string, { border: string; badge: string; icon: string }> = {
  critical: {
    border: 'border-red-500/70',
    badge: 'bg-red-600/80 text-red-100',
    icon: 'text-red-400'
  },
  high: {
    border: 'border-orange-500/60',
    badge: 'bg-orange-600/80 text-orange-100',
    icon: 'text-orange-400'
  },
  moderate: {
    border: 'border-amber-500/50',
    badge: 'bg-amber-600/70 text-amber-100',
    icon: 'text-amber-400'
  },
  low: {
    border: 'border-zinc-500/40',
    badge: 'bg-zinc-700/70 text-zinc-200',
    icon: 'text-zinc-400'
  }
}

function confidenceBar(confidence: number): React.JSX.Element {
  const pct = Math.round(confidence * 100)
  const color =
    confidence >= 0.8 ? 'bg-emerald-500' : confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-12 rounded-full bg-zinc-800">
        <div className={`h-1 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-500">{pct}%</span>
    </div>
  )
}

export function IntelFeedCard({ item, selected, onClick }: IntelFeedCardProps): React.JSX.Element {
  const aiItem = isAiSenseMaking(item)
  const severity = getSeverity(item)
  const config = TIER_CONFIG[item.tier]

  // AI sensemaking items get severity-colored border override
  const borderClass = aiItem && severity
    ? SEVERITY_COLORS[severity].border
    : config.border

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors ${borderClass} ${
        selected ? config.bg : 'bg-zinc-900/60 hover:bg-zinc-800/60'
      }`}
    >
      {/* Header: tier badge + AI badge + time */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${config.badge}`}>
            {config.label}
          </span>
          {aiItem && (
            <span className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              severity ? SEVERITY_COLORS[severity].badge : 'bg-purple-700/70 text-purple-100'
            }`}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI{severity && severity !== 'low' ? ` · ${severity.toUpperCase()}` : ''}
            </span>
          )}
          {isSocialPost(item) && (
            <span className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-purple-700/60 text-purple-100">
              📱 {getSocialSource(item)}
            </span>
          )}
          {isEconomicAnomaly(item) && (
            <span className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-700/60 text-emerald-100">
              {getEconomicIcon(item)} ECON
            </span>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-zinc-500">{formatTimeAgo(item.created_at)}</span>
      </div>

      {/* Title */}
      <h3 className="line-clamp-2 text-xs font-medium leading-snug text-zinc-200 group-hover:text-white">
        {item.title}
      </h3>

      {/* Summary (truncated) */}
      {item.summary && (
        <p className={`line-clamp-2 text-[11px] leading-relaxed ${
          aiItem ? 'text-zinc-300' : 'text-zinc-400'
        }`}>{linkifyText(item.summary)}</p>
      )}

      {/* Analysis section — shown for AI sensemaking items when selected */}
      {aiItem && item.analysis && selected && (
        <div className="rounded border border-purple-500/20 bg-purple-950/20 px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1">
            <svg className={`h-3 w-3 ${severity ? SEVERITY_COLORS[severity ?? 'low'].icon : 'text-purple-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="text-[10px] font-semibold text-purple-300">ANALYTICAL ASSESSMENT</span>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-300">{linkifyText(item.analysis)}</p>
        </div>
      )}

      {/* Footer: social source / region + confidence */}
      <div className="flex items-center justify-between pt-0.5">
        {isSocialPost(item) ? (
          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] text-purple-300">
            {getSocialSource(item)}
          </span>
        ) : item.region ? (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {item.region}
          </span>
        ) : (
          <span />
        )}
        {confidenceBar(item.confidence ?? 0)}
      </div>
    </button>
  )
}
