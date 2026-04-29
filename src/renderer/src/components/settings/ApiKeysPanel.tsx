/**
 * API Keys configuration panel for the Settings drawer.
 * Displays grouped API key fields with masking, status dots, and helper links.
 */

import { useState } from 'react'

interface ApiKeysPanelProps {
  apiKeys: AppSettings['apiKeys']
  onUpdate: (patch: Partial<AppSettings['apiKeys']>) => void
}

// ── Field Definitions ──────────────────────────────────────────────────────

interface KeyField {
  key: keyof AppSettings['apiKeys']
  label: string
  type: 'password' | 'text' | 'url'
  helper: string
  signupUrl?: string
  signupLabel?: string
  multiline?: boolean
  group: string
}

const KEY_FIELDS: KeyField[] = [
  // Group: News & Data
  {
    key: 'newsApiKey',
    label: 'News API Key',
    type: 'password',
    helper: 'Free tier: 100 req/day',
    signupUrl: 'https://newsapi.org/register',
    signupLabel: 'newsapi.org',
    group: 'News & Data'
  },
  // Group: Flight Tracking (ADS-B)
  {
    key: 'openskyUsername',
    label: 'OpenSky Username',
    type: 'text',
    helper: 'OAuth2 client_id for flight tracking',
    signupUrl: 'https://opensky-network.org',
    signupLabel: 'opensky-network.org',
    group: 'Flight Tracking (ADS-B)'
  },
  {
    key: 'openskyPassword',
    label: 'OpenSky Password',
    type: 'password',
    helper: 'OAuth2 client_secret',
    group: 'Flight Tracking (ADS-B)'
  },
  // Group: Ship Tracking (AIS)
  {
    key: 'aisstreamApiKey',
    label: 'AISStream API Key',
    type: 'password',
    helper: 'Free real-time ship tracking via WebSocket',
    signupUrl: 'https://aisstream.io',
    signupLabel: 'aisstream.io',
    group: 'Ship Tracking (AIS)'
  },
  // Group: Vessel Presence
  {
    key: 'gfwApiToken',
    label: 'GFW API Token',
    type: 'password',
    helper: 'JWT token (long string)',
    signupUrl: 'https://globalfishingwatch.org/our-apis',
    signupLabel: 'globalfishingwatch.org',
    multiline: true,
    group: 'Vessel Presence'
  },
  // Group: Economic Data
  {
    key: 'fredApiKey',
    label: 'FRED API Key',
    type: 'password',
    helper: 'Optional. 120 req/min free.',
    signupUrl: 'https://fred.stlouisfed.org/docs/api/api_key.html',
    signupLabel: 'fred.stlouisfed.org',
    group: 'Economic Data (Optional)'
  },
  // Group: Cloud AI
  {
    key: 'zaiApiKey',
    label: 'Z.ai API Key',
    type: 'password',
    helper: 'Optional cloud AI provider',
    signupUrl: 'https://z.ai',
    signupLabel: 'z.ai',
    group: 'Cloud AI (Optional)'
  },
  {
    key: 'zaiBaseUrl',
    label: 'Z.ai Base URL',
    type: 'url',
    helper: 'Default: https://api.z.ai/api/coding/paas/v4',
    group: 'Cloud AI (Optional)'
  }
]

const GROUP_ORDER = [
  'News & Data',
  'Flight Tracking (ADS-B)',
  'Ship Tracking (AIS)',
  'Vessel Presence',
  'Economic Data (Optional)',
  'Cloud AI (Optional)'
]

// ── Component ───────────────────────────────────────────────────────────────

export function ApiKeysPanel({ apiKeys, onUpdate }: ApiKeysPanelProps): React.JSX.Element {
  return (
    <div className="space-y-5">
      {GROUP_ORDER.map((group) => {
        const fields = KEY_FIELDS.filter((f) => f.group === group)
        return (
          <div key={group}>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              {group}
            </h4>
            <div className="space-y-2">
              {fields.map((field) => (
                <KeyFieldInput
                  key={field.key}
                  field={field}
                  value={apiKeys[field.key]}
                  onChange={(val) => onUpdate({ [field.key]: val })}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Key Field Input ─────────────────────────────────────────────────────────

const MASK = '••••••••'

function KeyFieldInput({
  field,
  value,
  onChange
}: {
  field: KeyField
  value: string
  onChange: (val: string) => void
}): React.JSX.Element {
  const [showValue, setShowValue] = useState(false)
  const [editing, setEditing] = useState(false)
  const [localValue, setLocalValue] = useState('')

  const isMasked = value === MASK
  const isSet = isMasked || (value !== '' && value !== MASK)

  function handleFocus(): void {
    if (!editing) {
      setEditing(true)
      setLocalValue('') // Clear for new input; user types fresh value
    }
  }

  function handleBlur(): void {
    if (editing) {
      setEditing(false)
      if (localValue) {
        onChange(localValue)
      }
      setLocalValue('')
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    setLocalValue(e.target.value)
    // Live-update so the parent state stays in sync for save
    onChange(e.target.value)
  }

  function handleClear(): void {
    setEditing(true)
    setLocalValue('')
    onChange('')
  }

  // Display value
  const displayValue = editing ? localValue : isMasked ? MASK : value

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {/* Status dot */}
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isSet ? 'bg-emerald-500' : 'bg-red-500/60'
            }`}
            title={isSet ? 'Key configured' : 'Key not set'}
          />
          <label className="text-[11px] font-medium text-zinc-300">{field.label}</label>
        </div>
        {/* Show/hide toggle (password fields only) */}
        {field.type === 'password' && isSet && (
          <button
            type="button"
            onClick={() => {
              if (editing) {
                setShowValue(!showValue)
              } else {
                setShowValue(!showValue)
              }
            }}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
            title={showValue ? 'Hide' : 'Show'}
          >
            {showValue ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Input field */}
      {field.multiline ? (
        <textarea
          value={displayValue}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder={isMasked ? 'Click to enter new token…' : 'Paste JWT token here…'}
          rows={3}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] text-zinc-300 font-mono placeholder-zinc-600 focus:border-indigo-500 focus:outline-none resize-none"
        />
      ) : (
        <input
          type={field.type === 'password' && !showValue ? 'password' : 'text'}
          value={displayValue}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder={isMasked ? 'Click to enter new value…' : `Enter ${field.label}…`}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] text-zinc-300 font-mono placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
        />
      )}

      {/* Helper text + signup link */}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[9px] text-zinc-600">{field.helper}</span>
        <div className="flex items-center gap-2">
          {/* Clear button when key is set */}
          {(isSet || isMasked) && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[9px] text-red-400/60 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          )}
          {field.signupUrl && (
            <a
              href={field.signupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-indigo-400/70 hover:text-indigo-400 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {field.signupLabel ?? 'Sign up'} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}