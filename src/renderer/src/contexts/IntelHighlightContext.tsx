import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'

interface IntelHighlightContextType {
  /** The currently highlighted intel item ID (null = none) */
  highlightedId: string | null
  /** Call this to highlight an intel item on the map. Pass null to clear. */
  highlight: (id: string | null) => void
  /** Register a callback to flash a marker on the map */
  registerFlashCallback: (cb: (id: string) => void) => void
}

const IntelHighlightContext = createContext<IntelHighlightContextType>({
  highlightedId: null,
  highlight: () => {},
  registerFlashCallback: () => {}
})

export function IntelHighlightProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const flashCallbackRef = useRef<((id: string) => void) | null>(null)

  const highlight = useCallback((id: string | null) => {
    setHighlightedId(id)
    if (id && flashCallbackRef.current) {
      flashCallbackRef.current(id)
    }
  }, [])

  const registerFlashCallback = useCallback((cb: (id: string) => void) => {
    flashCallbackRef.current = cb
  }, [])

  return (
    <IntelHighlightContext.Provider value={{ highlightedId, highlight, registerFlashCallback }}>
      {children}
    </IntelHighlightContext.Provider>
  )
}

export function useIntelHighlight(): IntelHighlightContextType {
  return useContext(IntelHighlightContext)
}