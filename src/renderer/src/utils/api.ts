/**
 * Unified API client that works in both Electron (via preload bridge)
 * and browser (via HTTP fetch to the local server).
 */

const HTTP_BASE = `${window.location.origin}/api`

/**
 * Detect whether we're running inside Electron (with preload bridge)
 * or in a plain browser (HTTP server mode).
 */
export function isInElectron(): boolean {
  return !!(window as any).api
}

/**
 * Fetch data from the HTTP API server (browser context only).
 * In Electron, use window.api directly instead.
 */
export async function apiFetch<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${HTTP_BASE}${endpoint}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.json() as Promise<T>
}