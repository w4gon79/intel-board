/**
 * IntelFeedPanel — right-side feed displaying intelligence items and predictions.
 *
 * Features:
 * - Tier filter tabs (ALL / ALERT / WATCH / CONTEXT / PREDICTIONS)
 * - Scrollable card list with color-coded tiers
 * - Predictions section with accuracy stats and review buttons
 * - Auto-refresh via useIntelFeed hook
 * - Expandable detail view for selected items
 */

import { useState, useEffect, useCallback } from 'react'
import type { IntelItem, IntelTier } from '../../../../shared/types'
import type { Prediction } from '../../../../shared/types'
import { useIntelFeed } from '../../hooks/useIntelFeed'
import { IntelFeedCard } from '../feed/IntelFeedCard'
import { PredictionCard } from '../feed/PredictionCard'
import { linkifyText, linkifySource } from '../../utils/linkify'
import { useIntelHighlight } from '../../contexts/IntelHighlightContext'

type FilterTab = 'ALL' | IntelTier | 'PREDICTIONS'

const TABS: { key: FilterTab; label: string; color: string }[] = [
  { key: 'ALL', label: 'All', color: 'text-zinc-400' },
  { key: 'ALERT', label: 'Alerts', color: 'text-red-400' },
  { key: 'WATCH', label: 'Watch', color: 'text-amber-400' },
  { key: 'CONTEXT', label: 'Context', color: 'text-sky-400' },
  { key: 'PREDICTIONS', label: 'Predictions', color: 'text-indigo-400' }
]

export function IntelFeedPanel(): React.JSX.Element {
  const { items, totalCount, loading, error, filterTier: _filterTier, setFilterTier } = useIntelFeed()
  const { highlight } = useIntelHighlight()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL')
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [accuracy, setAccuracy] = useState<{
    total: number; resolved: number; accurate: number; inaccurate: number; partial: number; inconclusive: number; accuracyRate: number
  } | null>(null)

  // Sync tab with useIntelFeed filter
  useEffect(() => {
    if (activeTab === 'PREDICTIONS') {
      // Don't change the hook filter for predictions tab
    } else {
      setFilterTier(activeTab === 'ALL' ? null : activeTab)
    }
  }, [activeTab, setFilterTier])

  // Helper: predictions API with Electron IPC → HTTP fallback
  const predictionsApi = useCallback(() => ({
    async getWithReviews(limit = 50) {
      if (window.api?.predictions?.getWithReviews) {
        return window.api.predictions.getWithReviews(limit)
      }
      const res = await fetch('/api/predictions/getWithReviews')
      return res.json()
    },
    async getAccuracy() {
      if (window.api?.predictions?.getAccuracy) {
        return window.api.predictions.getAccuracy()
      }
      const res = await fetch('/api/predictions/accuracy')
      return res.json()
    },
    async review(id: string, outcome: string, wasAccurate: boolean) {
      if (window.api?.predictions?.review) {
        return window.api.predictions.review(id, outcome, wasAccurate)
      }
      const res = await fetch('/api/predictions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, outcome, wasAccurate })
      })
      return res.json()
    }
  }), [])

  // Fetch predictions (including AI-reviewed ones)
  useEffect(() => {
    const api = predictionsApi()
    async function fetchPreds(): Promise<void> {
      try {
        const [preds, acc] = await Promise.all([
          api.getWithReviews(50),
          api.getAccuracy()
        ])
        setPredictions(preds ?? [])
        setAccuracy(acc)
      } catch (err) {
        console.error('[IntelFeedPanel] Prediction fetch failed:', err)
      }
    }
    fetchPreds()
    const interval = setInterval(fetchPreds, 30_000)
    return () => clearInterval(interval)
  }, [predictionsApi])

  const handleReview = useCallback(
    async (id: string, outcome: string, wasAccurate: boolean): Promise<void> => {
      try {
        const api = predictionsApi()
        await api.review(id, outcome, wasAccurate)
        const [preds, acc] = await Promise.all([
          api.getWithReviews(50),
          api.getAccuracy()
        ])
        setPredictions(preds ?? [])
        setAccuracy(acc)
      } catch (err) {
        console.error('[IntelFeedPanel] Review failed:', err)
      }
    },
    [predictionsApi]
  )

  // Filtering
  const effectiveTab = activeTab === 'PREDICTIONS' ? 'ALL' : activeTab
  const filtered = effectiveTab === 'ALL' ? items : items.filter((i) => i.tier === effectiveTab)
  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null
  const showPredictions = activeTab === 'PREDICTIONS'

  return (
    <aside className="flex h-full w-full flex-col min-h-0 rounded-lg border border-zinc-800 bg-zinc-900/40 xl:h-auto xl:w-[min(100%,22rem)] xl:overflow-hidden md:rounded-lg rounded-none md:border border-0">
      {/* ── Header ── */}
      <div className="border-b border-zinc-800 px-3 py-2 lg:px-3 lg:py-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Intelligence feed
          </h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-400">
            {totalCount + predictions.length}
          </span>
        </div>

        {/* Filter tabs */}
        <div className="mt-1.5 flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => { setActiveTab(tab.key); setSelectedId(null) }}
              className={`rounded px-2.5 py-1.5 md:px-2 md:py-0.5 text-xs md:text-[10px] font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? `${tab.color} bg-zinc-800`
                  : 'text-zinc-600 hover:text-zinc-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Prediction accuracy summary */}
        {accuracy && accuracy.total > 0 && showPredictions && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-600">
            <span>{accuracy.total} total</span>
            {accuracy.resolved > 0 && (
              <>
                <span className="text-emerald-500">{accuracy.accurate}✓</span>
                <span className="text-red-400">{accuracy.inaccurate}✗</span>
                {accuracy.partial > 0 && (
                  <span className="text-amber-400">{accuracy.partial}~</span>
                )}
                {accuracy.inconclusive > 0 && (
                  <span className="text-zinc-500">{accuracy.inconclusive}?</span>
                )}
                <span>•</span>
                <span className={accuracy.accuracyRate >= 0.5 ? 'text-emerald-400' : accuracy.accuracyRate >= 0.25 ? 'text-amber-400' : 'text-red-400'}>
                  {(accuracy.accuracyRate * 100).toFixed(0)}% acc
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {loading && items.length === 0 && predictions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="flex flex-col items-center gap-2">
            <svg className="h-5 w-5 animate-spin text-zinc-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-xs text-zinc-500">Loading intel…</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 scrollbar-thin">
          {/* ── ALL tab: merge predictions + intel, sorted by time ── */}
          {activeTab === 'ALL' && (() => {
            const unified = [
              ...filtered.map(item => ({
                type: 'intel' as const,
                item,
                sortKey: new Date(item.created_at).getTime()
              })),
              ...predictions.map(pred => ({
                type: 'prediction' as const,
                pred,
                sortKey: new Date(pred.predicted_at).getTime()
              }))
            ].sort((a, b) => b.sortKey - a.sortKey)

            if (unified.length === 0) {
              return (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-sm text-zinc-400">No briefs yet</p>
                  <p className="max-w-[14rem] text-xs text-zinc-600">
                    Ingestion will populate items here.
                  </p>
                </div>
              )
            }

            return unified.map(entry =>
              entry.type === 'intel'
                ? <IntelFeedCard
                    key={entry.item.id}
                    item={entry.item}
                    selected={entry.item.id === selectedId}
                    onClick={() => {
                      const newId = entry.item.id === selectedId ? null : entry.item.id
                      setSelectedId(newId)
                      highlight(newId)
                    }}
                  />
                : <PredictionCard key={entry.pred.id} prediction={entry.pred} onReview={handleReview} />
            )
          })()}

          {/* ── PREDICTIONS tab: grouped by tier with section headers ── */}
          {activeTab === 'PREDICTIONS' && (
            <>
              {(() => {
                const active = predictions.filter(p =>
                  !p.resolved_at && (!p.expected_by || new Date(p.expected_by) >= new Date())
                )
                const overdue = predictions.filter(p =>
                  !p.resolved_at && p.expected_by && new Date(p.expected_by) < new Date()
                )
                const reviewed = predictions.filter(p => p.resolved_at !== null)

                return (
                  <>
                    {/* Active section */}
                    {active.length > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-indigo-500/30" />
                        <span className="text-[10px] font-medium uppercase tracking-widest text-indigo-400/70">
                          Active ({active.length})
                        </span>
                        <div className="h-px flex-1 bg-indigo-500/30" />
                      </div>
                    )}
                    {active.map(pred => (
                      <PredictionCard key={pred.id} prediction={pred} onReview={handleReview} />
                    ))}

                    {/* Overdue section */}
                    {overdue.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="h-px flex-1 bg-orange-500/30" />
                        <span className="text-[10px] font-medium uppercase tracking-widest text-orange-400/70">
                          Overdue ({overdue.length})
                        </span>
                        <div className="h-px flex-1 bg-orange-500/30" />
                      </div>
                    )}
                    {overdue.map(pred => (
                      <PredictionCard key={pred.id} prediction={pred} onReview={handleReview} />
                    ))}

                    {/* Reviewed section */}
                    {reviewed.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="h-px flex-1 bg-zinc-600/30" />
                        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500/70">
                          Analyzed ({reviewed.length})
                        </span>
                        <div className="h-px flex-1 bg-zinc-600/30" />
                      </div>
                    )}
                    {reviewed.map(pred => (
                      <PredictionCard key={pred.id} prediction={pred} onReview={handleReview} />
                    ))}

                    {/* Empty state */}
                    {predictions.length === 0 && (
                      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                        <p className="text-sm text-zinc-400">No predictions</p>
                        <p className="max-w-[14rem] text-xs text-zinc-600">
                          Predictions are generated when anomalies are detected.
                        </p>
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          )}

          {/* ── Tier tabs (ALERT / WATCH / CONTEXT): intel items only ── */}
          {activeTab !== 'ALL' && activeTab !== 'PREDICTIONS' && (
            <>
              {filtered.length > 0 ? (
                filtered.map((item: IntelItem) => (
                  <IntelFeedCard
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onClick={() => {
                      const newId = item.id === selectedId ? null : item.id
                      setSelectedId(newId)
                      highlight(newId)
                    }}
                  />
                ))
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-sm text-zinc-400">No briefs yet</p>
                  <p className="max-w-[14rem] text-xs text-zinc-600">
                    No {activeTab} items found.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Detail pane ── */}
      {selected && (
        <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/60 p-3">
          <div className="mb-1 flex items-start justify-between gap-2">
            <h3 className="text-xs font-semibold text-zinc-200">{selected.title}</h3>
            <button
              type="button"
              onClick={() => { setSelectedId(null); highlight(null) }}
              className="shrink-0 text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>
          {selected.summary && (
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-400">{linkifyText(selected.summary)}</p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
            {selected.sources && selected.sources.length > 0 && (
              <span>Sources: {selected.sources.map((s, i) => (
                i > 0 ? <>, {typeof s === 'string' ? linkifySource(s, i) : String(s)}</> : (typeof s === 'string' ? linkifySource(s, i) : String(s))
              ))}</span>
            )}
            {selected.region && <span>Region: {selected.region}</span>}
            <span>Confidence: {Math.round((selected.confidence ?? 0) * 100)}%</span>
            <span>{new Date(selected.created_at).toLocaleString()}</span>
          </div>
        </div>
      )}
    </aside>
  )
}