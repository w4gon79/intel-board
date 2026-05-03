/**
 * Notification Service — dispatches alert notifications to all enabled channels.
 *
 * Channels: Telegram, Webhook (HTTP POST), Email (SMTP).
 * All sends run in parallel; one channel failing does not block others.
 */

import { loadSettings } from '../../ipc/settings.handlers'
import { sendTelegram, sendTelegramTest } from './telegramSender'
import { sendWebhook, sendWebhookTest } from './webhookSender'
import { sendEmail, sendEmailTest } from './emailSender'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AlertNotification {
  ruleName: string
  severity: 'ALERT' | 'WATCH' | 'CONTEXT'
  label: string
  entityType: 'ship' | 'aircraft' | 'csg'
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

// ── Core Dispatch ──────────────────────────────────────────────────────────

/**
 * Send an alert notification to all enabled channels in parallel.
 * Never throws — errors are logged but do not propagate.
 */
export async function sendAlert(alert: AlertNotification): Promise<void> {
  let settings: ReturnType<typeof loadSettings> | null = null
  try {
    settings = loadSettings()
  } catch (err) {
    console.error('[Notifications] Could not load settings:', err)
    return
  }

  const channels: string[] = []

  const promises: Promise<{ ok: boolean; error?: string }>[] = []

  // Telegram
  const tg = settings.notificationChannels?.telegram
  if (tg?.enabled && tg.botToken && tg.chatId) {
    channels.push('telegram')
    promises.push(
      sendTelegram(tg, alert).then((result) => {
        if (result.ok) {
          console.log('[Notifications] Telegram sent OK')
        } else {
          console.error('[Notifications] Telegram failed:', result.error)
        }
        return result
      })
    )
  }

  // Webhook
  const wh = settings.notificationChannels?.webhook
  if (wh?.enabled && wh.url) {
    channels.push('webhook')
    promises.push(
      sendWebhook(wh, {
        type: 'alert',
        timestamp: alert.timestamp,
        rule: {
          name: alert.ruleName,
          severity: alert.severity,
          entity_type: alert.entityType,
          label: alert.label
        },
        entity: alert.entity ?? undefined,
        matchCount: alert.matchCount,
        intelItemId: alert.intelItemId,
        region: alert.regionName
      }).then((result) => {
        if (result.ok) {
          console.log('[Notifications] Webhook sent OK')
        } else {
          console.error('[Notifications] Webhook failed:', result.error)
        }
        return result
      })
    )
  }

  // Email
  const em = settings.notificationChannels?.email
  if (em?.enabled && em.host && em.to) {
    channels.push('email')
    promises.push(
      sendEmail(em, alert).then((result) => {
        if (result.ok) {
          console.log('[Notifications] Email sent OK')
        } else {
          console.error('[Notifications] Email failed:', result.error)
        }
        return result
      })
    )
  }

  if (channels.length === 0) return

  const results = await Promise.allSettled(promises)

  const allFailed = results.every(
    (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
  )

  if (allFailed) {
    console.error(`[Notifications] All channels (${channels.join(', ')}) failed for alert "${alert.ruleName}"`)
  }
}

// ── Test Dispatch ──────────────────────────────────────────────────────────

/**
 * Send a test notification to all enabled channels.
 * Returns per-channel results for the UI to display.
 */
export async function sendTestNotification(): Promise<
  Record<string, { ok: boolean; error?: string }>
> {
  let settings: ReturnType<typeof loadSettings> | null = null
  try {
    settings = loadSettings()
  } catch (err) {
    return { global: { ok: false, error: 'Could not load settings' } }
  }

  const results: Record<string, { ok: boolean; error?: string }> = {}

  const promises: Promise<void>[] = []

  // Telegram test
  const tg = settings.notificationChannels?.telegram
  if (tg?.enabled && tg.botToken && tg.chatId) {
    promises.push(
      sendTelegramTest(tg).then((r) => {
        results.telegram = r
      })
    )
  }

  // Webhook test
  const wh = settings.notificationChannels?.webhook
  if (wh?.enabled && wh.url) {
    promises.push(
      sendWebhookTest(wh).then((r) => {
        results.webhook = r
      })
    )
  }

  // Email test
  const em = settings.notificationChannels?.email
  if (em?.enabled && em.host && em.to) {
    promises.push(
      sendEmailTest(em).then((r) => {
        results.email = r
      })
    )
  }

  await Promise.allSettled(promises)

  if (Object.keys(results).length === 0) {
    return { global: { ok: false, error: 'No notification channels enabled' } }
  }

  return results
}

/**
 * Return which channels are configured and enabled.
 */
export function getNotificationStatus(): Record<string, { enabled: boolean; configured: boolean }> {
  let settings: ReturnType<typeof loadSettings>
  try {
    settings = loadSettings()
  } catch {
    return {}
  }

  const tg = settings.notificationChannels?.telegram
  const wh = settings.notificationChannels?.webhook
  const em = settings.notificationChannels?.email

  return {
    telegram: {
      enabled: tg?.enabled ?? false,
      configured: !!(tg?.botToken && tg?.chatId)
    },
    webhook: {
      enabled: wh?.enabled ?? false,
      configured: !!wh?.url
    },
    email: {
      enabled: em?.enabled ?? false,
      configured: !!(em?.host && em?.to)
    }
  }
}