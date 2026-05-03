/**
 * Telegram Bot API sender for alert notifications.
 */

export interface TelegramConfig {
  enabled: boolean
  botToken: string
  chatId: string
}

export interface TelegramMessage {
  ruleName: string
  severity: 'ALERT' | 'WATCH' | 'CONTEXT'
  entityType: string
  regionName: string
  matchCount?: number
  entity?: {
    name?: string
    type?: string
    lat?: number | null
    lon?: number | null
  }
  intelItemId: string
  timestamp: string
}

const SEVERITY_EMOJI: Record<string, string> = {
  ALERT: '🚨',
  WATCH: '📡',
  CONTEXT: 'ℹ️'
}

export async function sendTelegram(
  config: TelegramConfig,
  alert: TelegramMessage
): Promise<{ ok: boolean; error?: string }> {
  if (!config.enabled || !config.botToken || !config.chatId) {
    return { ok: false, error: 'Telegram not configured' }
  }

  const emoji = SEVERITY_EMOJI[alert.severity] ?? 'ℹ️'
  const countLine =
    alert.matchCount != null ? `\n${alert.matchCount} ${alert.entityType}(s) matched` : ''

  const entityLine =
    alert.entity?.lat != null && alert.entity?.lon != null
      ? `\n📍 ${Math.abs(alert.entity.lat).toFixed(2)}°${alert.entity.lat >= 0 ? 'N' : 'S'}, ${Math.abs(alert.entity.lon).toFixed(2)}°${alert.entity.lon >= 0 ? 'E' : 'W'}`
      : ''

  const text = [
    `${emoji} ${alert.severity}: ${alert.ruleName}`,
    `Severity: ${alert.severity} | Type: ${alert.entityType} | Region: ${alert.regionName}`,
    countLine,
    '',
    `Details: Custom alert "${alert.ruleName}" triggered in ${alert.regionName}.`,
    entityLine
  ].join('\n')

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'HTML'
      }),
      signal: AbortSignal.timeout(10_000)
    })

    if (!resp.ok) {
      const body = await resp.text()
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` }
    }

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Telegram send failed'
    }
  }
}

/** Send a test message to verify Telegram configuration */
export async function sendTelegramTest(
  config: TelegramConfig
): Promise<{ ok: boolean; error?: string }> {
  if (!config.botToken || !config.chatId) {
    return { ok: false, error: 'Bot Token and Chat ID are required' }
  }

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: '🚨 Intel Board notification test\n\nIf you see this, Telegram notifications are working correctly.'
      }),
      signal: AbortSignal.timeout(10_000)
    })

    if (!resp.ok) {
      const body = await resp.text()
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` }
    }

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Telegram test failed'
    }
  }
}