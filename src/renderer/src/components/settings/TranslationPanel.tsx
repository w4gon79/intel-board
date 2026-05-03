/**
 * TranslationPanel — settings for multi-language news source ingestion and translation.
 */

import { useState } from 'react'

const LANGUAGES = [
  { code: 'ar', label: 'Arabic', flag: '🇸🇦', testPhrase: 'القوات المسلحة تطلق مناورات عسكرية في المنطقة الشرقية' },
  { code: 'ru', label: 'Russian', flag: '🇷🇺', testPhrase: 'Военные корабли начали учения в Тихом океане' },
  { code: 'zh', label: 'Chinese', flag: '🇨🇳', testPhrase: '军方在南海进行大规模军事演习' },
  { code: 'fa', label: 'Farsi', flag: '🇮🇷', testPhrase: 'نیروهای مسلح مانور نظامی را در خلیج فارس آغاز کردند' },
  { code: 'ko', label: 'Korean', flag: '🇰🇷', testPhrase: '군부대가 동해상에서 대규모 군사 훈련을 시작했다' },
  { code: 'es', label: 'Spanish', flag: '🇻🇪', testPhrase: 'Las fuerzas armadas iniciaron maniobras militares en la región fronteriza' }
]

interface TranslationPanelProps {
  settings: AppSettings['translation']
  aiBaseUrl: string
  onUpdate: (patch: Partial<AppSettings['translation']>) => void
}

export function TranslationPanel({ settings, aiBaseUrl, onUpdate }: TranslationPanelProps): React.JSX.Element {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; translation?: string; error?: string } | null>(null)
  const [testLang, setTestLang] = useState('ar')

  async function handleTestTranslation(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const lang = LANGUAGES.find((l) => l.code === testLang)
      const phrase = lang?.testPhrase ?? 'Hello world'
      const result = await window.api.settings.testTranslation(phrase, testLang)
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  function toggleLanguage(code: string): void {
    const current = settings.sourceLanguages
    if (current.includes(code)) {
      onUpdate({ sourceLanguages: current.filter((c) => c !== code) })
    } else {
      onUpdate({ sourceLanguages: [...current, code] })
    }
  }

  return (
    <div className="space-y-3">
      {/* Master toggle */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-zinc-300">Multi-Language Sources</span>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Ingest non-English news sources (RT, Al Jazeera, Xinhua, IRNA, etc.) and translate to English.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            onClick={() => onUpdate({ enabled: !settings.enabled })}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              settings.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                settings.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {settings.enabled && (
        <>
          {/* Source languages */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
            <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Source Languages
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {LANGUAGES.map((lang) => (
                <label
                  key={lang.code}
                  className="flex items-center gap-1.5 rounded px-2 py-1.5 cursor-pointer hover:bg-zinc-800/50"
                >
                  <input
                    type="checkbox"
                    checked={settings.sourceLanguages.includes(lang.code)}
                    onChange={() => toggleLanguage(lang.code)}
                    className="h-3 w-3 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="text-[11px] text-zinc-300">
                    {lang.flag} {lang.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Translation model */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
            <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
              Translation Model
            </label>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              placeholder="e.g., qwen2.5:3b or llama3.1:8b"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-600 mt-1">
              Uses Ollama at {aiBaseUrl || 'localhost:11434'}. Any model you've pulled will work.
            </p>
          </div>

          {/* Batch settings */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1">Batch Size</label>
                <input
                  type="number"
                  value={settings.batchSize}
                  onChange={(e) => onUpdate({ batchSize: Math.max(1, Number(e.target.value)) })}
                  min={1}
                  max={50}
                  className="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1">Batch Delay (sec)</label>
                <input
                  type="number"
                  value={Math.round(settings.batchDelayMs / 1000)}
                  onChange={(e) => onUpdate({ batchDelayMs: Math.max(5, Number(e.target.value)) * 1000 })}
                  min={5}
                  max={300}
                  className="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
                />
              </div>
            </div>
            <p className="text-[10px] text-zinc-600 mt-1.5">
              Articles per translation batch and delay between batches. Lower values are gentler on your hardware.
            </p>
          </div>

          {/* Privacy notice */}
          <div className="rounded border border-amber-900/30 bg-amber-950/20 p-2.5">
            <p className="text-[10px] text-amber-400/80">
              ⚠️ <strong>Privacy:</strong> If using a cloud model for translation, article text will be sent to the cloud provider's servers. Local models keep all data on your machine.
            </p>
          </div>

          {/* Test translation */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
            <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
              Test Translation
            </label>
            <div className="flex items-center gap-2 mb-2">
              <select
                value={testLang}
                onChange={(e) => setTestLang(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleTestTranslation}
                disabled={testing}
                className="rounded bg-indigo-600 px-3 py-1 text-[10px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {testing ? 'Translating…' : 'Test'}
              </button>
            </div>
            {testResult && (
              <div
                className={`rounded border p-2 text-[10px] ${
                  testResult.ok
                    ? 'border-emerald-800/50 bg-emerald-950/20 text-emerald-300'
                    : 'border-red-800/50 bg-red-950/20 text-red-300'
                }`}
              >
                {testResult.ok ? (
                  <>
                    <span className="font-medium">Translation:</span>{' '}
                    {testResult.translation}
                  </>
                ) : (
                  <>
                    <span className="font-medium">Error:</span> {testResult.error}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}