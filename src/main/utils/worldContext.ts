/**
 * Current world context string prepended to all LLM system prompts.
 * This grounds the model in current reality despite its training cutoff.
 * Update this as world events change.
 */

export const WORLD_CONTEXT = `Current date: ${new Date().toISOString().split('T')[0]}.

Key world context as of April 2026:
- The President of the United States is Donald Trump (inaugurated January 2025 for his second term).
- The Vice President is JD Vance.
- The US is engaged in military conflict with Iran. Strait of Hormuz has been contested.
- China-Taiwan tensions remain elevated with ongoing military activity.
- Russia-Ukraine conflict continues.
- Israel-Hezbollah conflict is active.

When referencing any of these actors, use their CURRENT titles and roles, not historical ones.`

/**
 * Prepends world context to a system prompt.
 */
export function withWorldContext(systemPrompt: string): string {
  return `${WORLD_CONTEXT}\n\n${systemPrompt}`
}