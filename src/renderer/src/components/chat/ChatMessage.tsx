/**
 * ChatMessage — a single chat bubble for the AI assistant.
 */

import { useState } from 'react'
import { SourceCitation } from './SourceCitation'

interface ChatSource {
  id: string
  title: string
  snippet: string
  timestamp: string
  score: number
  sourceType: string
  sourceUrl: string | null
}

interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system'
  content: string
  sources?: ChatSource[]
  confidence?: number
  createdAt?: string
}

function ConfidenceBar({ value }: { value: number }): React.JSX.Element {
  const pct = Math.round(value * 100)
  let color = 'bg-red-400'
  let textColor = 'text-red-400'
  if (pct >= 80) { color = 'bg-emerald-500'; textColor = 'text-emerald-400' }
  else if (pct >= 60) { color = 'bg-amber-400'; textColor = 'text-amber-400' }

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-zinc-700">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[9px] font-bold ${textColor}`}>{pct}%</span>
    </div>
  )
}

function renderWithCitations(text: string): React.ReactNode[] {
  const parts = text.split(/(\[Source \d+\])/g)
  return parts.map((part, i) => {
    const match = part.match(/\[Source (\d+)\]/)
    if (match) {
      return (
        <span key={i} className="mx-0.5 inline-flex items-center rounded bg-sky-600/30 px-1 text-[9px] font-bold text-sky-300">
          {match[1]}
        </span>
      )
    }
    return part.split('\n').map((line, j, arr) => (
      <span key={`${i}-${j}`}>{line}{j < arr.length - 1 && <br />}</span>
    ))
  })
}

export function ChatMessage({ role, content, sources = [], confidence, createdAt }: ChatMessageProps): React.JSX.Element {
  const [showSources, setShowSources] = useState(false)
  const isUser = role === 'user'
  const timeStr = createdAt ? new Date(createdAt).toLocaleTimeString() : ''

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
        isUser ? 'bg-sky-600/20 text-zinc-200' : 'border border-zinc-700/50 bg-zinc-800/80 text-zinc-300'
      }`}>
        <div className="whitespace-pre-wrap">{renderWithCitations(content)}</div>
        {!isUser && confidence !== undefined && confidence !== null && (
          <div className="mt-1.5 border-t border-zinc-700/40 pt-1.5">
            <ConfidenceBar value={confidence} />
          </div>
        )}
        {!isUser && confidence !== undefined && confidence !== null && confidence < 0.5 && confidence > 0 && (
          <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1">
            <p className="text-[9px] font-semibold text-amber-400">⚠ Limited data — confidence below 50%</p>
          </div>
        )}
        {!isUser && sources.length > 0 && (
          <button type="button" onClick={() => setShowSources(!showSources)}
            className="mt-1.5 flex items-center gap-1 text-[9px] text-sky-400 hover:text-sky-300">
            <span>{showSources ? '▼' : '▶'}</span>
            <span>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
            <span className="text-zinc-600">· Show evidence</span>
          </button>
        )}
      </div>
      {!isUser && showSources && sources.length > 0 && (
        <div className="mt-1 flex max-w-[85%] flex-col gap-1">
          {sources.map((src, i) => (
            <SourceCitation key={src.id ?? i} index={i + 1} title={src.title} snippet={src.snippet}
              timestamp={src.timestamp} score={src.score} sourceType={src.sourceType} sourceUrl={src.sourceUrl} />
          ))}
        </div>
      )}
      {timeStr && <span className="mt-0.5 text-[8px] text-zinc-600">{timeStr}</span>}
    </div>
  )
}