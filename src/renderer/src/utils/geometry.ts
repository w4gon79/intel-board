/**
 * Shared geometry utilities for map drawing.
 * Used by both MapDrawLayer (alert zones) and TacticalOverlayLayer (annotations).
 */

/**
 * Generate a circle polygon approximation (32-sided) from center + radius.
 * Returns a GeoJSON Polygon ring (array of [lng, lat] positions).
 */
export function circleToPolygon(
  center: [number, number],
  radiusKm: number,
  segments = 32
): [number, number][] {
  const coords: [number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI
    const latOffset = (radiusKm / 111.32) * Math.cos(angle)
    const lngOffset = (radiusKm / (111.32 * Math.cos((center[1] * Math.PI) / 180))) * Math.sin(angle)
    coords.push([center[0] + lngOffset, center[1] + latOffset])
  }
  return coords
}

/**
 * Compute the centroid of a polygon ring.
 */
export function polygonCentroid(coords: [number, number][]): [number, number] {
  let lng = 0
  let lat = 0
  for (const c of coords) {
    lng += c[0]
    lat += c[1]
  }
  return [lng / coords.length, lat / coords.length]
}

/**
 * Calculate distance between two [lng, lat] points using Haversine formula.
 * Returns distance in kilometers.
 */
export function haversineDistance(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}