/**
 * Side-effect patch: make maplibre-gl v6 workers loadable under Electron's
 * file:// origin in packaged builds.
 *
 * maplibre-gl v6 derives its worker URL from import.meta.url and returns an
 * EMPTY string for non-http(s) origins (see its dist worker-URL resolver).
 * new Worker('') then fails, which silently kills ALL GeoJSON layer
 * rendering: raster basemap tiles still draw, so the map looks healthy,
 * but flight/ship/carrier markers never appear. (Dev works because the
 * Vite dev server is an http origin.)
 *
 * The worker file also imports a sibling module (maplibre-gl-shared.mjs),
 * so it cannot simply be served as a standalone blob. Instead we import
 * it through Vite's `?worker&inline` loader, which bundles the worker with
 * its dependency and inlines it as a self-contained blob worker at build
 * time. The intercepted constructor returns that fully bundled worker.
 */

// Bundled (deps inlined) self-contained worker constructor
import MaplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&inline'

if (typeof window !== 'undefined' && location.protocol === 'file:') {
  const OriginalWorker = window.Worker

  // Replace with a factory-style constructor: returning an object from a
  // constructor invoked with `new` makes JS use the returned instance.
  const patchedWorker = function (
    this: Worker,
    url: string | URL,
    options?: WorkerOptions
  ): Worker {
    const u = String(url)
    if (u === '' || u.includes('maplibre-gl-worker')) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return new MaplibreWorker()
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return new OriginalWorker(url, options)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as new (url: string | URL, options?: WorkerOptions) => Worker

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).Worker = patchedWorker
}
