/**
 * linkify — detect URLs in text and convert them to clickable anchor elements.
 *
 * Used by the Intelligence Feed and AI chat to render source URLs as links.
 * Matches the styling convention from SourceCitation: text-sky-400 hover:underline.
 */

import type { ReactNode } from 'react'

const URL_REGEX = /https?:\/\/[^\s,;)\]}>]+/g

/**
 * Check if a string is a URL.
 */
export function isUrl(text: string): boolean {
  return URL_REGEX.test(text)
}

/**
 * Convert URLs in a string to React anchor elements.
 * Non-URL text is preserved as-is.
 *
 * Returns an array of strings and JSX elements.
 */
export function linkifyText(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  URL_REGEX.lastIndex = 0

  while ((match = URL_REGEX.exec(text)) !== null) {
    const url = match[0]
    const index = match.index

    // Push preceding text as a keyed span
    if (index > lastIndex) {
      parts.push(
        <span key={`text-${key++}`}>{text.slice(lastIndex, index)}</span>
      )
    }

    // Push linked URL
    parts.push(
      <a
        key={`link-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    )

    lastIndex = index + url.length
  }

  // Push remaining text as a keyed span
  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${key++}`}>{text.slice(lastIndex)}</span>
    )
  }

  return parts.length > 0 ? parts : [<span key="text-0">{text}</span>]
}

/**
 * Render a source entry — if it looks like a URL, make it clickable;
 * otherwise render as plain text.
 *
 * Handles prefixed sources like "gdelt:domain.com" → links to https://domain.com
 * and displays just "domain.com" as the link text.
 */
export function linkifySource(source: string, index: number): ReactNode {
  let href = source
  let label = source

  // Handle prefixed sources like "gdelt:domain.com" -> "https://domain.com"
  const prefixed = source.match(/^(\w+):(.+\..+)$/)
  if (prefixed) {
    href = `https://${prefixed[2]}`
    label = prefixed[2]
  }

  if (isUrl(source) || prefixed) {
    return (
      <a
        key={`src-${index}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>
    )
  }
  return source
}
