/**
 * Generic HTTP webhook sender for alert notifications.
 */

export interface WebhookConfig {
  enabled: boolean
  url: string
  headers: Record<string, string>
}

export interface WebhookPayload {
  type: 'alert'
  timestamp: string
  rule: {
    name: string
    severity: 'ALERT' | 'WATCH' | 'CONTEXT'
    entity_type: string
    label: string
  }
  entity?: {
    name?: string
    type?: string
    lat?: number | null
    lon?: number | null
  }
  matchCount?: number
  intelItemId: string
  region: string
}

export async function sendWebhook(
  config: WebhookConfig,
  payload: WebhookPayload
): Promise<{ ok: boolean; error?: string }> {
  if (!config.enabled || !config.url) {
    return { ok: false, error: 'Webhook not configured' }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.headers
  }

  try {
    const resp = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    })

    if (!resp.ok) {
      // Retry once on failure
      try {
        const retryResp = await fetch(config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000)
        })
        if (retryResp.ok) return { ok: true }
        return { ok: false, error: `HTTP ${retryResp.status} (retry)` }
      } catch {
        return { ok: false, error: `HTTP ${resp.status} (retry failed)` }
      }
    }

    return { ok: true }
  } catch (err) {
    // Retry once on network error
    try {
      const retryResp = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000)
      })
      if (retryResp.ok) return { ok: true }
      return { ok: false, error: `HTTP ${retryResp.status} (retry)` }
    } catch (retryErr) {
      return {
        ok: false,
        error: retryErr instanceof Error ? retryErr.message : 'Webhook send failed'
      }
    }
  }
}

/** Send a test payload to verify webhook configuration */
export async function sendWebhookTest(
  config: WebhookConfig
): Promise<{ ok: boolean; error?: string }> {
  if (!config.url) {
    return { ok: false, error: 'Webhook URL is required' }
  }

  const testPayload: WebhookPayload = {
    type: 'alert',
    timestamp: new Date().toISOString(),
    rule: {
      name: 'Test Alert',
      severity: 'CONTEXT',
      entity_type: 'ship',
      label: 'Test'
    },
    matchCount: 0,
    intelItemId: 'test',
    region: 'Test Region'
  }

  return sendWebhook(config, testPayload)
}