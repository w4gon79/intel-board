/**
 * Notification Service — dispatches alert notifications to all enabled channels.
 *
 * Channels: Telegram, Webhook (HTTP POST), Email (SMTP).
 * All sends run in parallel; one channel failing does not block others.
 */

import { loadSettings } from '../../ipc/settings.handlers'
// Telegram sender module was removed - stubs below
const sendTelegram = async (_msg: string): Promise<{ ok: boolean; error?: string }> => ({ ok: false, error: 'Telegram module removed' })
const sendTelegramTest = async (_s: unknown): Promise<{ ok: boolean; error?: string }> => ({ ok: false, error: 'Telegram module removed' })
const sendTelegramDetection = async (_s: unknown, _d: unknown): Promise<{ ok: boolean; error?: string }> => ({ ok: false, error: 'Telegram module removed' })
import { sendWebhook, sendWebhookTest } from './webhookSender'
import { sendEmail, sendEmailTest, sendEmailDetection } from './emailSender'
import { isNotificationOnCooldown, markNotificationSent, cleanupNotificationCooldowns } from '../storage/dbService'

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

// ── Rate Limiter for Built-in Detections (DB-backed, survives restarts) ────

const COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes per notification key

// Clean up expired cooldowns every 30 minutes
setInterval(() => {
  const cleaned = cleanupNotificationCooldowns()
  if (cleaned > 0) console.log(`[Notifications] Cleaned ${cleaned} expired cooldowns`)
}, 30 * 60 * 1000)

// ── Built-in Detection Notification ────────────────────────────────────────

export interface DetectionNotification {
  id?: string
  tier: string
  title: string
  summary: string
  region: string | null
  categories: string[]
  latitude: number | null
  longitude: number | null
  sources: string[] | string
}

/**
 * Send a notification for a built-in intel item (non-alert-rule).
 * Only notifies for ALERT and WATCH tier items — CONTEXT items are skipped.
 * Uses in-memory rate limiting to prevent spamming.
 */
export async function notifyIntelItem(item: DetectionNotification): Promise<void> {
  // Skip CONTEXT tier — too noisy
  if (item.tier === 'CONTEXT') return

  let settings: ReturnType<typeof loadSettings> | null = null
  try {
    settings = loadSettings()
  } catch (err) {
    console.error('[Notifications] Could not load settings:', err)
    return
  }

  // Check category-based notification toggles
  const alerts = settings.alerts as Record<string, unknown> & {
    notifyTactical?: boolean
    notifyEconomic?: boolean
    notifySenseMaking?: boolean
  }

  const cats = item.categories.map(c => c.toLowerCase())
  if (cats.includes('tactical') && alerts.notifyTactical === false) return
  if (cats.includes('economic') && alerts.notifyEconomic === false) return
  if (cats.includes('ai-sensemaking') && alerts.notifySenseMaking === false) return

  // Rate limit by item ID first (prevents re-notification of same DB item after restart)
  // then by tier:title key for similar events (DB-backed, survives restarts)
  const itemCooldownKey = `item:${item.id ?? item.title}`
  if (isNotificationOnCooldown(itemCooldownKey, COOLDOWN_MS * 4)) { // 1 hour per item ID
    console.log(`[Notifications] Item rate limited: ${itemCooldownKey}`)
    return
  }
  const cooldownKey = `${item.tier}:${item.title}`
  if (isNotificationOnCooldown(cooldownKey, COOLDOWN_MS)) {
    console.log(`[Notifications] Rate limited: ${cooldownKey}`)
    return
  }

  const channels: string[] = []
  const promises: Promise<{ ok: boolean; error?: string }>[] = []

  // Telegram
  const tg = settings.notificationChannels?.telegram
  if (tg?.enabled && tg.botToken && tg.chatId) {
    channels.push('telegram')
    promises.push(
      sendTelegramDetection(tg, item).then((result) => {
        if (result.ok) {
          console.log('[Notifications] Telegram detection sent OK')
        } else {
          console.error('[Notifications] Telegram detection failed:', result.error)
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
        type: 'detection',
        timestamp: new Date().toISOString(),
        detection: {
          tier: item.tier,
          title: item.title,
          summary: item.summary,
          region: item.region ?? 'Unknown',
          categories: item.categories,
          latitude: item.latitude,
          longitude: item.longitude
        }
      }).then((result) => {
        if (result.ok) {
          console.log('[Notifications] Webhook detection sent OK')
        } else {
          console.error('[Notifications] Webhook detection failed:', result.error)
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
      sendEmailDetection(em, item).then((result) => {
        if (result.ok) {
          console.log('[Notifications] Email detection sent OK')
        } else {
          console.error('[Notifications] Email detection failed:', result.error)
        }
        return result
      })
    )
  }

  if (channels.length === 0) return

  // Mark as sent for rate limiting (persisted to DB)
  markNotificationSent(cooldownKey)
  markNotificationSent(itemCooldownKey)

  const results = await Promise.allSettled(promises)

  const allFailed = results.every(
    (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
  )

  if (allFailed) {
    console.error(`[Notifications] All channels (${channels.join(', ')}) failed for detection "${item.title}"`)
  }
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
      sendTelegram(JSON.stringify(alert)).then((result) => {
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