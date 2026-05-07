/**
 * Shared region bounding box definitions.
 *
 * Split into two categories:
 * - TRANSIT_CORRIDORS: Small precise boxes around choke point shipping lanes
 * - REGION_AREAS: Broad geographic zones for context, alert rules, and intel filtering
 *
 * REGIONS is kept as the combined list for backward compatibility.
 */

/**
 * Transit corridors: small precise boxes around choke point shipping lanes.
 * These are the navigable passage areas that ships actually transit through.
 */
export const TRANSIT_CORRIDORS = [
  { name: 'Strait of Hormuz', minLat: 26.45, maxLat: 26.7, minLon: 56.35, maxLon: 56.6 },
  { name: 'Bab el-Mandeb', minLat: 12.5, maxLat: 12.8, minLon: 43.25, maxLon: 43.55 },
  { name: 'Suez Canal', minLat: 29.92, maxLat: 31.27, minLon: 32.28, maxLon: 32.7 },
  { name: 'Strait of Malacca', minLat: 1.3, maxLat: 2.5, minLon: 101.2, maxLon: 102.6 },
  { name: 'Panama Canal', minLat: 8.9, maxLat: 9.45, minLon: -80.0, maxLon: -79.5 },
  { name: 'Taiwan Strait', minLat: 23.5, maxLat: 25.0, minLon: 118.8, maxLon: 120.0 },
  { name: 'Bosphorus', minLat: 41.0, maxLat: 41.22, minLon: 28.95, maxLon: 29.12 },
  { name: 'Gibraltar', minLat: 35.85, maxLat: 36.15, minLon: -5.65, maxLon: -5.3 }
] as const

/**
 * Region areas: broad geographic zones for context, alert rules, and intel filtering.
 * Larger than transit corridors. Can be toggled independently.
 */
export const REGION_AREAS = [
  { name: 'Persian Gulf', minLat: 24.0, maxLat: 30.5, minLon: 47.0, maxLon: 57.0 },
  { name: 'Eastern Mediterranean', minLat: 31.0, maxLat: 37.0, minLon: 30.0, maxLon: 36.0 },
  { name: 'Black Sea', minLat: 41.0, maxLat: 47.0, minLon: 27.0, maxLon: 42.0 },
  { name: 'Red Sea', minLat: 12.5, maxLat: 22.0, minLon: 38.0, maxLon: 44.5 },
  { name: 'Gulf of Aden', minLat: 11.0, maxLat: 15.0, minLon: 43.0, maxLon: 52.0 },
  { name: 'Arabian Sea', minLat: 8.0, maxLat: 26.0, minLon: 55.0, maxLon: 75.0 },
  { name: 'Gulf of Oman', minLat: 22.5, maxLat: 26.0, minLon: 56.0, maxLon: 60.5 },
  { name: 'South China Sea', minLat: 3.0, maxLat: 23.0, minLon: 104.0, maxLon: 120.0 },
  { name: 'East China Sea', minLat: 25.0, maxLat: 33.0, minLon: 120.0, maxLon: 130.0 },
  { name: 'Korean Peninsula', minLat: 34.0, maxLat: 43.0, minLon: 124.0, maxLon: 131.0 },
  { name: 'Sea of Japan', minLat: 35.0, maxLat: 52.0, minLon: 128.0, maxLon: 142.0 },
  { name: 'Baltic Sea', minLat: 53.0, maxLat: 66.0, minLon: 10.0, maxLon: 30.0 },
  { name: 'North Atlantic', minLat: 25.0, maxLat: 65.0, minLon: -80.0, maxLon: 0.0 },
  { name: 'Indian Ocean', minLat: -40.0, maxLat: 8.0, minLon: 40.0, maxLon: 100.0 },
  { name: 'Arctic', minLat: 70.0, maxLat: 90.0, minLon: -180.0, maxLon: 180.0 }
] as const

// Keep REGIONS as the full combined list for backward compatibility
// (alert rules, intel filtering, AIS region matching, etc. still use this)
export const REGIONS = [...TRANSIT_CORRIDORS, ...REGION_AREAS] as const

export type RegionName = (typeof REGIONS)[number]['name']