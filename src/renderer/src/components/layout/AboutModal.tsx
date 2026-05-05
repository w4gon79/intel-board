/**
 * About Modal — version, app info, and links.
 */

interface AboutModalProps {
  open: boolean
  onClose: () => void
}

const APP_VERSION = '0.2.0'
const APP_NAME = 'Intel Board'
const APP_DESCRIPTION = 'RAG-grounded intelligence dashboard'

export function AboutModal({ open, onClose }: AboutModalProps): React.JSX.Element {
  if (!open) return <></>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{APP_NAME}</h2>
            <p className="text-[11px] text-zinc-500">{APP_DESCRIPTION}</p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-500">Version</span>
            <span className="font-mono text-zinc-300">{APP_VERSION}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Stack</span>
            <span className="text-zinc-300">Electron + React</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Map</span>
            <span className="text-zinc-300">MapLibre GL</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">AI</span>
            <span className="text-zinc-300">Ollama + RAG</span>
          </div>
        </div>

        <div className="mt-3 space-y-1.5 text-[11px] text-zinc-500">
          <p>Data sources: USNI, GDELT, NewsAPI, AIS, FRED, Yahoo Finance</p>
          <p>Intel tiers: ALERT, WATCH, CONTEXT</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          Close
        </button>
      </div>
    </div>
  )
}