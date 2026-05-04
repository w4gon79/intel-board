/**
 * PDF Exporter — Generates a formatted PDF report from intel items using pdfkit.
 */

import PDFDocument from 'pdfkit'
import { createWriteStream } from 'fs'
import type { IntelItem, IntelTier } from '../../../shared/types'
import type { ExportOptions } from './markdownExporter'

const TIER_ORDER: Record<IntelTier, number> = {
  ALERT: 0,
  WATCH: 1,
  CONTEXT: 2
}

const TIER_COLORS: Record<IntelTier, string> = {
  ALERT: '#EF4444',
  WATCH: '#F59E0B',
  CONTEXT: '#3B82F6'
}

const TIER_EMOJI: Record<IntelTier, string> = {
  ALERT: 'ALERT',
  WATCH: 'WATCH',
  CONTEXT: 'CONTEXT'
}

function sortByTierAndTime(items: IntelItem[]): IntelItem[] {
  return [...items].sort((a, b) => {
    const tierDiff = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9)
    if (tierDiff !== 0) return tierDiff
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

function formatNow(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function formatPeriodLabel(hoursBack: number | null): string {
  if (hoursBack === null) return 'All time'
  if (hoursBack <= 24) return 'Last 24 hours'
  if (hoursBack <= 168) return 'Last 7 days'
  if (hoursBack <= 720) return 'Last 30 days'
  return `Last ${hoursBack} hours`
}

function formatCoordinates(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null) return null
  const latDir = lat >= 0 ? 'N' : 'S'
  const lonDir = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(2)}\u00B0${latDir}, ${Math.abs(lon).toFixed(2)}\u00B0${lonDir}`
}

/**
 * Estimate the height needed for an intel item in the PDF.
 * Used to decide whether to add a page break before rendering an item.
 */
function estimateItemHeight(item: IntelItem): number {
  let height = 60 // heading + metadata line
  if (item.summary) height += Math.ceil(item.summary.length / 70) * 14 + 10
  if (item.analysis) height += Math.ceil(item.analysis.length / 70) * 14 + 10
  if (item.sources && item.sources.length > 0) height += item.sources.length * 14 + 20
  if (item.categories && item.categories.length > 0) height += 18
  if (item.latitude !== null && item.longitude !== null) height += 18
  return height
}

export async function generatePdfReport(
  items: IntelItem[],
  options: ExportOptions,
  filePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 54, bottom: 54, left: 54, right: 54 }, // 0.75 inch
      bufferPages: true
    })

    const stream = createWriteStream(filePath)
    doc.pipe(stream)

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const sorted = sortByTierAndTime(items)
    const tierLabel = options.tier ? `${options.tier} tier` : 'All tiers'
    const periodLabel = formatPeriodLabel(options.hoursBack ?? null)
    const now = formatNow()

    // ── Title ──
    doc.fontSize(18).font('Helvetica-Bold').text('Intel Board Report', { align: 'center' })
    doc.moveDown(0.5)

    // ── Metadata ──
    doc.fontSize(9).font('Helvetica').fillColor('#666666')
    doc.text(`Generated: ${now}`, { align: 'center' })
    doc.text(`Period: ${periodLabel}  |  Filter: ${tierLabel}  |  Total Items: ${items.length}`, {
      align: 'center'
    })
    doc.fillColor('#000000')
    doc.moveDown(0.5)

    // Horizontal rule
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#CCCCCC')
      .lineWidth(0.5)
      .stroke()
    doc.moveDown(0.5)

    // ── Items ──
    for (const item of sorted) {
      const estimatedHeight = estimateItemHeight(item)
      const remainingSpace = doc.page.height - doc.y - doc.page.margins.bottom

      // Page break if item won't fit
      if (remainingSpace < estimatedHeight && remainingSpace < doc.page.height * 0.3) {
        doc.addPage()
      }

      const tierColor = TIER_COLORS[item.tier] ?? '#000000'
      const confidence =
        item.confidence !== null ? (item.confidence * 100).toFixed(0) + '%' : 'N/A'
      const coords = formatCoordinates(item.latitude, item.longitude)

      // Tier badge + title
      doc.fontSize(14).font('Helvetica-Bold').fillColor(tierColor)
      doc.text(`[${TIER_EMOJI[item.tier]}] ${item.title}`, { continued: false })
      doc.fillColor('#000000')

      // Metadata line
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#888888')
        .text(
          `Region: ${item.region ?? 'Unknown'}  |  Confidence: ${confidence}  |  Time: ${formatDate(item.created_at)}`
        )
      doc.fillColor('#000000')
      doc.moveDown(0.3)

      // Summary
      if (item.summary) {
        doc.fontSize(10).font('Helvetica').text(item.summary, { width: pageWidth })
        doc.moveDown(0.3)
      }

      // Analysis
      if (item.analysis) {
        doc.fontSize(10).font('Helvetica').text(item.analysis, { width: pageWidth })
        doc.moveDown(0.3)
      }

      // Sources
      if (item.sources && item.sources.length > 0) {
        doc.fontSize(9).font('Helvetica-Bold').text('Sources:')
        doc.font('Helvetica')
        for (const source of item.sources) {
          doc.text(`  \u2022 ${source}`, { indent: 10 })
        }
        doc.moveDown(0.2)
      }

      // Categories
      if (item.categories && item.categories.length > 0) {
        doc.fontSize(9).font('Helvetica-Bold').text('Categories: ', { continued: true })
        doc.font('Helvetica').text(item.categories.join(', '))
        doc.moveDown(0.2)
      }

      // Location
      if (coords) {
        doc.fontSize(9).font('Helvetica-Bold').text('Location: ', { continued: true })
        doc.font('Helvetica').text(coords)
        doc.moveDown(0.2)
      }

      // Separator line
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor('#DDDDDD')
        .lineWidth(0.5)
        .stroke()
      doc.moveDown(0.5)
    }

    // ── Footer on each page ──
    const totalPages = doc.bufferedPageRange().count
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i)
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#AAAAAA')
        .text(
          `Page ${i + 1} of ${totalPages}  |  Generated by Intel Board`,
          doc.page.margins.left,
          doc.page.height - 36,
          { width: pageWidth, align: 'center' }
        )
    }

    doc.end()

    stream.on('finish', () => resolve())
    stream.on('error', (err) => reject(err))
  })
}