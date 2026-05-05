import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'

interface IntelHighlightContextType {
  /** The currently highlighted intel item ID (null = none) */
  highlightedId: string | null
  /** Call this to highlight an intel item on the map. Pass null to clear. */
  highlight: (id: string | null) => void
  /** Register a callback to flash a marker on the map */
  registerFlashCallback: (cb: (id: string) => void) => void
  /** Unregister a flash callback */
  unregisterFlashCallback: (cb: (id: string) => void) => void
}

const IntelHighlightContext = createContext<IntelHighlightContextType>({
  highlightedId: null,
  highlight: () => {},
  registerFlashCallback: () => {},
  unregisterFlashCallback: () => {}
})

export function IntelHighlightProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const flashCallbacksRef = useRef<Set<(id: string) => void>>(new Set())

  const highlight = useCallback((id: string | null) => {
    setHighlightedId(id)
    if (id) {
      for (const cb of flashCallbacksRef.current) {
        cb(id)
      }
    }
  }, [])

  const registerFlashCallback = useCallback((cb: (id: string) => void) => {
    flashCallbacksRef.current.add(cb)
  }, [])

  const unregisterFlashCallback = useCallback((cb: (id: string) => void) => {
    flashCallbacksRef.current.delete(cb)
  }, [])

  return (
    <IntelHighlightContext.Provider value={{ highlightedId, highlight, registerFlashCallback, unregisterFlashCallback }}>
      {children}
    </IntelHighlightContext.Provider>
  )
}

export function useIntelHighlight(): IntelHighlightContextType {
  return useContext(IntelHighlightContext)
}