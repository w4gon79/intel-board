/**
 * Viewport-based GeoJSON filtering utility.
 *
 * Filters features to only those within the current map viewport,
 * with configurable padding for smooth panning.
 * Military features are always included regardless of viewport bounds.
 */

/** Minimal map interface to avoid importing mapbox-gl (keeps TS strict mode happy). */
interface MapViewport {
  getBounds(): {
    getSouthWest(): { lng: number; lat: number }
    getNorthEast(): { lng: number; lat: number }
  } | null
}

/**
 * Filter GeoJSON Point features to only those within the current map viewport,
 * with a configurable padding to pre-load features just outside the view.
 */
export function filterByViewport<T extends { geometry: { type: string; coordinates: number[] } }>(
  features: T[],
  map: MapViewport,
  paddingDegrees: number = 2
): T[] {
  const bounds = map.getBounds()
  if (!bounds) return features

  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()

  const minLon = sw.lng - paddingDegrees
  const maxLon = ne.lng + paddingDegrees
  const minLat = sw.lat - paddingDegrees
  const maxLat = ne.lat + paddingDegrees

  return features.filter((f) => {
    if (f.geometry.type !== 'Point') return false
    const coords = f.geometry.coordinates
    if (!coords || coords.length < 2) return false
    const [lon, lat] = coords
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
  })
}

/**
 * Split features into military and non-military, apply viewport filtering
 * only to non-military, then recombine. Military features are ALWAYS included.
 */
export function filterFeaturesWithMilitary<T extends { geometry: { type: string; coordinates: number[] }; properties: { is_military: boolean | number } }>(
  features: T[],
  map: MapViewport,
  paddingDegrees: number = 2
): T[] {
  const military = features.filter((f) => {
    const mil = f.properties.is_military
    return mil === true || mil === 1
  })
  const nonMilitary = features.filter((f) => {
    const mil = f.properties.is_military
    return mil !== true && mil !== 1
  })

  const filteredNonMilitary = filterByViewport(nonMilitary, map, paddingDegrees)
  return [...military, ...filteredNonMilitary]
}