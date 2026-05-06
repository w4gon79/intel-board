/**
 * AiAssistantStrip — bottom-panel conversational AI interface.
 *
 * Expandable chat panel that uses the RAG pipeline for grounded answers.
 * - Collapsed: shows a single input bar
 * - Expanded: shows full chat with messages, sources, and citations
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { ChatMessage } from '../chat/ChatMessage'

// ─── Types ─────────────────────────────────────────────────────────────────

interface ChatSource {
  id: string
  title: string
  snippet: string
  timestamp: string
  score: number
  sourceType: string
  sourceUrl: string | null
}

interface Message {
  id: string | number
  role: 'user' | 'assistant' | 'system'
  content: string
  sources?: ChatSource[]
  confidence?: number
  createdAt: string
}

// ─── Suggested Questions ────────────────────────────────────────────────────

const QUICK_QUESTIONS = [
  "What's happening in the South China Sea?",
  'Any unusual military flight activity?',
  'Summarize recent maritime incidents',
  'Are there any active alerts?',
  'What is the current threat assessment?',
  'Any ship traffic anomalies at choke points?'
]

/** Memoized message list — doesn't re-render on input keystrokes */
const MessageList = memo(function MessageList({
  messages,
  loading,
  onQuickQuestion,
  isMobileExpanded
}: {
  messages: Message[]
  loading: boolean
  onQuickQuestion: (q: string) => void
  isMobileExpanded: boolean
}): React.JSX.Element {
  // No scroll logic needed: newest messages are at the top

  return (
    <div className={`${isMobileExpanded ? 'flex-1 min-h-0' : 'h-[calc(100%-40px)]'} overflow-y-auto px-3 py-2 space-y-2.5 scrollbar-thin`}>
      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <div className="text-center">
            <p className="text-xs text-zinc-400">Ask an intelligence question</p>
            <p className="mt-0.5 text-[10px] text-zinc-600">
              Answers are grounded in retrieved source material via RAG.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onQuickQuestion(q)}
                className="rounded-full border border-zinc-700/60 bg-zinc-800/50 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-sky-600/50 hover:text-sky-300"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              sources={msg.sources}
              confidence={msg.confidence}
              createdAt={msg.createdAt}
            />
          ))}
          {loading && (
            <div className="flex items-start gap-2">
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/80 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <svg className="h-3 w-3 animate-spin text-sky-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-[10px] text-zinc-500">Analyzing sources…</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
})

// ─── Component ─────────────────────────────────────────────────────────────

interface AiAssistantStripProps {
  expanded?: boolean
}

export function AiAssistantStrip({ expanded: expandedProp }: AiAssistantStripProps): React.JSX.Element {
  const [expandedInternal, setExpandedInternal] = useState(false)
  const expanded = expandedProp ?? expandedInternal
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [exportingConv, setExportingConv] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Detect Electron vs Web context ──
  const isElectron = typeof window.api !== 'undefined' && typeof window.api.ai?.clearHistory === 'function'

  // ── Load history on mount ──
  useEffect(() => {
    async function loadHistory(): Promise<void> {
      try {
        let rows
        if (typeof window.api !== 'undefined' && window.api.ai?.getHistory) {
          rows = await window.api.ai.getHistory(50)
        } else {
          const res = await fetch('/api/ai/history?limit=50')
          rows = await res.json()
        }
        if (rows && rows.length > 0) {
          const loaded: Message[] = rows
            .map((r) => ({
              id: r.id,
              role: r.role,
              content: r.content,
              sources: r.sources ? (typeof r.sources === 'string' ? JSON.parse(r.sources) : r.sources) : undefined,
              confidence: r.confidence ?? undefined,
              createdAt: r.created_at
            }))
          setMessages(loaded)
        }
      } catch (err) {
        console.error('[AiAssistant] Failed to load history:', err)
      }
    }
    loadHistory()
  }, [])

  // ── Send message ──
  const sendMessage = useCallback(
    async (text?: string): Promise<void> => {
      const msg = (text ?? input).trim()
      if (!msg || loading) return

      setInput('')
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: msg,
        createdAt: new Date().toISOString()
      }
      setMessages((prev) => [userMsg, ...prev])
      setLoading(true)

      if (!expanded) setExpandedInternal(true)

      try {
        let response
        if (typeof window.api !== 'undefined' && window.api.ai?.chat) {
          response = await window.api.ai.chat(msg)
        } else {
          const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
          })
          response = await res.json()
        }
        const assistantMsg: Message = {
          id: response.id,
          role: 'assistant',
          content: response.content,
          sources: response.sources,
          confidence: response.confidence,
          createdAt: response.createdAt
        }
        setMessages((prev) => [assistantMsg, ...prev])
      } catch (err) {
        console.error('[AiAssistant] Chat error:', err)
        const errorMsg: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'An error occurred while processing your query. Please try again.',
          createdAt: new Date().toISOString()
        }
        setMessages((prev) => [errorMsg, ...prev])
      }
      setLoading(false)
      inputRef.current?.focus()
    },
    [input, loading, expanded]
  )

  const handleClearChat = async (): Promise<void> => {
    try {
      if (isElectron) {
        await window.api.ai.clearHistory()
      } else {
        await fetch('/api/ai/history', { method: 'DELETE' })
      }
      setMessages([])
    } catch (err) {
      console.error('[AiAssistant] Failed to clear history:', err)
    }
  }

  const handleExportConversation = async (format: 'md' | 'pdf'): Promise<void> => {
    setExportingConv(true)
    try {
      if (typeof window.api !== 'undefined' && window.api.chatExport?.conversationMarkdown) {
        if (format === 'md') {
          await window.api.chatExport.conversationMarkdown()
        } else {
          await window.api.chatExport.conversationPdf()
        }
      } else {
        const url = format === 'md' ? '/api/ai/export/markdown' : '/api/ai/export/pdf'
        window.open(url, '_blank')
      }
    } catch (err) {
      console.error('[AiAssistant] Conversation export failed:', err)
    } finally {
      setExportingConv(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const isMobileExpanded = expandedProp === true

  return (
    <div className={`border-t border-zinc-800 bg-zinc-950/80 ${isMobileExpanded ? 'flex flex-col flex-1 min-h-0' : 'shrink-0 transition-[height] duration-200'} ${expanded && !isMobileExpanded ? 'h-[240px]' : !isMobileExpanded ? 'h-auto' : ''}`}>
      {/* ── Chat area (when expanded) ── */}
      {expanded && (
        <MessageList
          messages={messages}
          loading={loading}
          onQuickQuestion={(q) => sendMessage(q)}
          isMobileExpanded={isMobileExpanded}
        />
      )}

      {/* ── Input bar ── */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpandedInternal(!expanded)}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300"
          title={expanded ? 'Collapse chat' : 'Expand chat'}
        >
          <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-wider">AI</span>
        </button>

        <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />

        {expanded && messages.length > 0 && (
          <div className="flex items-center gap-0.5 opacity-50 transition-opacity hover:opacity-100">
            <button
              type="button"
              onClick={() => handleExportConversation('md')}
              disabled={exportingConv}
              title="Export conversation as Markdown"
              className="rounded px-1 py-0.5 text-[9px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
            >
              📄
            </button>
            <button
              type="button"
              onClick={() => handleExportConversation('pdf')}
              disabled={exportingConv}
              title="Export conversation as PDF"
              className="rounded px-1 py-0.5 text-[9px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
            >
              📋
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              title="Clear chat history"
              className="rounded px-1 py-0.5 text-[9px] text-zinc-400 hover:bg-red-900/40 hover:text-red-300 transition-colors"
            >
              🗑️
            </button>
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask an intelligence question…"
          disabled={loading}
          spellCheck={true}
          className="flex-1 bg-transparent text-[12px] text-zinc-200 placeholder-zinc-600 outline-none disabled:opacity-50"
        />

        <button
          type="button"
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="rounded bg-sky-600 px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600"
        >
          Send
        </button>
      </div>
    </div>
  )
}