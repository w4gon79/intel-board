/**
 * Prediction Card — displays an AI prediction in the intelligence feed.
 *
 * Visually distinct from intel items with an indigo/purple accent.
 * Includes confidence meter, timeframe, category icon, review buttons,
 * and AI self-review results with reasoning and evidence.
 */

import { useState } from 'react'
import type { Prediction } from '../../../../shared/types'

// ─── Category Icons ────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  conflict_escalation: '⚔️',
  supply_chain_disruption: '🚢',
  economic_instability: '📉',
  geopolitical_shift: '🌍'
}

const CATEGORY_COLORS: Record<string, string> = {
  conflict_escalation: 'text-red-400',
  supply_chain_disruption: 'text-amber-400',
  economic_instability: 'text-yellow-400',
  geopolitical_shift: 'text-blue-400'
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface PredictionCardProps {
  prediction: Prediction
  onReview?: (id: string, outcome: string, wasAccurate: boolean) => Promise<void>
}

// ─── Component ─────────────────────────────────────────────────────────────

export function PredictionCard({ prediction, onReview }: PredictionCardProps): React.JSX.Element {
  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewed, setReviewed] = useState(prediction.resolved_at !== null)

  const confidence = (prediction.confidence ?? 0) * 100
  const sources = Array.isArray(prediction.sources) ? prediction.sources : []
  const category = sources.find((s: string) => s.includes('_'))?.split(':')[0] ?? ''
  const categoryIcon =
    CATEGORY_ICONS[category] ?? sources.find((s) => CATEGORY_ICONS[s]) ??
    CATEGORY_ICONS['geopolitical_shift']
  const categoryColor =
    CATEGORY_COLORS[category] ?? CATEGORY_COLORS['geopolitical_shift']

  // Timeframe calculation
  const expectedBy = prediction.expected_by
    ? getTimeframeDisplay(prediction.expected_by, prediction.predicted_at)
    : 'No timeframe set'

  const isOverdue =
    prediction.expected_by && new Date(prediction.expected_by) < new Date()

  // Confidence bar color
  const confidenceColor =
    confidence >= 70
      ? 'bg-green-500'
      : confidence >= 40
        ? 'bg-yellow-500'
        : 'bg-red-500'

  // Dynamic border color based on review outcome
  const borderClass = (() => {
    if (prediction.review?.review_outcome === 'accurate') return 'border-l-emerald-500'
    if (prediction.review?.review_outcome === 'inaccurate') return 'border-l-red-500'
    if (prediction.review?.review_outcome === 'partially_accurate') return 'border-l-amber-500'
    if (prediction.review?.review_outcome === 'inconclusive') return 'border-l-zinc-500'
    if (isOverdue && !reviewed) return 'border-l-orange-500 ring-1 ring-orange-500/30'
    if (reviewed) return 'border-l-indigo-700'
    return 'border-l-indigo-500'
  })()

  async function handleReview(outcome: string, wasAccurate: boolean): Promise<void> {
    if (!onReview) return
    setIsReviewing(true)
    try {
      await onReview(prediction.id, outcome, wasAccurate)
      setReviewed(true)
    } catch (err) {
      console.error('[PredictionCard] Review failed:', err)
    } finally {
      setIsReviewing(false)
    }
  }

  return (
    <div
      className={`rounded-lg border-l-4 bg-gray-800/80 p-4 transition-all ${borderClass}`}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg" title={category.replace(/_/g, ' ')}>
            {categoryIcon}
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-indigo-400">
            Prediction
          </span>
          {isOverdue && !reviewed && !prediction.review?.review_outcome && (
            <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-400">
              OVERDUE
            </span>
          )}
          {/* AI Review outcome badges */}
          {prediction.review?.review_outcome === 'accurate' && (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
              ✓ AI: ACCURATE
            </span>
          )}
          {prediction.review?.review_outcome === 'inaccurate' && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400">
              ✗ AI: INACCURATE
            </span>
          )}
          {prediction.review?.review_outcome === 'partially_accurate' && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
              ~ AI: PARTIAL
            </span>
          )}
          {prediction.review?.review_outcome === 'inconclusive' && (
            <span className="rounded-full bg-zinc-500/20 px-2 py-0.5 text-[10px] font-bold text-zinc-400">
              ? AI: INCONCLUSIVE
            </span>
          )}
          {/* Manual review badge (no AI review) */}
          {reviewed && !prediction.review?.review_outcome && prediction.was_accurate !== null && (
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-400">
              REVIEWED
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-500">
          {formatRelativeTime(prediction.predicted_at)}
        </span>
      </div>

      {/* Prediction Text */}
      <p className="mb-3 text-sm leading-relaxed text-gray-200">
        {prediction.prediction_text ?? 'No prediction text available.'}
      </p>

      {/* Confidence Meter */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-gray-400">Confidence</span>
          <span className={`text-xs font-mono font-bold ${categoryColor}`}>
            {confidence.toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
          <div
            className={`h-full rounded-full transition-all ${confidenceColor}`}
            style={{ width: `${Math.max(2, confidence)}%` }}
          />
        </div>
      </div>

      {/* Meta Row */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {expectedBy}
        </span>
        {prediction.model_used && (
          <span className="rounded bg-gray-700/50 px-1.5 py-0.5 font-mono">
            {prediction.model_used}
          </span>
        )}
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {sources.slice(0, 5).map((source, i) => (
            <span
              key={i}
              className="rounded bg-gray-700/50 px-1.5 py-0.5 text-[10px] text-gray-400"
            >
              {source.length > 30 ? source.substring(0, 30) + '…' : source}
            </span>
          ))}
          {sources.length > 5 && (
            <span className="text-[10px] text-gray-500">
              +{sources.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* AI Review Result */}
      {prediction.review?.review_outcome && (
        <div className="mb-3 rounded-lg bg-gray-900/60 border border-gray-700/40 p-3">
          {/* Review header */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                AI Self-Review
              </span>
              <span className="text-[10px] text-gray-600">
                {prediction.review.review_evidence_count} sources checked
              </span>
            </div>
            <span className="text-[10px] text-gray-600">
              {prediction.review.review_reviewed_at ? formatRelativeTime(prediction.review.review_reviewed_at) : ''}
            </span>
          </div>

          {/* Key finding — always shown */}
          {prediction.review.review_key_finding && (
            <p className="mb-2 text-xs leading-relaxed text-gray-300">
              <span className="font-medium text-gray-400">What happened: </span>
              {prediction.review.review_key_finding}
            </p>
          )}

          {/* Reasoning — always shown */}
          {prediction.review.review_reasoning && (
            <p className="text-[11px] leading-relaxed text-gray-400">
              <span className="font-medium text-gray-500">AI reasoning: </span>
              {prediction.review.review_reasoning}
            </p>
          )}

          {/* Model used */}
          {prediction.review.review_model && (
            <div className="mt-2 text-[10px] text-gray-600">
              Reviewed by: {prediction.review.review_model}
            </div>
          )}
        </div>
      )}

      {/* Manual Review Buttons — only show if NOT already reviewed by AI */}
      {!reviewed && onReview && !prediction.review?.review_outcome && (
        <div className="flex items-center gap-2 border-t border-gray-700/50 pt-3">
          <span className="mr-auto text-[11px] text-gray-500">Was this prediction accurate?</span>
          <button
            onClick={() => handleReview('confirmed_accurate', true)}
            disabled={isReviewing}
            className="rounded bg-green-600/20 px-3 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-600/30 disabled:opacity-50"
          >
            ✓ Accurate
          </button>
          <button
            onClick={() => handleReview('confirmed_inaccurate', false)}
            disabled={isReviewing}
            className="rounded bg-red-600/20 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/30 disabled:opacity-50"
          >
            ✗ Inaccurate
          </button>
        </div>
      )}

      {/* Manual Review Outcome (no AI review) */}
      {reviewed && !prediction.review?.review_outcome && prediction.was_accurate !== null && (
        <div className="border-t border-gray-700/50 pt-2">
          <span
            className={`text-[11px] font-medium ${
              prediction.was_accurate ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {prediction.was_accurate ? '✓ Marked as accurate' : '✗ Marked as inaccurate'}
          </span>
          {prediction.outcome && (
            <p className="mt-1 text-[11px] text-gray-500">{prediction.outcome}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getTimeframeDisplay(expectedBy: string, _predictedAt: string): string {
  const expected = new Date(expectedBy)
  const now = new Date()
  const diffMs = expected.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  if (diffDays === 0) return 'Due today'
  if (diffDays === 1) return 'Due tomorrow'
  if (diffDays <= 14) return `Expected within ${diffDays}d`
  return `Expected by ${expected.toLocaleDateString()}`
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString()
}