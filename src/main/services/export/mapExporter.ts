/**
 * Map Exporter — Converts base64 map canvas data URL to PNG file.
 * Optionally composites a metadata bar at the bottom of the image.
 */

import { writeFile } from 'fs/promises'

export interface MapExportMetadata {
  center: [number, number]
  zoom: number
  annotationCount: number
  visibleLayers: string[]
}

/**
 * Convert a base64 data URL to a Node Buffer.
 */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  return Buffer.from(base64, 'base64')
}

/**
 * Build a metadata bar PNG using sharp (if available).
 * Falls back to raw map PNG if sharp is not installed.
 */
async function compositeMetadataBar(
  mapBuffer: Buffer,
  metadata: MapExportMetadata
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let sharp: // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
  try {
    sharp = require('sharp')
  } catch {
    return mapBuffer
  }

  try {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    const coordStr = `${metadata.center[1].toFixed(4)}°${metadata.center[1] >= 0 ? 'N' : 'S'}, ${metadata.center[0].toFixed(4)}°${metadata.center[0] >= 0 ? 'E' : 'W'}`
    const zoomStr = `Zoom: ${metadata.zoom.toFixed(2)}`
    const annotStr = metadata.annotationCount > 0 ? `Annotations: ${metadata.annotationCount}` : ''

    const lines = [
      `Intel Board — SITUATION MAP`,
      `Generated: ${now}`,
      `Center: ${coordStr}  |  ${zoomStr}`,
      annotStr,
      `Layers: ${metadata.visibleLayers.join(', ') || 'none'}`
    ].filter(Boolean)

    const barHeight = lines.length * 18 + 16
    const svg = `
      <svg width="800" height="${barHeight}">
        <rect width="800" height="${barHeight}" fill="#18181b" />
        ${lines
          .map(
            (line, i) =>
              `<text x="12" y="${20 + i * 18}" font-family="monospace" font-size="12" fill="#a1a1aa">${line}</text>`
          )
          .join('\n')}
        <text x="790" y="14" font-family="monospace" font-size="9" fill="#52525b" text-anchor="end">CLASSIFIED</text>
      </svg>`

    const metadataBuf = await sharp(Buffer.from(svg)).png().toBuffer()
    const mapMeta = await sharp(mapBuffer).metadata()
    const barResized = await sharp(metadataBuf)
      .resize(mapMeta.width, barHeight, { fit: 'fill' })
      .png()
      .toBuffer()

    return await sharp(mapBuffer)
      .extend({ bottom: barHeight, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .composite([{ input: barResized, left: 0, top: mapMeta.height! }])
      .png()
      .toBuffer()
  } catch {
    // sharp not available — return raw map image
    return mapBuffer
  }
}

/**
 * Save a map image from a canvas data URL to a PNG file.
 * Optionally composites a metadata bar at the bottom.
 */
export async function saveMapImage(
  filePath: string,
  imageDataUrl: string,
  metadata: MapExportMetadata,
  includeMetadataBar: boolean
): Promise<void> {
  const mapBuffer = dataUrlToBuffer(imageDataUrl)

  if (includeMetadataBar) {
    const composited = await compositeMetadataBar(mapBuffer, metadata)
    await writeFile(filePath, composited)
  } else {
    await writeFile(filePath, mapBuffer)
  }
}