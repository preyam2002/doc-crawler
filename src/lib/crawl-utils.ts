/**
 * Utility functions extracted from the crawl API for testability.
 */

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254']
const BLOCKED_PREFIXES = [
  '192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
]

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    if (BLOCKED_HOSTS.includes(parsed.hostname)) return false
    if (BLOCKED_PREFIXES.some((p) => parsed.hostname.startsWith(p))) return false
    return true
  } catch {
    return false
  }
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.searchParams.delete('utm_source')
    parsed.searchParams.delete('utm_medium')
    parsed.searchParams.delete('utm_campaign')
    let path = parsed.pathname.replace(/\/+$/, '') || '/'
    parsed.pathname = path
    return parsed.toString()
  } catch {
    return url
  }
}

export function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const a = new URL(url)
    const b = new URL(baseUrl)
    return a.hostname === b.hostname
  } catch {
    return false
  }
}

export function isDocsPath(path: string): boolean {
  const patterns = [
    '/docs/', '/doc/', '/documentation/', '/guide/', '/guides/',
    '/tutorial/', '/tutorials/', '/reference/', '/api/', '/learn/',
    '/getting-started/', '/handbook/', '/manual/',
  ]
  const lower = path.toLowerCase()
  return patterns.some((p) => lower.includes(p))
}

export function cleanMarkdown(md: string): string {
  return md
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
