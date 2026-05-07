/**
 * USNI Fleet Tracker Scraper (Phase 4F)
 *
 * Scrapes the USNI News Fleet & Marine Tracker for carrier strike group
 * and amphibious ready group positions. Runs weekly.
 *
 * Uses Node.js built-in https module — no external dependencies.
 */

import https from 'https'
import { chromium } from 'playwright'
import { getDatabase } from '../storage/database'

// ── Operating area → approximate coordinates ─────────────────

export const AREA_COORDS: Record<string, { lat: number; lon: number }> = {
  'western pacific': { lat: 22, lon: 135 },
  'south china sea': { lat: 12, lon: 114 },
  'persian gulf': { lat: 26, lon: 52 },
  'gulf of oman': { lat: 24, lon: 58 },
  'red sea': { lat: 17, lon: 40 },
  'eastern mediterranean': { lat: 34, lon: 35 },
  'north arabian sea': { lat: 22, lon: 62 },
  'indian ocean': { lat: -5, lon: 72 },
  'western atlantic': { lat: 32, lon: -70 },
  'eastern atlantic': { lat: 35, lon: -30 },
  'norfolk': { lat: 36.95, lon: -76.33 },
  'san diego': { lat: 32.73, lon: -117.20 },
  'yokosuka': { lat: 35.29, lon: 139.67 },
  'middle east': { lat: 26, lon: 50 },
  'indo-pacific': { lat: 15, lon: 130 },
  'europe': { lat: 48, lon: 10 },
  'arabian gulf': { lat: 26, lon: 52 },
  'mediterranean': { lat: 35, lon: 18 },
  'pacific': { lat: 10, lon: 155 },
  'atlantic': { lat: 30, lon: -40 },
  'gulf': { lat: 26, lon: 52 },
  'north sea': { lat: 56, lon: 3 },
  'baltic': { lat: 58, lon: 18 },
  'black sea': { lat: 43, lon: 34 },
  'philippine sea': { lat: 20, lon: 130 },
  'sea of japan': { lat: 40, lon: 135 },
  'east china sea': { lat: 28, lon: 125 },
  'strait of hormuz': { lat: 26.5, lon: 56.75 },
  'gulf of aden': { lat: 12, lon: 45 },
  'bab el-mandeb': { lat: 12.6, lon: 43.3 },
  'central pacific': { lat: 10, lon: -170 },
  'eastern pacific': { lat: 15, lon: -110 },
  'southern pacific': { lat: -20, lon: -150 },
  'arabian sea': { lat: 22, lon: 62 },
  'caribbean sea': { lat: 16, lon: -72 },
  'centcom': { lat: 26, lon: 50 },
  'pearl harbor': { lat: 21.37, lon: -157.93 },
  'hawaii': { lat: 21.37, lon: -157.93 },
  'panama': { lat: 9.0, lon: -79.5 },
  'panama city': { lat: 9.0, lon: -79.5 },
  'yokosuka japan': { lat: 35.29, lon: 139.67 },
  'guam': { lat: 13.44, lon: 144.79 },
  'diego garcia': { lat: -7.31, lon: 72.42 },
  'okinawa': { lat: 26.33, lon: 127.77 },
  'bahrein': { lat: 26.23, lon: 50.59 },
  'bahrain': { lat: 26.23, lon: 50.59 },
  'djibouti': { lat: 11.59, lon: 43.15 },
  'sasebo': { lat: 33.16, lon: 129.72 },
  'groton': { lat: 41.38, lon: -72.08 },
  'kings bay': { lat: 30.78, lon: -81.53 },
  'jacksonville': { lat: 30.33, lon: -81.66 },
  'puget sound': { lat: 47.55, lon: -122.63 },
  'bremerton': { lat: 47.57, lon: -122.63 },
  'newport news': { lat: 36.99, lon: -76.46 },
  'split': { lat: 43.51, lon: 16.44 },
  'mayport': { lat: 30.39, lon: -81.42 },
  'rota': { lat: 36.65, lon: -6.35 },
  'off the coast of africa': { lat: 10, lon: -17 },
  'west africa': { lat: 10, lon: -17 },
  'gulf of guinea': { lat: 4, lon: 3 },
  '5th fleet': { lat: 26, lon: 52 },
  '6th fleet': { lat: 35, lon: 18 },
  '7th fleet': { lat: 35, lon: 140 },
  '4th fleet': { lat: 10, lon: -70 },
  '2nd fleet': { lat: 35, lon: -50 },
  '3rd fleet': { lat: 32, lon: -125 },
  'central command': { lat: 26, lon: 50 },
  'horn of africa': { lat: 8, lon: 48 },
  'somali basin': { lat: 5, lon: 50 },
  'off the coast of israel': { lat: 32, lon: 34 },
  'off the coast of yemen': { lat: 14, lon: 44 },
  'off the coast of iran': { lat: 26, lon: 57 },
  'sulu sea': { lat: 6, lon: 121 },
  'celebes sea': { lat: 3, lon: 123 },
  'mindanao sea': { lat: 9, lon: 124 },
  'south atlantic': { lat: -25, lon: -20 },
  'north atlantic': { lat: 40, lon: -40 },
  'mozambique channel': { lat: -18, lon: 42 },
  'andaman sea': { lat: 12, lon: 96 }
}

// ── Vessel type patterns ─────────────────────────────────────

const VESSEL_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\bCVN\s*[-]?\s*\d+/i, type: 'CVN' },
  { pattern: /\bCV\s*[-]?\s*\d+/i, type: 'CV' },
  { pattern: /\bLHD\s*[-]?\s*\d+/i, type: 'LHD' },
  { pattern: /\bLHA\s*[-]?\s*\d+/i, type: 'LHA' },
  { pattern: /\bLCC\s*[-]?\s*\d+/i, type: 'LCC' },
  { pattern: /\bLSD\s*[-]?\s*\d+/i, type: 'LSD' },
  { pattern: /\bLPD\s*[-]?\s*\d+/i, type: 'LPD' },
  { pattern: /\bCG\s*[-]?\s*\d+/i, type: 'CG' },
  { pattern: /\bDDG\s*[-]?\s*\d+/i, type: 'DDG' },
  { pattern: /\bDD\s*[-]?\s*\d+/i, type: 'DD' },
  { pattern: /\bFFG\s*[-]?\s*\d+/i, type: 'FFG' },
  { pattern: /\bFF\s*[-]?\s*\d+/i, type: 'FF' },
  { pattern: /\bSSN\s*[-]?\s*\d+/i, type: 'SSN' },
  { pattern: /\bSSBN\s*[-]?\s*\d+/i, type: 'SSBN' },
  { pattern: /\bAOE\s*[-]?\s*\d+/i, type: 'AOE' },
  { pattern: /\bT-AO\b/i, type: 'AO' },
  { pattern: /\bT-AKE\b/i, type: 'AKE' },
  { pattern: /\bMCM\s*[-]?\s*\d+/i, type: 'MCM' },
  { pattern: /\bPC\s*[-]?\s*\d+/i, type: 'PC' },
  { pattern: /\bSSBN/i, type: 'SSBN' }
]


// ── HTTP fetch helper ────────────────────────────────────────

export function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 30000
    }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject)
        return
      }
      if (res.statusCode && res.statusCode === 403) {
        // Bot protection detected, fall back to headless browser
        console.log('[CSG-Scraper] HTTP 403 detected, falling back to headless browser')
        fetchUrlWithBrowser(url).then(resolve).catch(reject)
        return
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => resolve(body))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
  })
}

export /** Fetch a URL using system Chrome (bypasses Cloudflare/bot protection) */
async function fetchUrlWithBrowser(url: string): Promise<string> {
  console.log(`[CSG-Scraper] Fetching with system Chrome: ${url}`)
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--window-position=-2400,-2400'
    ]
  })
  try {
    const page = await browser.newPage()
    
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })
    
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
    
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    })
    
    if (!response || response.status() >= 400) {
      throw new Error(`HTTP ${response?.status() || 'no response'} for ${url}`)
    }
    
    // Wait for Cloudflare challenge to resolve and content to load
    await page.waitForTimeout(8000)
    
    // Verify we got past Cloudflare
    const title = await page.title()
    if (title.includes('Just a moment') || title.includes('Checking')) {
      // Still on challenge page, wait more
      console.log('[CSG-Scraper] Cloudflare challenge detected, waiting...')
      await page.waitForTimeout(10000)
    }
    
    // Wait for article content
    await page.waitForSelector('article, .entry-content, .post-content', { timeout: 10000 }).catch(() => {})
    
    const html = await page.content()
    console.log(`[CSG-Scraper] Successfully fetched ${html.length} bytes`)
    return html
  } finally {
    await browser.close()
  }
}

// ── HTML parsing helpers (no cheerio dependency) ─────────────

export /** Extract text content between tags, strip HTML */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Find all URLs matching a pattern in href attributes */
function findLinks(html: string, pattern: RegExp): string[] {
  const links: string[] = []
  const hrefRegex = /href=["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = hrefRegex.exec(html)) !== null) {
    if (pattern.test(match[1])) {
      links.push(match[1])
    }
  }
  return links
}

/** Extract content between balanced opening/closing tags by counting nesting depth */
function extractBalanced(html: string, openPattern: RegExp, tagName: string): string | null {
  const startMatch = html.match(openPattern)
  if (!startMatch) return null

  const contentStart = startMatch.index! + startMatch[0].length
  const openRegex = new RegExp(`<${tagName}[\\s>]`, 'gi')
  const closeRegex = new RegExp(`<\\/${tagName}>`, 'gi')
  let depth = 1
  let pos = contentStart

  while (depth > 0 && pos < html.length) {
    openRegex.lastIndex = pos
    closeRegex.lastIndex = pos
    const nextOpen = openRegex.exec(html)
    const nextClose = closeRegex.exec(html)

    if (!nextClose) break
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++
      pos = nextOpen.index + nextOpen[0].length
    } else {
      depth--
      if (depth === 0) return html.substring(contentStart, nextClose.index)
      pos = nextClose.index + nextClose[0].length
    }
  }
  return html.substring(contentStart)
}

/** Extract the main article body content */
export function extractArticleBody(html: string): string {
  // Try entry-content div first (WordPress standard - USNI uses WordPress)
  // This is more reliable than <article> for WordPress sites
  const entryContent = extractBalanced(html, /class="[^"]*(?:entry-content|post-content|article-body)[^"]*"[^>]*>/i, 'div')
  if (entryContent && entryContent.length > 200) {
    console.log(`[CSG-Scraper] Extracted article body from entry-content div (${entryContent.length} chars)`)
    return entryContent
  }

  // Try article tag with nesting-aware extraction
  const articleContent = extractBalanced(html, /<article[^>]*>/i, 'article')
  if (articleContent && articleContent.length > 200) {
    console.log(`[CSG-Scraper] Extracted article body from <article> tag (${articleContent.length} chars)`)
    return articleContent
  }

  // Last resort: body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) {
    console.log(`[CSG-Scraper] Falling back to <body> content (${bodyMatch[1].length} chars)`)
    return bodyMatch[1]
  }

  console.log(`[CSG-Scraper] WARNING: No article body found, using raw HTML (${html.length} chars)`)
  return html
}

// ── Parse operating area from text ──────────────────────────

function findOperatingArea(text: string): { area: string; coords: { lat: number; lon: number } } | null {
  const lower = text.toLowerCase()

  // Check for exact area matches (longest first to avoid partial matches)
  const sortedAreas = Object.keys(AREA_COORDS).sort((a, b) => b.length - a.length)
  for (const area of sortedAreas) {
    if (lower.includes(area)) {
      return { area, coords: AREA_COORDS[area] }
    }
  }
  return null
}

// ── Extract hull number from vessel text ─────────────────────

function extractHullNumber(text: string): string | null {
  for (const { pattern, type } of VESSEL_TYPE_PATTERNS) {
    if (pattern.test(text)) {
      const match = text.match(new RegExp(type.replace('-', '\\s*-\\s*') + '\\s*[-]?\\s*\\d+[A-Z]?', 'i'))
      if (match) return match[0].toUpperCase().replace(/\s+/g, '')
    }
  }
  return null
}

// ── Parse vessel type from hull number ───────────────────────

function getVesselType(hullNumber: string | null): string | null {
  if (!hullNumber) return null
  const upper = hullNumber.toUpperCase()
  if (upper.startsWith('CVN') || upper.startsWith('CV')) return 'CVN'
  if (upper.startsWith('LHD') || upper.startsWith('LHA')) return 'LHD'
  if (upper.startsWith('LCC')) return 'LCC'
  if (upper.startsWith('LSD')) return 'LSD'
  if (upper.startsWith('LPD')) return 'LPD'
  if (upper.startsWith('CG')) return 'CG'
  if (upper.startsWith('DDG') || upper.startsWith('DD')) return 'DDG'
  if (upper.startsWith('FFG') || upper.startsWith('FF')) return 'FFG'
  if (upper.startsWith('SSN') || upper.startsWith('SSBN')) return 'SSN'
  if (upper.startsWith('AOE') || upper.startsWith('AO') || upper.startsWith('AKE')) return 'AOE'
  if (upper.startsWith('MCM')) return 'MCM'
  return null
}

// ── Parsed group structure ───────────────────────────────────

interface ParsedGroup {
  name: string
  designation: string
  flagship: string | null
  status: string
  operatingArea: string | null
  lat: number | null
  lon: number | null
  vessels: Array<{
    vessel_name: string
    vessel_type: string | null
    hull_number: string | null
  }>
}

/**
 * Parse fleet tracker article HTML for carrier groups and amphibious ready groups.
 *
 * The USNI Fleet Tracker typically uses a format like:
 *   "Carrier Strike Group 2" / "CSG-2"
 *   USS Eisenhower (CVN-69) operating in the Eastern Mediterranean
 *   USS Philippine Sea (CG-58)
 *   USS Gravely (DDG-107)
 *   USS Mason (DDG-87)
 */
function parseFleetTrackerArticle(html: string): ParsedGroup[] {
  const body = stripHtml(extractArticleBody(html))
  const groups: ParsedGroup[] = []

  // Split into sections by group headers
  // Pattern: "Carrier Strike Group N", "CSG-N", "Amphibious Ready Group", "ARG"
  const groupRegex = /((?:Carrier\s+Strike\s+Group\s+\d+|CSG[-–]\s*\d+|Amphibious\s+Ready\s+Group\s+\d*|ARG[-–]\s*\d*|Expeditionary\s+Strike\s+Group\s+\d+|ESG[-–]\s*\d*))/gi

  const sections: Array<{ header: string; text: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = groupRegex.exec(body)) !== null) {
    if (lastIndex > 0 || sections.length > 0) {
      // Close previous section
      if (sections.length > 0) {
        sections[sections.length - 1].text = body.substring(lastIndex, match.index).trim()
      }
    }
    sections.push({ header: match[1].trim(), text: '' })
    lastIndex = match.index + match[0].length
  }

  // Close last section
  if (sections.length > 0) {
    sections[sections.length - 1].text = body.substring(lastIndex).trim()
  }

  // If no group headers found, try to parse the whole text as one group
  if (sections.length === 0) {
    // Check if the article mentions carriers at all
    if (/USS\s+\w+.*CVN/i.test(body) || /carrier/i.test(body)) {
      sections.push({
        header: 'Carrier Strike Group',
        text: body
      })
    }
  }

  for (const section of sections) {
    const group = parseGroupSection(section.header, section.text)
    if (group && group.vessels.length > 0) {
      groups.push(group)
    }
  }

  return groups
}

function parseGroupSection(header: string, text: string): ParsedGroup | null {
  // Extract designation from header
  const desigMatch = header.match(/(?:CSG|ARG|ESG)\s*[-–]?\s*(\d+)/i)
  const designation = desigMatch
    ? `${header.match(/CSG|ARG|ESG/i)![0].toUpperCase()}-${desigMatch[1]}`
    : null

  // Determine group type for naming
  const isArg = /amphibious|ARG/i.test(header)
  const isEsg = /expeditionary|ESG/i.test(header)
  const groupType = isEsg ? 'ESG' : isArg ? 'ARG' : 'CSG'

  // Find operating area for the group
  const areaInfo = findOperatingArea(text)

  // Extract vessels (USS ... patterns)
  const vesselRegex = /USS\s+([\w.\s]+?)\s*(?:\(([^)]+)\))/gi
  const vessels: ParsedGroup['vessels'] = []
  let flagship: string | null = null
  let vesselMatch: RegExpExecArray | null

  while ((vesselMatch = vesselRegex.exec(text)) !== null) {
    const vesselName = `USS ${vesselMatch[1].trim()}`
    const parenthetical = vesselMatch[2]?.trim() ?? ''
    const hullNumber = extractHullNumber(parenthetical) ?? extractHullNumber(vesselName)
    const vesselType = getVesselType(hullNumber)

    vessels.push({
      vessel_name: vesselName,
      vessel_type: vesselType,
      hull_number: hullNumber
    })

    // First vessel with CVN/LHD/LHA/LCC is the flagship
    if (!flagship && (vesselType === 'CVN' || vesselType === 'CV' || vesselType === 'LHD' || vesselType === 'LHA' || vesselType === 'LCC')) {
      flagship = hullNumber ? `${vesselName} ${hullNumber}` : vesselName
    }
  }

  // Also check for Russian/Chinese carriers
  const foreignCarrierRegex = /(Admiral\s+Kuznetsov|Liaoning|Shandong|Fujian|Vikramaditya|Vikrant)/gi
  let foreignMatch: RegExpExecArray | null
  while ((foreignMatch = foreignCarrierRegex.exec(text)) !== null) {
    const name = foreignMatch[1]
    if (!vessels.some(v => v.vessel_name.includes(name))) {
      vessels.push({
        vessel_name: name,
        vessel_type: 'CVN',
        hull_number: null
      })
      if (!flagship) flagship = name
    }
  }

  // Fix 5: If flagship is a CVN (aircraft carrier), group type MUST be CSG, never ARG
  let resolvedGroupType = groupType
  if (flagship && /CVN|CV-\d/i.test(flagship)) {
    if (resolvedGroupType !== 'CSG') {
      console.log(`[CSG-Scraper] CVN flagship detected (${flagship}), overriding ${resolvedGroupType} → CSG`)
    }
    resolvedGroupType = 'CSG'
  }

  // Fix 4: Try to infer designation from flagship hull number if not found in header
  let resolvedDesignation = designation
  if (!resolvedDesignation || resolvedDesignation.includes('UNKNOWN')) {
    const flagshipHull = vessels.find(v =>
      /^(CVN|CV|LHD|LHA|LCC)/i.test(v.vessel_type || v.hull_number || '')
    )?.hull_number
    if (flagshipHull) {
      try {
        const db = getDatabase()
        const existing = db.prepare(
          'SELECT designation FROM carrier_groups WHERE flagship LIKE ?'
        ).get(`%${flagshipHull}%`) as { designation: string } | undefined
        if (existing?.designation && !existing.designation.includes('UNKNOWN')) {
          resolvedDesignation = existing.designation
          console.log(`[CSG-Scraper] Inferred designation ${resolvedDesignation} from existing DB entry for ${flagshipHull}`)
        }
      } catch {
        // DB lookup is best-effort, don't fail on error
      }
    }
    if (!resolvedDesignation) {
      // If we have a hull number, use it directly instead of UNKNOWN
      if (flagshipHull) {
        resolvedDesignation = `${resolvedGroupType}-${flagshipHull.replace(/[^A-Za-z0-9-]/g, '')}`
        console.log(`[CSG-Scraper] Fallback designation ${resolvedDesignation} from hull number`)
      } else {
        resolvedDesignation = `${resolvedGroupType}-UNKNOWN`
      }
    }
  }

  // Determine status (Fix 2: deployed > in-port priority)
  // "deployed" and "underway" take priority because USNI uses "Deployed" as a section header
  let status = 'deployed'
  const lowerText = text.toLowerCase()
  if (lowerText.includes('deployed') || lowerText.includes('underway') || lowerText.includes('operating in')) {
    status = 'deployed'
  } else if (lowerText.includes('in-port') || lowerText.includes('in port') || lowerText.includes('homeport')) {
    status = 'in-port'
  } else if (lowerText.includes('transiting') || lowerText.includes('transit')) {
    status = 'transiting'
  }

  // Build name from resolved designation and group type
  const desigNum = resolvedDesignation.match(/(\d+)$/)?.[1] ?? desigMatch?.[1] ?? ''
  const groupLabel = resolvedGroupType === 'CSG' ? 'Carrier Strike Group'
    : resolvedGroupType === 'ARG' ? 'Amphibious Ready Group'
    : 'Expeditionary Strike Group'

  return {
    name: resolvedDesignation && !resolvedDesignation.includes('UNKNOWN')
      ? `${groupLabel} ${desigNum}`.trim()
      : header,
    designation: resolvedDesignation,
    flagship,
    status,
    operatingArea: areaInfo?.area ?? null,
    lat: areaInfo?.coords.lat ?? null,
    lon: areaInfo?.coords.lon ?? null,
    vessels
  }
}

// ── Group ID generation (shared logic, hull-number-based) ────

function generateGroupId(group: ParsedGroup): string {
  // Priority 0: Find the actual flagship (CVN/CV/LHD/LHA/LCC) from vessel list
  // The AI sometimes puts escorts before the carrier, so we search ALL vessels.
  if (group.vessels && group.vessels.length > 0) {
    const flagship = group.vessels.find(v =>
      /^(CVN|CV|LHD|LHA|LCC)/i.test(v.vessel_type || v.hull_number || '')
    )
    if (flagship?.hull_number) {
      return 'csg-' + flagship.hull_number.toLowerCase().replace(/[^a-z0-9]/g, '')
    }

    // Fallback to first vessel if no flagship type found
    if (group.vessels[0].hull_number) {
      return 'csg-' + group.vessels[0].hull_number.toLowerCase().replace(/[^a-z0-9]/g, '')
    }
  }

  // Priority 1: Extract hull number from flagship name string
  // e.g., "USS Abraham Lincoln CVN-72" → "cvn72"
  const hullMatch = group.flagship?.match(/([A-Z]{2,4}-\d+)/i)
  if (hullMatch) {
    return 'csg-' + hullMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  // Priority 2: Use designation if available
  if (group.designation) {
    return 'csg-' + group.designation.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  // Priority 3: Use flagship name (stripped)
  if (group.flagship) {
    // "USS George H.W. Bush" → "georgehwbush"
    return 'csg-' + group.flagship
      .replace(/^USS\s+/i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase()
  }

  return 'csg-unknown-' + Date.now()
}

// ── Database storage ─────────────────────────────────────────

function storeGroups(groups: ParsedGroup[]): number {
  const db = getDatabase()
  const now = new Date().toISOString()
  let stored = 0

  const upsertGroup = db.prepare(`
    INSERT INTO carrier_groups (id, name, designation, flagship, status, operating_area, latitude, longitude, source, last_updated)
    VALUES (@id, @name, @designation, @flagship, @status, @operating_area, @latitude, @longitude, @source, @last_updated)
    ON CONFLICT(id) DO UPDATE SET
      name = @name,
      designation = @designation,
      flagship = @flagship,
      status = @status,
      operating_area = @operating_area,
      latitude = @latitude,
      longitude = @longitude,
      source = 'usni',
      last_updated = @last_updated
  `)

  const upsertVessel = db.prepare(`
    INSERT INTO carrier_group_vessels (id, group_id, vessel_name, vessel_type, hull_number, mmsi, imo, latitude, longitude, heading, speed, last_seen)
    VALUES (@id, @group_id, @vessel_name, @vessel_type, @hull_number, @mmsi, @imo, @latitude, @longitude, @heading, @speed, @last_seen)
    ON CONFLICT(id) DO UPDATE SET
      vessel_name = @vessel_name,
      vessel_type = @vessel_type,
      hull_number = @hull_number,
      mmsi = COALESCE(@mmsi, carrier_group_vessels.mmsi),
      last_seen = @last_seen
  `)

  const deleteOldVessels = db.prepare('DELETE FROM carrier_group_vessels WHERE group_id = @group_id')

  const transaction = db.transaction(() => {
    for (const group of groups) {
      // Generate a stable ID using the shared helper
      const groupId = generateGroupId(group)

      // Dedup check: if this group's flagship hull number already belongs to
      // another group, skip this duplicate entry
      const flagshipHull = group.vessels?.[0]?.hull_number
      if (flagshipHull) {
        const flagshipBasedId = 'csg-' + flagshipHull.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (groupId !== flagshipBasedId) {
          // The generated ID doesn't match the flagship hull number
          // Check if a group with the flagship-based ID already exists
          const existing = db.prepare('SELECT id FROM carrier_groups WHERE id = ?').get(flagshipBasedId) as { id: string } | undefined
          if (existing) {
            console.log(`[CSG-Scraper] Skipping duplicate: ${group.name} (${groupId}) - flagship ${flagshipHull} already in group ${flagshipBasedId}`)
            continue
          }
        }
      }

      // Fix 1: Confidence-based merge — if parsed designation is UNKNOWN,
      // preserve existing data for fields the parser likely got wrong
      const isLowConfidence = !group.designation || group.designation.includes('UNKNOWN')
      let upsertName = group.name
      let upsertDesignation = group.designation
      let upsertStatus = group.status
      let upsertOperatingArea = group.operatingArea
      let lat = group.lat
      let lon = group.lon

      if (isLowConfidence) {
        // Fetch existing group data to preserve known values
        const existing = db.prepare(
          'SELECT name, designation, status, operating_area, latitude, longitude FROM carrier_groups WHERE id = ?'
        ).get(groupId) as { name: string; designation: string; status: string; operating_area: string | null; latitude: number | null; longitude: number | null } | undefined

        if (existing) {
          console.log(`[CSG-Scraper] Low confidence parse for ${groupId} (designation: ${group.designation}), preserving existing data`)

          // Preserve existing values for uncertain fields
          if (existing.name && !existing.name.includes('UNKNOWN')) {
            upsertName = existing.name
          }
          if (existing.designation && !existing.designation.includes('UNKNOWN')) {
            upsertDesignation = existing.designation
          }
          // Only update status if the parser found clear evidence
          // Keep existing status since garbled text can't be trusted
          if (existing.status) {
            upsertStatus = existing.status
          }
          if (existing.operating_area) {
            upsertOperatingArea = existing.operating_area
          }
          // Preserve existing coordinates
          lat = existing.latitude
          lon = existing.longitude
        }
      } else {
        // High confidence parse — use existing coords as fallback if needed
        if (lat == null || lon == null) {
          const existing = db.prepare('SELECT latitude, longitude, operating_area FROM carrier_groups WHERE id = ?').get(groupId) as { latitude: number | null; longitude: number | null; operating_area: string | null } | undefined
          if (existing && existing.operating_area === group.operatingArea) {
            lat = lat ?? existing.latitude
            lon = lon ?? existing.longitude
          }
        }
      }

      upsertGroup.run({
        id: groupId,
        name: upsertName,
        designation: upsertDesignation,
        flagship: group.flagship,
        status: upsertStatus,
        operating_area: upsertOperatingArea,
        latitude: lat,
        longitude: lon,
        source: 'usni',
        last_updated: now
      })

      // Remove old vessels for this group and re-add
      deleteOldVessels.run({ group_id: groupId })

      for (const vessel of group.vessels) {
        const vesselId = `${groupId}-${vessel.hull_number?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? vessel.vessel_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        upsertVessel.run({
          id: vesselId,
          group_id: groupId,
          vessel_name: vessel.vessel_name,
          vessel_type: vessel.vessel_type,
          hull_number: vessel.hull_number,
          mmsi: null,
          imo: null,
          latitude: null,
          longitude: null,
          heading: null,
          speed: null,
          last_seen: null
        })
      }

      stored++
    }
  })

  transaction()
  return stored
}

// ── AI-powered parsing ───────────────────────────────────────

/** Raw group structure returned by the LLM */
interface AIGroup {
  name?: string
  designation?: string
  flagship?: string
  status?: string
  operating_area?: string
  vessels?: Array<{
    vessel_name?: string
    vessel_type?: string
    hull_number?: string
  }>
  lat?: number
  lon?: number
}

/**
 * Use the configured LLM to parse the fleet tracker article text into
 * structured carrier group data. Falls back gracefully on any error.
 */
async function parseFleetTrackerWithAI(articleText: string): Promise<ParsedGroup[]> {
  const prompt = `You are a naval intelligence parser. Extract carrier strike groups, amphibious ready groups, and aircraft carrier/amphibious assault ship deployments from this USNI Fleet Tracker article.

You MUST include:
- Every Carrier Strike Group (CSG) mentioned
- Every Amphibious Ready Group (ARG) mentioned
- Every aircraft carrier or amphibious assault ship mentioned, even if in-port or transiting

You MUST NOT create top-level entries for:
- Individual destroyers, cruisers, or frigates operating as part of a known CSG/ARG
- Individual submarines
- Individual LCS or patrol craft

These vessels should ONLY appear as entries in the "vessels" array of their parent CSG/ARG.

Return ONLY a JSON array with this exact structure, no other text:
[
  {
    "name": "Carrier Strike Group 10",
    "designation": "CSG-10",
    "flagship": "USS George H.W. Bush CVN-77",
    "status": "transiting",
    "operating_area": "atlantic",
    "vessels": [
      {"vessel_name": "USS George H.W. Bush", "vessel_type": "CVN", "hull_number": "CVN-77"},
      {"vessel_name": "USS Mason", "vessel_type": "DDG", "hull_number": "DDG-87"}
    ]
  },
  {
    "name": "Boxer Amphibious Ready Group",
    "designation": "ARG-Boxer",
    "flagship": "USS Boxer LHD-4",
    "status": "transiting",
    "operating_area": "eastern pacific",
    "vessels": [
      {"vessel_name": "USS Boxer", "vessel_type": "LHD", "hull_number": "LHD-4"},
      {"vessel_name": "USS Comstock", "vessel_type": "LSD", "hull_number": "LSD-45"},
      {"vessel_name": "USS Portland", "vessel_type": "LPD", "hull_number": "LPD-27"}
    ]
  },
  {
    "name": "USS George Washington",
    "designation": "",
    "flagship": "USS George Washington CVN-73",
    "status": "in-port",
    "operating_area": "yokosuka",
    "vessels": [
      {"vessel_name": "USS George Washington", "vessel_type": "CVN", "hull_number": "CVN-73"}
    ]
  }
]

Rules:
- Extract the EXACT CSG/ARG number from the article (e.g. CSG-10, CSG-12, NOT CSG-1)
- Flagship is the carrier or amphibious assault ship
- Status: "deployed" if actively operating, "transiting" if moving between areas, "in-port" if at a naval base
- Operating area: You MUST use one of these EXACT lowercase names (do NOT invent new names):
  "western pacific", "south china sea", "persian gulf", "gulf of oman", "red sea",
  "eastern mediterranean", "north arabian sea", "indian ocean", "western atlantic",
  "eastern atlantic", "norfolk", "san diego", "yokosuka", "middle east", "indo-pacific",
  "europe", "arabian gulf", "mediterranean", "pacific", "atlantic", "gulf", "north sea",
  "baltic", "black sea", "philippine sea", "sea of japan", "east china sea",
  "strait of hormuz", "gulf of aden", "bab el-mandeb", "central pacific", "eastern pacific",
  "southern pacific", "arabian sea", "caribbean sea", "pearl harbor", "hawaii", "panama",
  "guam", "diego garcia", "okinawa", "sasebo", "groton", "kings bay", "jacksonville",
  "puget sound", "bremerton", "newport news", "split", "mayport", "rota", "bahrain",
  "djibouti", "off the coast of africa", "west africa", "gulf of guinea", "5th fleet",
  "6th fleet", "7th fleet", "4th fleet", "2nd fleet", "3rd fleet", "central command",
  "centcom", "horn of africa", "somali basin", "off the coast of israel",
  "off the coast of yemen", "off the coast of iran",
  "sulu sea", "celebes sea", "mindanao sea", "south atlantic", "north atlantic",
  "mozambique channel", "andaman sea"
- If the article says "off the coast of Africa", use "off the coast of africa"
- If the article says "heading to 5th Fleet" or "CENTCOM", use "5th fleet"
- If the article says "6th Fleet AOR", use "6th fleet"
- Match the CLOSEST area from the list above to what the article describes
- CRITICAL: When the article mentions BOTH a specific body of water AND a fleet/command name, use the specific body of water. For example: "operating in the Arabian Sea as part of 5th Fleet" → use "arabian sea", NOT "5th fleet". "transiting the Eastern Mediterranean under 6th Fleet" → use "eastern mediterranean", NOT "6th fleet". "in the South China Sea, 7th Fleet AOR" → use "south china sea", NOT "7th fleet".
- Only use fleet/command names (5th fleet, 6th fleet, centcom, etc.) when NO specific body of water or location is mentioned.
- When the article says "in the CENTCOM area" or "5th Fleet AOR" with no other detail, prefer "arabian sea" over "5th fleet" (ships are typically at sea, not at HQ).
- Be SPECIFIC: If the article mentions a specific port or location (Pearl Harbor, Panama, Yokosuka, Norfolk, etc.), use that port name as the operating_area, NOT a generic region name like "eastern pacific". Only use broad area names when no specific location is mentioned.
- Examples: "departed Pearl Harbor" → operating_area: "pearl harbor", "in port Yokosuka" → operating_area: "yokosuka", "departed Panama" → operating_area: "panama", "operating in the Red Sea" → operating_area: "red sea"
- Include ALL vessels mentioned in the group (carrier, cruisers, destroyers, amphibious ships)
- vessel_type: CVN, LHD, LHA, LSD, LPD, CG, DDG, FFG, SSN, AOE, etc.
- If an aircraft carrier (CVN) is mentioned without a CSG number, create a top-level entry for it with its escorts as vessels
- If an amphibious assault ship (LHD/LHA/LPD/LSD) is mentioned without an ARG, create a top-level entry for it with its escorts as vessels
- Individual destroyers (DDG), cruisers (CG), frigates (FFG), LCS, and submarines (SSN/SSBN) are NEVER top-level entries. They are ALWAYS vessels within a CSG/ARG group.
- If a destroyer or cruiser is mentioned with no obvious parent group, add it to the nearest geographically relevant CSG/ARG's vessel list, OR omit it entirely
- If an ARG is mentioned with named ships, include ALL named ships
- Capture "in-port" carriers (like USS George Washington in Yokosuka) — these are strategically important
- Capture ARGs described as "departed" or "transiting" — they are actively deploying
- Do NOT invent vessels not mentioned in the text
- If no operating area is specified for an in-port ship, use the port name as operating_area
- CRITICAL: The flagship field MUST include the hull number, e.g., "USS George H.W. Bush CVN-77", not just "USS George H.W. Bush"
- The first vessel in each group's vessel array MUST be the flagship (carrier or amphibious assault ship)
- Always include hull_number for every vessel
- Do NOT include lat/lon coordinates. The system resolves coordinates from operating_area automatically.
- IMPORTANT: Return ONLY valid JSON. No markdown code fences, no explanation.
- CRITICAL: The operating_area MUST be extracted VERBATIM from the article text. Do NOT infer, guess, or use prior knowledge. If the article says "operating in the Eastern Pacific", use "eastern pacific". If the article does NOT explicitly state the operating area for a ship, use the area mentioned NEAREST to that ship's name in the text. NEVER invent an area that does not appear in the article.
- CRITICAL: Do NOT use a ship's homeport as its operating area. If the article says "operating in the Indian Ocean" and "homeported in Sasebo", the operating_area is "indian ocean", NOT "sasebo". Homeport and operating area are different things.

Article text:
${articleText.substring(0, 16000)}`

  const { chat } = await import('../rag/llm')

  const result = await chat(
    [{ role: 'user', content: prompt }],
    { temperature: 0.1, timeoutMs: 300_000 }
  )

  if (!result.text || result.text.trim().length === 0) {
    throw new Error('CSG scraper: LLM returned empty response')
  }

  let content = result.text.trim()

  // Parse the JSON response
  let aiGroups: AIGroup[]
  try {
    aiGroups = JSON.parse(content) as AIGroup[]
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      aiGroups = JSON.parse(jsonMatch[0]) as AIGroup[]
    } else {
      throw new Error('AI returned non-JSON response')
    }
  }

  if (!Array.isArray(aiGroups) || aiGroups.length === 0) {
    throw new Error('AI returned empty or invalid array')
  }

  // Normalize AI response before processing
  for (const group of aiGroups) {
    // Ensure flagship vessel is first in the list
    if (group.vessels && group.vessels.length > 0) {
      // Sort so the carrier/LHD/LHA is first (these are the flagships)
      const typeOrder: Record<string, number> = { CVN: 0, CV: 0, LHA: 1, LHD: 2, LPD: 3, LSD: 4, CG: 5, DDG: 6, DD: 7, FFG: 8, SSN: 9, SSBN: 10 }
      group.vessels.sort((a, b) => ((typeOrder[a.vessel_type?.toUpperCase() ?? ''] ?? 99) - (typeOrder[b.vessel_type?.toUpperCase() ?? ''] ?? 99)))

      // Set flagship to first vessel if missing
      if (!group.flagship && group.vessels[0]) {
        group.flagship = group.vessels[0].vessel_name
      }
    }

    // Normalize designation
    if (!group.designation && group.name) {
      // Try to extract designation from name like "Carrier Strike Group 10" → "CSG-10"
      const desigMatch = group.name.match(/(?:Carrier Strike Group|CSG)\s*(\d+)/i)
      if (desigMatch) {
        group.designation = 'CSG-' + desigMatch[1]
      }
      // "Amphibious Ready Group" or "Boxer ARG" → use flagship hull
      const argMatch = group.name.match(/ARG/i)
      if (argMatch && group.vessels?.[0]?.hull_number) {
        group.designation = 'ARG-' + group.vessels[0].hull_number
      }
    }
  }

  // Post-AI area correction: override generic areas when article mentions specific ports
  const GENERIC_AREAS = new Set([
    'eastern pacific', 'western pacific', 'pacific', 'atlantic',
    'indian ocean', 'southern ocean', 'arctic'
  ])

  const PORT_PATTERNS: Array<{ pattern: RegExp; area: string }> = [
    { pattern: /pearl\s+harbor|hawaii/i, area: 'pearl harbor' },
    { pattern: /panama\s+city|panama\s+canal|departed[^.]*panama/i, area: 'panama' },
    { pattern: /yokosuka/i, area: 'yokosuka' },
    { pattern: /norfolk/i, area: 'norfolk' },
    { pattern: /san\s+diego/i, area: 'san diego' },
    { pattern: /mayport/i, area: 'mayport' },
    { pattern: /rota[^n]/i, area: 'rota' },  // "rota" not "rotation"
    { pattern: /sasebo/i, area: 'sasebo' },
    { pattern: /guam/i, area: 'guam' },
    { pattern: /djibouti/i, area: 'djibouti' },
    { pattern: /bahrain|bahrein/i, area: 'bahrain' },
    { pattern: /okinawa/i, area: 'okinawa' },
  ]

  for (const group of aiGroups) {
    if (!GENERIC_AREAS.has(group.operating_area?.toLowerCase()?.trim() ?? '')) continue

    // Search article text near the group's flagship mention for port keywords
    const flagshipName = group.flagship?.replace(/\s*(CVN|LHD|LHA|LSD|LPD|CG|DDG|LCS|LCC|FFG)-\d+/i, '').trim()
    if (!flagshipName) continue

    // Find the section of article text that mentions this ship
    const shipIndex = articleText.indexOf(flagshipName)
    if (shipIndex === -1) continue

    // Get surrounding context (500 chars before and after the mention)
    const contextStart = Math.max(0, shipIndex - 500)
    const contextEnd = Math.min(articleText.length, shipIndex + 500)
    const context = articleText.substring(contextStart, contextEnd)

    // Check for port patterns in this context
    for (const { pattern, area } of PORT_PATTERNS) {
      const portMatch = pattern.exec(context)
      if (!portMatch) continue

      // Get text before the port mention (60 chars) to check for homeport references
      const portContextBefore = context.substring(Math.max(0, portMatch.index - 60), portMatch.index).toLowerCase()

      // Skip if this is clearly a homeport reference, not a current location
      if (/\bhome[\s-]?port\b|\bbased\s+(in|out\s+of)\b|\bfrom\b/.test(portContextBefore)) {
        console.log(`[CSG-Scraper] Area correction skipped: "${area}" appears to be homeport, not current location`)
        continue
      }

      console.log(`[CSG-Scraper] Area correction: ${group.flagship} "${group.operating_area}" → "${area}" (matched ${pattern.source})`)
      group.operating_area = area
      break
    }
  }

  // Debug logging of AI response
  console.log(`[CSG-Scraper] AI raw response (${aiGroups.length} groups):`)
  for (const g of aiGroups) {
    console.log(`  - ${g.designation || '(no desig)'} | ${g.flagship || '(no flagship)'} | ${g.operating_area || '(no area)'} | ${g.vessels?.length || 0} vessels`)
  }

  // Convert AI response to ParsedGroup format and resolve coordinates
  const groups: ParsedGroup[] = aiGroups.map((g: AIGroup): ParsedGroup => {
    const opArea = g.operating_area?.toLowerCase()?.trim() ?? ''
    let areaCoords = AREA_COORDS[opArea]

    // Try fuzzy match if exact match fails
    if (!areaCoords && opArea) {
      for (const [key, coords] of Object.entries(AREA_COORDS)) {
        if (opArea.includes(key) || key.includes(opArea)) {
          areaCoords = coords
          console.log(`[CSG-Scraper] Fuzzy area match: "${opArea}" → "${key}"`)
          break
        }
      }
    }

    // Normalize status
    let status = g.status ?? 'deployed'
    if (!['deployed', 'transiting', 'in-port'].includes(status)) {
      status = 'deployed'
    }

    return {
      name: g.name ?? g.designation ?? 'Unknown Group',
      designation: g.designation ?? 'UNKNOWN',
      flagship: g.flagship ?? null,
      status,
      operatingArea: opArea || null,
      lat: areaCoords?.lat ?? g.lat ?? null,
      lon: areaCoords?.lon ?? g.lon ?? null,
      vessels: (g.vessels ?? []).map((v) => ({
        vessel_name: v.vessel_name ?? 'Unknown',
        vessel_type: v.vessel_type ?? getVesselType(v.hull_number ?? null),
        hull_number: v.hull_number ?? null
      }))
    }
  })

  return groups
}

// ── ISO week helper ──────────────────────────────────────────

function getIsoWeek(): string {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const days = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  const weekNum = Math.ceil((days + start.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

// ── Public API ───────────────────────────────────────────────

/**
 * Scrape USNI Fleet Tracker and update carrier group positions.
 * Uses AI parsing first, falls back to regex if AI fails.
 * Returns the number of groups stored.
 */
export async function scrapeUsniFleetTracker(): Promise<number> {
  console.log('[CSG-Scraper] Starting USNI Fleet Tracker scrape...')

  try {
    // Step 1: Fetch the fleet tracker category page
    const categoryHtml = await fetchUrl('https://news.usni.org/category/fleet-tracker')

    // Step 2: Find the latest fleet tracker article link
    let articleLinks = findLinks(categoryHtml, /fleet.*marine.*tracker|fleet.*tracker/i)

    // Filter out category/feed/page navigation links
    articleLinks = articleLinks.filter(url =>
      !url.includes('/category/') &&
      !url.includes('/feed') &&
      !url.includes('/page/')
    )

    if (articleLinks.length === 0) {
      // Try to find any recent article link with "fleet" in the URL
      const fallbackLinks = findLinks(categoryHtml, /news\.usni\.org\/\d{4}\/\d{2}\/\d{2}\//)
      if (fallbackLinks.length === 0) {
        throw new Error('No fleet tracker article links found')
      }
      articleLinks.push(fallbackLinks[0])
    }

    // Resolve relative URLs
    const articleUrl = articleLinks[0].startsWith('http')
      ? articleLinks[0]
      : `https://news.usni.org${articleLinks[0]}`

    console.log(`[CSG-Scraper] Fetching article: ${articleUrl}`)

    // Step 3: Fetch the article
    const articleHtml = await fetchUrl(articleUrl)

    // Step 4: Extract plain text from article HTML for AI parsing
    const articleBody = extractArticleBody(articleHtml)
    const articleText = stripHtml(articleBody)
    console.log(`[CSG-Scraper] Article text preview (first 2000 chars):\n${articleText.substring(0, 2000)}`)

    // Step 5: Try AI parsing first, fall back to regex
    let groups: ParsedGroup[] = []
    try {
      groups = await parseFleetTrackerWithAI(articleText)
      console.log(`[CSG-Scraper] AI parsed ${groups.length} carrier groups`)
    } catch (aiErr) {
      console.warn(
        '[CSG-Scraper] AI parsing failed, falling back to regex:',
        aiErr instanceof Error ? aiErr.message : String(aiErr)
      )
      groups = parseFleetTrackerArticle(articleHtml)
    }

    if (groups.length === 0) {
      console.log('[CSG-Scraper] No carrier groups found in article')
      return 0
    }

    // Step 5b: Store full article context as CSG intel
    const weekOf = getIsoWeek()
    const insertIntel = getDatabase().prepare(`
      INSERT OR REPLACE INTO csg_intel (group_id, group_name, week_of, raw_text, source, source_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const group of groups) {
      const groupId = generateGroupId(group)
      const groupName = group.name || group.designation || 'Unknown Group'
      insertIntel.run(groupId, groupName, weekOf, articleText.slice(0, 5000), 'usni', articleUrl)
    }
    console.log(`[CSG-Scraper] Stored intel for ${groups.length} groups (week ${weekOf})`)

    // Step 6: Store in database
    const count = storeGroups(groups)
    console.log(`[CSG-Scraper] Stored ${count} carrier groups (${groups.reduce((sum, g) => sum + g.vessels.length, 0)} vessels)`)

    // Step 7: Clean up stale groups not updated by this scrape
    const now = new Date()
    const STALE_GROUP_DAYS = 7 // Groups older than 7 days with no update = likely gone

    const staleGroups = getDatabase().prepare(`
      SELECT id, name, designation, flagship, last_updated 
      FROM carrier_groups 
      WHERE last_updated < ?
    `).all(new Date(now.getTime() - STALE_GROUP_DAYS * 24 * 60 * 60 * 1000).toISOString()) as Array<{ id: string; name: string; designation: string; flagship: string; last_updated: string }>

    if (staleGroups.length > 0) {
      console.log(`[CSG-Scraper] Found ${staleGroups.length} stale groups (>${STALE_GROUP_DAYS} days old):`)
      for (const g of staleGroups) {
        console.log(`  - ${g.id}: ${g.name} (${g.flagship}) last updated ${g.last_updated}`)
      }

      // Delete stale groups and their vessels
      const deleteGroup = getDatabase().prepare('DELETE FROM carrier_groups WHERE id = ?')
      const deleteVessels = getDatabase().prepare('DELETE FROM carrier_group_vessels WHERE group_id = ?')
      const deleteIntel = getDatabase().prepare('DELETE FROM csg_intel WHERE group_id = ?')

      const cleanup = getDatabase().transaction(() => {
        for (const g of staleGroups) {
          deleteVessels.run(g.id)
          deleteIntel.run(g.id)
          deleteGroup.run(g.id)
        }
      })
      cleanup()
      console.log(`[CSG-Scraper] Cleaned up ${staleGroups.length} stale groups`)
    }

    return count
  } catch (err) {
    console.error('[CSG-Scraper] Scrape failed:', err instanceof Error ? err.message : String(err))
    return 0
  }
}

/**
 * Store seed data if no groups exist in the database.
 * Returns the number of groups stored.
 */
export function storeSeedData(): number {
  const db = getDatabase()
  const count = db.prepare('SELECT COUNT(*) as c FROM carrier_groups').get() as { c: number }
  if (count.c > 0) {
    console.log(`[CSG-Scraper] ${count.c} carrier groups already exist, skipping seed`)
    return count.c
  }
  console.log('[CSG-Scraper] No seed data available — AI parsing should populate groups from USNI articles')
  return 0
}

/** One-time cleanup of known ghost groups from bad scrapes */
export function cleanupGhostGroups(): void {
  const db = getDatabase()

  // Find groups with ARG-UNKNOWN designation and no real flagship match
  const ghosts = db.prepare(`
    SELECT id, name, designation, flagship 
    FROM carrier_groups 
    WHERE designation = 'ARG-UNKNOWN'
  `).all() as Array<{ id: string; name: string; designation: string; flagship: string }>

  if (ghosts.length === 0) return

  // Check if any ghost's flagship already has a proper group entry
  for (const ghost of ghosts) {
    const hullMatch = ghost.flagship?.match(/([A-Z]{2,4}-\d+)/i)
    if (hullMatch) {
      const flagshipId = 'csg-' + hullMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '')
      const realGroup = db.prepare('SELECT id FROM carrier_groups WHERE id = ? AND id != ?').get(flagshipId, ghost.id) as { id: string } | undefined
      if (realGroup) {
        console.log(`[CSG-Cleanup] Removing ghost ${ghost.id} (${ghost.flagship}) - real group is ${realGroup.id}`)
        db.prepare('DELETE FROM carrier_group_vessels WHERE group_id = ?').run(ghost.id)
        db.prepare('DELETE FROM carrier_groups WHERE id = ?').run(ghost.id)
      }
    }
  }
}
