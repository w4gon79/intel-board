/**
 * IPC handlers for AI Chat
 */
import { ipcMain } from 'electron'
import { getDatabase } from '../services/storage/database'
import { executeRAG } from '../services/rag/pipeline'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  sources: string | null
  confidence: number | null
  created_at: string
}

export function registerAiHandlers(): void {
  const db = getDatabase()

  // Ensure chat_messages table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      sources TEXT,
      confidence REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Send a chat message and get AI response via RAG pipeline
  ipcMain.handle('ai:chat', async (_event, message: string) => {
    try {
      // Store user message
      db.prepare(
        `INSERT INTO chat_messages (role, content) VALUES ('user', ?)`
      ).run(message)

      let responseContent: string
      let sources: Array<{
        id: string
        title: string
        snippet: string
        timestamp: string
        score: number
        sourceType: string
        sourceUrl: string | null
      }> = []
      let confidence = 0.7

      try {
        // Route through the RAG pipeline
        const result = await executeRAG({
          query: message,
          history: []
        })

        if (result && result.answer) {
          // Map RAG source citations to chat source format
          sources = (result.sources ?? []).map((s) => ({
            id: String(s.sourceId),
            title: `${s.sourceType} — ${s.region ?? 'unknown'}`,
            snippet: '',
            timestamp: s.timestamp ?? new Date().toISOString(),
            score: s.confidence,
            sourceType: s.sourceType,
            sourceUrl: null as string | null
          }))

          // Batch lookup article URLs, titles, and content snippets from DB
          if (sources.length > 0) {
            const articleIds = sources
              .filter(s => s.sourceType === 'article' || s.sourceType === 'news')
              .map(s => s.id)

            if (articleIds.length > 0) {
              const placeholders = articleIds.map(() => '?').join(',')
              const urlRows = db.prepare(
                `SELECT id, url, title, content FROM articles WHERE id IN (${placeholders})`
              ).all(...articleIds) as Array<{ id: string; url: string | null; title: string | null; content: string | null }>

              const urlMap = new Map(urlRows.map(r => [r.id, { url: r.url, title: r.title, content: r.content }]))

              for (const source of sources) {
                const lookup = urlMap.get(source.id)
                if (lookup) {
                  if (lookup.url) source.sourceUrl = lookup.url
                  if (lookup.title) source.title = lookup.title
                  if (lookup.content) source.snippet = lookup.content.slice(0, 200)
                }
              }
            }
          }

          // Compute confidence from actual retrieval scores
          if (sources.length > 0) {
            const avgScore = sources.reduce((sum, s) => sum + s.score, 0) / sources.length
            confidence = avgScore

            // If retrieval quality is too low, override with insufficient data message
            if (avgScore < 0.4) {
              responseContent = '⚠ **Insufficient data** — the retrieved sources had low relevance scores ' +
                `(avg ${Math.round(avgScore * 100)}%). Try refining your query or ensure ingestion has populated the intelligence database.\n\n` +
                result.answer
            } else {
              responseContent = result.answer
            }
          } else {
            // No RAG sources found, but the LLM may still have answered from system prompt context
            // (live choke point data, CSG positions, tactical events)
            // Check if the answer is substantive (not a refusal/insufficient data response from the LLM itself)
            const answerTrimmed = result.answer.trim()
            const isLLMRefusal = answerTrimmed.toLowerCase().includes("don't have sufficient") ||
                                 answerTrimmed.toLowerCase().includes("insufficient information") ||
                                 answerTrimmed.length < 20

            if (isLLMRefusal) {
              confidence = 0.2
              responseContent = '⚠ **Insufficient data** — no relevant sources were found for your query. ' +
                'Please ensure data sources are configured and ingestion has run.'
            } else {
              // LLM answered from live system prompt context (choke points, CSG, tactical events)
              confidence = 0.5
              responseContent = result.answer
            }
          }
        } else {
          responseContent =
            'I was unable to find relevant intelligence data for your query. Please ensure data sources are configured and try again.'
          confidence = 0.3
        }
      } catch (ragError) {
        console.error('[AI] RAG pipeline error:', ragError)
        responseContent =
          'The AI analysis pipeline is currently unavailable. Please ensure Ollama is running and the embedding model is loaded.'
        confidence = 0.1
      }

      // Store assistant response
      const insertResult = db
        .prepare(
          `INSERT INTO chat_messages (role, content, sources, confidence)
           VALUES ('assistant', ?, ?, ?)`
        )
        .run(
          responseContent,
          sources.length > 0 ? JSON.stringify(sources) : null,
          confidence
        )

      return {
        id: insertResult.lastInsertRowid as number,
        role: 'assistant' as const,
        content: responseContent,
        sources,
        confidence,
        createdAt: new Date().toISOString()
      }
    } catch (error) {
      console.error('[AI] Chat error:', error)
      throw error
    }
  })

  // Get chat history
  ipcMain.handle('ai:getHistory', async (_event, limit: number = 50) => {
    try {
      const messages = db
        .prepare(
          `SELECT id, role, content, sources, confidence, created_at
           FROM chat_messages
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(limit) as ChatMessage[]

      return messages.reverse()
    } catch (error) {
      console.error('[AI] Get history error:', error)
      return []
    }
  })

  // ── Generate contextual intelligence brief for map markers ──
  interface BriefRequest {
    type: 'ship' | 'aircraft' | 'csg' | 'intel' | 'chokepoint'
    data: Record<string, unknown>
  }

  ipcMain.handle('ai:brief', async (_event, request: BriefRequest) => {
    const { type, data } = request

    // Build a contextual query from the marker data
    let query: string
    switch (type) {
      case 'ship':
        query = `A vessel has been detected and confirmed by AIS tracking with the following details:
- Name: ${data.name || 'MMSI ' + data.mmsi}
- Type: ${data.type || 'unknown'}
- MMSI: ${data.mmsi || 'unknown'}
- Destination: ${data.destination || 'unknown'}
- Position: ${data.lat}°N, ${data.lon}°E
- Military: ${data.military ? 'Yes, classified as military vessel' : 'No'}

This is CONFIRMED tracking data from a live AIS feed. Do NOT say you cannot provide an analysis — the vessel exists and the data above is confirmed.

Provide a concise intelligence brief including:
1. Vessel identification and operator assessment
2. Strategic significance of this vessel's current position
3. Nearby naval assets or related activity
4. Any related tactical events in the region`
        break
      case 'aircraft':
        query = `An aircraft has been detected and confirmed by ADS-B tracking with the following details:
- Callsign: ${data.callsign || 'unknown'}
- Type: ${data.type || 'unknown'}
- Altitude: ${data.alt ? data.alt + ' ft' : 'unknown'}
- Heading: ${data.heading ? data.heading + '°' : 'unknown'}
- Speed: ${data.speed ? data.speed + ' kts' : 'unknown'}
- Position: ${data.lat}°N, ${data.lon}°E
- Hex code: ${data.hex || 'unknown'}

This is CONFIRMED tracking data from a live ADS-B feed. Do NOT say you cannot provide an analysis — the aircraft exists and the data above is confirmed.

Provide a concise intelligence brief including:
1. Mission inference based on aircraft type, altitude, heading, and location
2. What military or government operator likely operates this aircraft type
3. Strategic significance of this aircraft's current position and heading
4. Any related tactical activity in the region from your live data
5. Likely origin and destination based on heading and regional context`
        break
      case 'csg':
        query = `A carrier strike group has been confirmed by USNI fleet tracking with the following details:
- Group: ${data.name || 'Carrier Strike Group'}
- Position: ${data.lat}°N, ${data.lon}°E
- Escorts: ${data.escortCount || 'unknown'} escort vessels
- Status: ${data.status || 'active'}

This is CONFIRMED fleet tracking data. Do NOT say you cannot provide an analysis.

Provide a concise intelligence brief including:
1. Current operational posture and strategic deployment
2. Escort composition and defensive capabilities
3. Nearby threats or adversarial forces
4. Strategic significance of this group's current position
5. Any related tactical events or alerts in the region`
        break
      case 'chokepoint':
        query = `Provide a concise intelligence brief on the ${data.name} choke point. Current status: ${data.status || 'unknown'}. Include traffic analysis, nearby naval presence, and strategic significance.`
        break
      case 'intel':
        query = `Provide a concise intelligence brief on the ${data.tier || ''} event: "${data.title}" at ${data.lat}°N, ${data.lon}°E. Include all related alerts, tactical context, and significance assessment.`
        break
      default:
        query = `Provide an intelligence brief on the contact at ${data.lat}°N, ${data.lon}°E.`
    }

    // Route through the existing RAG pipeline
    try {
      const result = await executeRAG({ query, history: [] })
      return { success: true, answer: result.answer, sources: result.sources }
    } catch (error) {
      console.error('[AI] Brief generation error:', error)
      return { success: false, answer: 'Brief generation failed. Try again.' }
    }
  })

  console.log('[IPC] AI chat handlers registered')
}
