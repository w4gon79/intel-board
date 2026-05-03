/**
 * SMTP email sender for alert notifications via nodemailer.
 */

import nodemailer from 'nodemailer'

export interface EmailConfig {
  enabled: boolean
  host: string
  port: number
  user: string
  password: string
  from: string
  to: string
}

export interface EmailAlert {
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

export async function sendEmail(
  config: EmailConfig,
  alert: EmailAlert
): Promise<{ ok: boolean; error?: string }> {
  if (!config.enabled || !config.host || !config.to) {
    return { ok: false, error: 'Email not configured' }
  }

  const subject = `[Intel Board] ${alert.severity}: ${alert.ruleName}`

  const locationLine =
    alert.entity?.lat != null && alert.entity?.lon != null
      ? `Location: ${Math.abs(alert.entity.lat).toFixed(2)}°${alert.entity.lat >= 0 ? 'N' : 'S'}, ${Math.abs(alert.entity.lon).toFixed(2)}°${alert.entity.lon >= 0 ? 'E' : 'W'}`
      : ''

  const timeStr = new Date(alert.timestamp).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')

  const body = [
    'Intel Board Alert',
    '=================',
    '',
    `Rule: ${alert.ruleName}`,
    `Severity: ${alert.severity}`,
    `Type: ${alert.entityType}`,
    `Region: ${alert.regionName}`,
    alert.matchCount != null ? `Entities matched: ${alert.matchCount}` : '',
    '',
    `Custom alert "${alert.ruleName}" triggered in ${alert.regionName}.`,
    '',
    locationLine,
    `Time: ${timeStr}`
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000
    })

    await transporter.sendMail({
      from: config.from || config.user || 'intelboard@localhost',
      to: config.to,
      subject,
      text: body
    })

    transporter.close()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Email send failed'
    }
  }
}

/** Send a test email to verify SMTP configuration */
export async function sendEmailTest(
  config: EmailConfig
): Promise<{ ok: boolean; error?: string }> {
  if (!config.host || !config.to) {
    return { ok: false, error: 'SMTP Host and To address are required' }
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000
    })

    await transporter.sendMail({
      from: config.from || config.user || 'intelboard@localhost',
      to: config.to,
      subject: '[Intel Board] Notification Test',
      text: 'This is a test notification from Intel Board.\n\nIf you received this email, your SMTP configuration is working correctly.'
    })

    transporter.close()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Email test failed'
    }
  }
}