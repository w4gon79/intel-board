/**
 * IntelFeedContext — shared state for intel feed data.
 *
 * Provides items, counts, and loading state to both
 * IntelFeedPanel and StatusBar via React context.
 */

import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import type { IntelItem, IntelTier } from '../../../shared/types'

interface IntelFeedData {
  items: IntelItem[]
  totalCount: number
  tierCounts: Record<string, number>
  articleCount: number
  anomalyCount: number
  loading: boolean
  error: string | null
  refresh: () => void
  filterTier: IntelTier | null
  setFilterTier: (tier: IntelTier | null) => void
}

const IntelFeedContext = createContext<IntelFeedData | null>(null)

const POLL_INTERVAL_MS = 30_000

export function IntelFeedProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<IntelItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [tierCounts, setTierCounts] = useState<Record<string, number>>({})
  const [articleCount, setArticleCount] = useState(0)
  const [anomalyCount, setAnomalyCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterTier, setFilterTier] = useState<IntelTier | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [recentItems, count, counts, articles, anomalies] = await Promise.all([
        window.api.intel.getRecent(50),
        window.api.intel.getCount(),
        window.api.intel.getCountByTier(),
        window.api.articles.getCount(),
        window.api.anomalies.getCount()
      ])

      setItems(recentItems)
      setTotalCount(count)
      setTierCounts(counts)
      setArticleCount(articles)
      setAnomalyCount(anomalies)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch intel data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchAll])

  return (
    <IntelFeedContext.Provider
      value={{
        items,
        totalCount,
        tierCounts,
        articleCount,
        anomalyCount,
        loading,
        error,
        refresh: fetchAll,
        filterTier,
        setFilterTier
      }}
    >
      {children}
    </IntelFeedContext.Provider>
  )
}

export function useIntelFeed(): IntelFeedData {
  const ctx = useContext(IntelFeedContext)
  if (!ctx) throw new Error('useIntelFeed must be used within IntelFeedProvider')
  return ctx
}