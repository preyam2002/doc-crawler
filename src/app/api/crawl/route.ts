import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import puppeteer, { type Browser, type HTTPRequest } from 'puppeteer';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────

const CONFIG = {
  limits: {
    maxDepth: 2,
    maxPages: 50,
    maxConcurrency: 3,
    maxPageSize: 5 * 1024 * 1024,
    fetchTimeout: 30_000,
    fastFetchTimeout: 8_000,
    directMdTimeout: 5_000,
    jinaTimeout: 15_000,
  },
  security: {
    allowedProtocols: ['http:', 'https:'],
    blockedHosts: ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'],
    blockedPrefixes: [
      '192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
      '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
      '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
    ],
  },
  contentSelectors: [
    '.theme-doc-markdown',
    '#docusaurus_skipToContent_fallback .markdown',
    '#docusaurus_skipToContent_fallback',
    '.vp-doc',
    '.nextra-content',
    '.md-content__inner',
    '.md-content',
    '.page-body',
    '.rst-content',
    '[role="main"] .document',
    '.document',
    '.markdown-body',
    'article',
    'main',
    '.doc-content',
    '.docs-content',
    '.content',
    '#main-content',
    '#content',
    '[role="main"]',
    '.prose',
  ],
  removeSelectors: [
    'nav', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg',
    '.sidebar', '.theme-doc-sidebar-container',
    '.menu', '.navbar', '.nav-bar', '.navigation',
    '.toc', '.table-of-contents', '.on-this-page',
    '.theme-doc-toc-desktop', '.theme-doc-toc-mobile',
    '.breadcrumbs', '.breadcrumb', '[aria-label="breadcrumbs"]',
    '.pagination', '.pager', '.page-nav', '.theme-doc-footer',
    '.edit-this-page', '.edit-page-link',
    '.hash-link', '.anchor-link',
    '.copy-button', '.code-copy-button',
    '.skip-to-content',
  ],
  docsPatterns: [
    '/docs/', '/documentation/', '/guide/', '/guides/',
    '/manual/', '/api/', '/reference/', '/learn/',
    '/tutorial/', '/tutorials/', '/getting-started/',
    '/quickstart/', '/handbook/', '/wiki/',
  ],
  stripParams: [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'ref', 'source', 'fbclid', 'gclid',
  ],
};

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ────────────────────────────────────────────
// Rate limiting (in-memory)
// ────────────────────────────────────────────

const rateLimitStore = new Map<string, { windowStart: number; count: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const MAX_REQUESTS = 20;

function getClientIP(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();

  if (rateLimitStore.size > 10_000) {
    for (const [key, val] of rateLimitStore) {
      if (now - val.windowStart > RATE_LIMIT_WINDOW) rateLimitStore.delete(key);
    }
  }

  let record = rateLimitStore.get(ip);
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    record = { windowStart: now, count: 0 };
    rateLimitStore.set(ip, record);
  }
  record.count++;
  return record.count > MAX_REQUESTS;
}

let activeCrawls = 0;
const MAX_CONCURRENT_CRAWLS = 3;

function isAllowedURL(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!CONFIG.security.allowedProtocols.includes(url.protocol)) return false;
    const h = url.hostname;
    if (CONFIG.security.blockedHosts.includes(h)) return false;
    if (CONFIG.security.blockedPrefixes.some((p) => h.startsWith(p))) return false;
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────
// Markdown validation
// ────────────────────────────────────────────

function looksLikeMarkdown(text: string): boolean {
  if (text.length < 50) return false;
  if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) return false;
  // Must have at least one markdown pattern: heading, list, link, or code block
  return (
    /^#{1,6}\s/m.test(text) ||
    /^\s*[-*+]\s/m.test(text) ||
    /\[.+?\]\(.+?\)/.test(text) ||
    /^```/m.test(text)
  );
}

// ────────────────────────────────────────────
// Crawler
// ────────────────────────────────────────────

type FetchMethod = 'direct-md' | 'jina' | 'http' | 'puppeteer';
type CrawlResult = { url: string; depth: number; markdown: string; size: number; method: FetchMethod };
type FetchResult = { type: 'markdown' | 'html'; content: string; method: FetchMethod; htmlForLinks?: string };
type ProgressEvent = { type: string; url?: string; method?: FetchMethod; pagesCrawled: number; pagesFound: number };

class DocCrawler {
  private maxDepth: number;
  private maxPages: number;
  private visited = new Set<string>();
  private results: CrawlResult[] = [];
  private turndown: TurndownService;
  private browser: Browser | null = null;
  private startUrl = '';
  private onProgress?: (info: ProgressEvent) => void;

  constructor(opts: { maxDepth: number; maxPages: number; onProgress?: (info: ProgressEvent) => void }) {
    this.maxDepth = Math.min(opts.maxDepth, CONFIG.limits.maxDepth);
    this.maxPages = Math.min(opts.maxPages, CONFIG.limits.maxPages);
    this.onProgress = opts.onProgress;

    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    this.turndown.remove(['script', 'style', 'noscript']);
  }

  // Browser lifecycle ────────────────────────

  private async ensureBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
        ],
      });
    }
    return this.browser;
  }

  private async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // URL helpers ──────────────────────────────

  private normalizeUrl(raw: string, base?: string): string | null {
    try {
      const u = new URL(raw, base);
      u.hash = '';
      CONFIG.stripParams.forEach((p) => u.searchParams.delete(p));
      let out = u.toString();
      if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
      return out;
    } catch {
      return null;
    }
  }

  // ─── Strategy 1: Direct .md file from server ───

  private async tryDirectMd(url: string): Promise<string | null> {
    const urlObj = new URL(url);

    // Generate candidate .md URLs
    const candidates: string[] = [];
    const path = urlObj.pathname;

    // /docs/intro → /docs/intro.md
    if (!path.endsWith('.md')) {
      candidates.push(`${urlObj.origin}${path.replace(/\/?$/, '.md')}`);
    }

    // /docs/intro → /docs/intro/index.md
    candidates.push(`${urlObj.origin}${path.replace(/\/?$/, '/index.md')}`);

    // /docs/intro/ → /docs/intro/README.md
    candidates.push(`${urlObj.origin}${path.replace(/\/?$/, '/README.md')}`);

    for (const mdUrl of candidates) {
      try {
        const res = await fetch(mdUrl, {
          headers: {
            'User-Agent': BROWSER_UA,
            Accept: 'text/markdown, text/plain, */*',
          },
          signal: AbortSignal.timeout(CONFIG.limits.directMdTimeout),
          redirect: 'follow',
        });

        if (!res.ok) continue;

        const ct = res.headers.get('content-type') || '';
        const text = await res.text();

        // Accept if content-type says markdown/plain and it looks like markdown
        if (
          (ct.includes('text/markdown') || ct.includes('text/plain') || ct.includes('text/x-markdown')) &&
          looksLikeMarkdown(text)
        ) {
          return text;
        }

        // Even without correct content-type, if it's clearly markdown, use it
        if (looksLikeMarkdown(text) && !ct.includes('text/html')) {
          return text;
        }
      } catch {
        // timeout or network error, try next candidate
      }
    }

    return null;
  }

  // ─── Strategy 2: Jina Reader API ───

  private async tryJinaReader(url: string): Promise<string | null> {
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: {
          Accept: 'text/markdown',
          'X-No-Cache': 'true',
        },
        signal: AbortSignal.timeout(CONFIG.limits.jinaTimeout),
        redirect: 'follow',
      });

      if (!res.ok) return null;

      const text = await res.text();
      if (text.length > 100 && looksLikeMarkdown(text)) {
        return text;
      }
    } catch {
      // timeout or unavailable
    }

    return null;
  }

  // ─── Strategy 3: Fast HTTP fetch ───

  private async tryHttpFetch(url: string): Promise<FetchResult | null> {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), CONFIG.limits.fastFetchTimeout);

      const res = await fetch(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html, text/markdown, application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: ac.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        const text = await res.text();

        // Markdown response
        if (ct.includes('text/markdown') || (ct.includes('text/plain') && text.startsWith('#'))) {
          return { type: 'markdown', content: text, method: 'http' };
        }

        // HTML response — validate it's useful
        if (ct.includes('text/html') && text.length > 500) {
          const $ = cheerio.load(text);
          const title = $('title').text().toLowerCase();
          const is404 =
            title.includes('404') ||
            title.includes('not found') ||
            title.includes('page not found');

          if (!is404) {
            const hasContent = CONFIG.contentSelectors.some(
              (sel) => $(sel).length > 0 && $(sel).text().trim().length > 100,
            );
            if (hasContent || text.length > 5000) {
              return { type: 'html', content: text, method: 'http' };
            }
          }
        }
      }
    } catch {
      // fall through
    }

    return null;
  }

  // ─── Strategy 4: Puppeteer browser rendering ───

  private async tryPuppeteer(url: string): Promise<FetchResult | null> {
    let page: Awaited<ReturnType<Browser['newPage']>> | null = null;
    try {
      const browser = await this.ensureBrowser();
      page = await browser.newPage();
      await page.setUserAgent(BROWSER_UA);
      await page.setViewport({ width: 1280, height: 800 });

      await page.setRequestInterception(true);
      page.on('request', (req: HTTPRequest) => {
        const t = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media', 'texttrack', 'websocket'].includes(t)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.limits.fetchTimeout });

      try {
        await page.waitForSelector(
          'main, article, .content, .markdown-body, .theme-doc-markdown, .vp-doc, .nextra-content, .md-content, .rst-content, #__docusaurus, [role="main"]',
          { timeout: 8000 },
        );
      } catch {
        // Content may exist without matching selectors
      }

      await new Promise((r) => setTimeout(r, 500));

      const content = await page.content();

      if (content.length < 500) return null;
      return { type: 'html', content, method: 'puppeteer' };
    } catch (err) {
      console.error(`[Puppeteer] Failed: ${url} —`, err instanceof Error ? err.message : err);
      return null;
    } finally {
      await page?.close().catch(() => {});
    }
  }

  // ─── Fetch HTML specifically for link discovery ───

  private async fetchHtmlForLinks(url: string): Promise<string | null> {
    // Quick HTTP fetch just to get HTML for link extraction
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(CONFIG.limits.fastFetchTimeout),
        redirect: 'follow',
      });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          const text = await res.text();
          if (text.length > 500) return text;
        }
      }
    } catch {}

    // Fall back to Puppeteer for SPA sites
    const puppeteerResult = await this.tryPuppeteer(url);
    return puppeteerResult?.type === 'html' ? puppeteerResult.content : null;
  }

  // ─── Combined fetch with strategy cascade ───

  private async fetchPage(url: string, needLinks: boolean = false): Promise<FetchResult | null> {
    if (!isAllowedURL(url)) return null;

    // Strategy 1: Direct .md file
    const directMd = await this.tryDirectMd(url);
    if (directMd) {
      const result: FetchResult = { type: 'markdown', content: directMd, method: 'direct-md' };
      // If we need links, also fetch the HTML page
      if (needLinks) {
        result.htmlForLinks = await this.fetchHtmlForLinks(url) ?? undefined;
      }
      return result;
    }

    // Strategy 2: Jina Reader (fast markdown conversion)
    const jina = await this.tryJinaReader(url);
    if (jina) {
      const result: FetchResult = { type: 'markdown', content: jina, method: 'jina' };
      if (needLinks) {
        result.htmlForLinks = await this.fetchHtmlForLinks(url) ?? undefined;
      }
      return result;
    }

    // Strategy 3: Fast HTTP fetch
    const httpResult = await this.tryHttpFetch(url);
    if (httpResult) return httpResult;

    // Strategy 4: Puppeteer browser rendering
    return this.tryPuppeteer(url);
  }

  // Content extraction ───────────────────────

  private htmlToMarkdown(html: string, url: string): string {
    const $ = cheerio.load(html);

    let $content: ReturnType<typeof $.root> | null = null;
    for (const sel of CONFIG.contentSelectors) {
      const found = $(sel);
      if (found.length > 0 && found.text().trim().length > 50) {
        $content = found.first();
        break;
      }
    }
    if (!$content) $content = $('body');

    $content.find(CONFIG.removeSelectors.join(', ')).remove();

    const raw = $content.html();
    if (!raw || raw.trim().length < 20) return '';

    const markdown = this.turndown.turndown(raw);
    const title = $('title').text().trim() || $('h1').first().text().trim() || url;

    const cleaned = markdown
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/^\s+/, '')
      .replace(/\s+$/, '');

    return `<!-- Source: ${url} -->\n# ${title}\n\n${cleaned}`;
  }

  // Link discovery ───────────────────────────

  private extractLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links = new Set<string>();
    const baseDomain = new URL(baseUrl).hostname;
    const resolveBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      if (
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:')
      )
        return;

      if (/\.(pdf|zip|tar|gz|png|jpg|jpeg|gif|svg|ico|css|js|woff2?|ttf|eot|mp[34])$/i.test(href))
        return;

      const full = this.normalizeUrl(href, resolveBase);
      if (!full) return;

      try {
        const u = new URL(full);
        if (u.hostname !== baseDomain) return;

        const isDoc = CONFIG.docsPatterns.some((p) => u.pathname.includes(p));
        const isUnderBase = full.startsWith(baseUrl.replace(/\/$/, ''));
        const isUnderStart = this.startUrl && full.startsWith(this.startUrl.replace(/\/$/, ''));
        if (!isDoc && !isUnderBase && !isUnderStart) return;

        links.add(full);
      } catch {
        // invalid URL
      }
    });

    return Array.from(links);
  }

  // Main crawl loop ──────────────────────────

  async crawl(startUrl: string) {
    const start = this.normalizeUrl(startUrl);
    if (!start) throw new Error('Invalid URL');

    this.startUrl = start;
    const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
    this.visited.add(start);

    try {
      while (queue.length > 0 && this.results.length < this.maxPages) {
        const item = queue.shift()!;
        const { url, depth } = item;

        this.onProgress?.({
          type: 'crawling',
          url,
          pagesCrawled: this.results.length,
          pagesFound: this.visited.size,
        });

        const needLinks = depth < this.maxDepth;
        const data = await this.fetchPage(url, needLinks);
        if (!data) continue;

        let markdown = '';
        let htmlForLinks = '';

        if (data.type === 'markdown') {
          markdown = `<!-- Source: ${url} -->\n${data.content}`;
          htmlForLinks = data.htmlForLinks || '';
        } else {
          markdown = this.htmlToMarkdown(data.content, url);
          htmlForLinks = data.content;
        }

        if (markdown.trim().length > 100) {
          this.results.push({ url, depth, markdown, size: markdown.length, method: data.method });
          this.onProgress?.({
            type: 'crawled',
            url,
            method: data.method,
            pagesCrawled: this.results.length,
            pagesFound: this.visited.size,
          });
        }

        if (needLinks && htmlForLinks) {
          const links = this.extractLinks(htmlForLinks, url);
          for (const link of links) {
            if (!this.visited.has(link) && this.visited.size < this.maxPages * 3) {
              this.visited.add(link);
              queue.push({ url: link, depth: depth + 1 });
            }
          }
        }
      }
    } finally {
      await this.closeBrowser();
    }

    return {
      results: this.results,
      stats: { pagesFound: this.visited.size, pagesCrawled: this.results.length },
    };
  }
}

// ────────────────────────────────────────────
// API handler
// ────────────────────────────────────────────

const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in a minute.' }, { status: 429 });
  }

  if (activeCrawls >= MAX_CONCURRENT_CRAWLS) {
    return NextResponse.json({ error: 'Server is busy. Please try again in a moment.' }, { status: 503 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { url, depth, maxPages } = body;

  if (!url || typeof url !== 'string' || url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: 'A valid URL is required.' }, { status: 400 });
  }
  if (!isAllowedURL(url)) {
    return NextResponse.json({ error: 'This URL cannot be crawled.' }, { status: 400 });
  }

  activeCrawls++;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed (client disconnected)
        }
      };

      try {
        const crawler = new DocCrawler({
          maxDepth: Math.min(Math.max(parseInt(depth) || 1, 1), CONFIG.limits.maxDepth),
          maxPages: Math.min(Math.max(parseInt(maxPages) || 50, 1), CONFIG.limits.maxPages),
          onProgress: (info) => send('progress', info),
        });

        const result = await crawler.crawl(url);

        if (result.results.length === 0) {
          send('error', { error: 'No content could be extracted. The site may require authentication or block automated access.' });
        } else {
          let fullMarkdown = result.results.map((p) => p.markdown).join('\n\n---\n\n');
          if (fullMarkdown.length > MAX_RESPONSE_SIZE) {
            fullMarkdown = fullMarkdown.slice(0, MAX_RESPONSE_SIZE) + '\n\n---\n\n> Output truncated at 5MB.';
          }

          send('complete', {
            markdown: fullMarkdown,
            pageCount: result.results.length,
            source: url,
            method: result.results[0]?.method || 'http',
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        console.error('[Crawl Error]', message);
        send('error', { error: message });
      } finally {
        activeCrawls--;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
