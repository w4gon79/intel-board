/**
 * Mapbox GL JS POSTs usage events to events.mapbox.com. DNS filters / Pi-hole / AdGuard
 * often block that host → net::ERR_NAME_NOT_RESOLVED in devtools (tiles use api.mapbox.com and still work).
 *
 * - In **development**, we short-circuit those fetches by default so the console stays clean.
 *   Set `VITE_MAPBOX_SILENCE_EVENTS=false` to allow real event POSTs while developing.
 * - In **production**, short-circuit only when `VITE_MAPBOX_SILENCE_EVENTS=true` (e.g. offline/air-gapped builds).
 *
 * Prefer allowing `events.mapbox.com` on your network if you rely on Mapbox usage reporting.
 */
const PATCH_KEY = '__intelBoardMapboxFetchSilencer'

type PatchState = {
  orig: typeof fetch
  refcount: number
}

function isMapboxEventsUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin)
    return u.hostname === 'events.mapbox.com' || u.hostname === 'events.mapbox.cn'
  } catch {
    return url.includes('events.mapbox.com') || url.includes('events.mapbox.cn')
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function shouldSilenceEvents(): boolean {
  if (
    import.meta.env.VITE_MAPBOX_SILENCE_EVENTS === 'false' ||
    import.meta.env.VITE_MAPBOX_SILENCE_EVENTS === '0'
  ) {
    return false
  }
  if (
    import.meta.env.VITE_MAPBOX_SILENCE_EVENTS === 'true' ||
    import.meta.env.VITE_MAPBOX_SILENCE_EVENTS === '1'
  ) {
    return true
  }
  return import.meta.env.DEV
}

export function installMapboxEventsFetchSilencer(): () => void {
  if (!shouldSilenceEvents()) {
    return () => {}
  }

  const w = window as Window & { [PATCH_KEY]?: PatchState }
  if (!w[PATCH_KEY]) {
    const orig = window.fetch.bind(window)
    w[PATCH_KEY] = { orig, refcount: 0 }
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (isMapboxEventsUrl(requestUrl(input))) {
        return Promise.resolve(
          new Response('[]', { status: 200, headers: { 'Content-Type': 'text/plain' } })
        )
      }
      return orig(input, init)
    }
  }

  w[PATCH_KEY]!.refcount += 1

  return () => {
    const state = w[PATCH_KEY]
    if (!state) return
    state.refcount -= 1
    if (state.refcount <= 0) {
      window.fetch = state.orig
      delete w[PATCH_KEY]
    }
  }
}
