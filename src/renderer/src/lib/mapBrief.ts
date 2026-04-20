/**
 * mapBrief – Global bridge between Mapbox popup HTML buttons and React components.
 *
 * Popup HTML runs in a plain DOM context (no React), so we expose a global
 * `__requestBrief` function that the "Generate Brief" button's onclick can call.
 * The SituationMap component registers the actual handler that invokes the
 * IPC brief endpoint and renders the result popup.
 */

type BriefHandler = (type: string, data: Record<string, unknown>) => void

let briefHandler: BriefHandler | null = null

/** Register the handler from the React tree (SituationMap). */
export function setBriefHandler(handler: BriefHandler): void {
  briefHandler = handler
}

// Called from popup HTML onclick
;(window as any).__requestBrief = (type: string, dataJson: string): void => {
  if (briefHandler) {
    try {
      briefHandler(type, JSON.parse(dataJson))
    } catch (err) {
      console.error('[mapBrief] Failed to parse brief data:', err)
    }
  } else {
    console.warn('[mapBrief] No handler registered – brief request ignored')
  }
}