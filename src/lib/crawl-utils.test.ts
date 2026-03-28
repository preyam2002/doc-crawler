import { describe, it, expect } from 'vitest'
import {
  isValidUrl,
  normalizeUrl,
  isSameDomain,
  isDocsPath,
  cleanMarkdown,
  formatBytes,
} from './crawl-utils'

describe('isValidUrl', () => {
  it('accepts valid https URLs', () => {
    expect(isValidUrl('https://docs.example.com/guide')).toBe(true)
  })

  it('accepts valid http URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true)
  })

  it('rejects localhost', () => {
    expect(isValidUrl('http://localhost:3000')).toBe(false)
  })

  it('rejects private IPs', () => {
    expect(isValidUrl('http://192.168.1.1')).toBe(false)
    expect(isValidUrl('http://10.0.0.1')).toBe(false)
    expect(isValidUrl('http://172.16.0.1')).toBe(false)
  })

  it('rejects metadata endpoint', () => {
    expect(isValidUrl('http://169.254.169.254')).toBe(false)
  })

  it('rejects non-http protocols', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false)
    expect(isValidUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false)
    expect(isValidUrl('')).toBe(false)
  })
})

describe('normalizeUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeUrl('https://example.com/docs/')).toBe('https://example.com/docs')
  })

  it('strips hash fragments', () => {
    expect(normalizeUrl('https://example.com/docs#section')).toBe('https://example.com/docs')
  })

  it('strips UTM parameters', () => {
    const url = 'https://example.com/docs?utm_source=twitter&utm_medium=social&page=1'
    const normalized = normalizeUrl(url)
    expect(normalized).not.toContain('utm_source')
    expect(normalized).toContain('page=1')
  })

  it('preserves root path', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })
})

describe('isSameDomain', () => {
  it('returns true for same domain', () => {
    expect(isSameDomain('https://docs.example.com/a', 'https://docs.example.com/b')).toBe(true)
  })

  it('returns false for different domains', () => {
    expect(isSameDomain('https://a.com', 'https://b.com')).toBe(false)
  })

  it('returns false for invalid URLs', () => {
    expect(isSameDomain('not-url', 'https://example.com')).toBe(false)
  })
})

describe('isDocsPath', () => {
  it('detects /docs/ paths', () => {
    expect(isDocsPath('/docs/getting-started')).toBe(true)
  })

  it('detects /guide/ paths', () => {
    expect(isDocsPath('/guide/installation')).toBe(true)
  })

  it('detects /api/ paths', () => {
    expect(isDocsPath('/api/reference')).toBe(true)
  })

  it('rejects non-docs paths', () => {
    expect(isDocsPath('/blog/my-post')).toBe(false)
    expect(isDocsPath('/about')).toBe(false)
  })
})

describe('cleanMarkdown', () => {
  it('collapses excessive newlines', () => {
    expect(cleanMarkdown('a\n\n\n\n\nb')).toBe('a\n\n\nb')
  })

  it('trims trailing whitespace', () => {
    expect(cleanMarkdown('line   \nnext')).toBe('line\nnext')
  })

  it('trims leading/trailing whitespace', () => {
    expect(cleanMarkdown('  content  ')).toBe('content')
  })
})

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1500000)).toBe('1.4 MB')
  })
})
