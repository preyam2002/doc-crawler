import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import puppeteer, { type Browser, type HTTPRequest } from 'puppeteer';

export const dynamic = 'force-dynamic';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  limits: {
    maxDepth: 2,
    maxPages: 50,
    maxConcurrency: 3, // Reduced for Puppeteer
    maxPageSize: 5 * 1024 * 1024,
    fetchTimeout: 30000,
    maxRedirects: 5,
  },
  security: {
    allowedProtocols: ['http:', 'https:'],
  },
  docsPatterns: ['/docs/', '/documentation/', '/guide/', '/manual/', '/api/', '/reference/'],
};

// In-memory rate limiting
const rateLimitStore = new Map<string, { windowStart: number; count: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS = 20;

function getClientIP(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let record = rateLimitStore.get(ip);
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    record = { windowStart: now, count: 0 };
    rateLimitStore.set(ip, record);
  }
  record.count++;
  return record.count > MAX_REQUESTS;
}

function isAllowedURL(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!CONFIG.security.allowedProtocols.includes(url.protocol)) return false;
    
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.')) return false;
    if (hostname === '169.254.169.254') return false;
    
    return true;
  } catch {
    return false;
  }
}

class DocCrawler {
  private maxDepth: number;
  private maxPages: number;
  private visited = new Set<string>();
  private queue: { url: string; depth: number }[] = [];
  private results: CrawlResult[] = [];
  private errors: CrawlError[] = [];
  private turndownService = new TurndownService({ 
    headingStyle: 'atx', 
    codeBlockStyle: 'fenced' 
  });
  private browser: Browser | null = null;

  constructor(options: { maxDepth: number; maxPages: number }) {
    this.maxDepth = options.maxDepth;
    this.maxPages = options.maxPages;
    this.turndownService.remove('script');
    this.turndownService.remove('style');
    this.turndownService.remove('nav');
    this.turndownService.remove('footer');
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private normalizeUrl(url: string, baseUrl?: string): string | null {
    try {
      const fullUrl = new URL(url, baseUrl);
      fullUrl.hash = '';
      return fullUrl.toString().replace(/\/$/, ""); 
    } catch {
      return null;
    }
  }

  private sanitizeFilename(url: string): string {
    try {
      const pathname = new URL(url).pathname.replace(/^\//, '').replace(/\/$/, '') || 'index';
      return pathname.replace(/\//g, '-').replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 100) + '.md';
    } catch {
      return `page_${Date.now()}.md`;
    }
  }

  private async fetchPage(url: string): Promise<{ type: 'markdown' | 'html', content: string } | null> {
    if (!isAllowedURL(url)) return null;

    // 1. Try standard fast fetch first
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); 
      
      const response = await fetch(url, {
        headers: { 
          'User-Agent': 'DocCrawler/1.0 (Compatible; GPT-4; Claude)',
          'Accept': 'text/markdown, text/html' 
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const text = await response.text();
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('text/markdown') || (contentType.includes('text/plain') && text.startsWith('#'))) {
          return { type: 'markdown', content: text };
        }
        
        if (contentType.includes('text/html') && text.length > 5000) {
           if (!text.includes('Page Not Found') && !text.includes('404')) {
             return { type: 'html', content: text };
           }
        }
      }
    } catch {
      // Fall through to browser
    }

    // 2. Fallback to Puppeteer
    console.log(`[Browser Fallback] Rendering ${url}`);
    
     try {
       await this.initBrowser();
       const browser = this.browser;
       if (!browser) return null;
       const page = await browser.newPage();
       
       await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
       await page.setRequestInterception(true);
       page.on('request', (req: HTTPRequest) => {
         if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
           req.abort();
         } else {
           req.continue();
         }
       });

       await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Wait for Docusaurus/SPA content
      try {
        await page.waitForSelector('main, article, .content, #__docusaurus', { timeout: 5000 });
       } catch {
         // Ignore timeout
       }

      const content = await page.content();
      await page.close();

      return { type: 'html', content };
     } catch (err) {
       console.error(`Browser fetch failed for ${url}:`, err);
       return null;
     }
   }

  private htmlToMarkdown(html: string, url: string): string {
    const $ = cheerio.load(html);
    const contentSelectors = [
      'article', 'main', '.markdown-body', '#docusaurus_skipToContent_fallback', 
      '.doc-content', '.content', '#main-content'
    ];

    let $content;
    for (const selector of contentSelectors) {
      const found = $(selector);
      if (found.length > 0) {
        $content = found.first();
        break;
      }
    }

    if (!$content) $content = $('body');

    $content.find('nav, footer, header, script, style, .sidebar, .menu, .on-this-page, .toc').remove();

    const markdown = this.turndownService.turndown($content.html() || '');
    const title = $('title').text().trim() || url;

    return `\n\n<!-- Source: ${url} -->\n# ${title}\n\n${markdown}`;
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links = new Set<string>();
    const baseDomain = new URL(baseUrl).hostname;

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const fullUrl = this.normalizeUrl(href, baseUrl);
      if (!fullUrl) return;

      const urlObj = new URL(fullUrl);
      if (urlObj.hostname !== baseDomain) return;

      const isDoc = CONFIG.docsPatterns.some(pattern => urlObj.pathname.includes(pattern));
      if (!isDoc && !fullUrl.startsWith(baseUrl)) return; 

      links.add(fullUrl);
    });

    return Array.from(links);
  }

  async crawl(startUrl: string) {
    const normalizedStart = this.normalizeUrl(startUrl);
    if (!normalizedStart) throw new Error('Invalid URL');

    this.queue = [{ url: normalizedStart, depth: 0 }];
    this.visited.add(normalizedStart);

    try {
      while (this.queue.length > 0 && this.results.length < this.maxPages) {
        const batch = this.queue.splice(0, CONFIG.limits.maxConcurrency);
        
        // Sequential for browser stability
         const items: { url: string; depth: number; data: { type: 'markdown' | 'html'; content: string } | null }[] = [];
         for (const { url, depth } of batch) {
            const data = await this.fetchPage(url);
            items.push({ url, depth, data });
         }

        for (const { url, depth, data } of items) {
          if (!data) continue;

           let markdown = '';
           if (data.type === 'markdown') {
             markdown = `\n\n<!-- Source: ${url} -->\n${data.content}`;
           } else {
             markdown = this.htmlToMarkdown(data.content, url);
            
            if (depth < this.maxDepth) {
              const foundLinks = this.extractLinks(data.content, url);
              for (const link of foundLinks) {
                if (!this.visited.has(link)) {
                  this.visited.add(link);
                  this.queue.push({ url: link, depth: depth + 1 });
                }
              }
            }
          }

           if (markdown.trim().length > 50) {
              this.results.push({
                url,
                depth,
                filename: this.sanitizeFilename(url),
                markdown,
                size: markdown.length,
              });
           }
         }
       }
     } finally {
       await this.closeBrowser();
     }

     return { results: this.results, errors: this.errors, stats: { pagesFound: this.visited.size, pagesCrawled: this.results.length, errors: this.errors.length } };
   }
}

type CrawlResult = {
  url: string;
  depth: number;
  filename: string;
  markdown: string;
  size: number;
};

type CrawlError = {
  url: string;
  error: string;
};

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const { url, depth, maxPages } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 });

    const crawler = new DocCrawler({
      maxDepth: Math.min(Math.max(parseInt(depth) || 1, 1), CONFIG.limits.maxDepth),
      maxPages: Math.min(Math.max(parseInt(maxPages) || 50, 1), CONFIG.limits.maxPages),
    });

     const pages = await crawler.crawl(url);
     const fullMarkdown = pages.results.map((p) => p.markdown).join('\n\n---\n\n');

    return NextResponse.json({ 
      markdown: fullMarkdown,
      results: pages.results,
      pageCount: pages.results.length,
      source: url
    });

   } catch (error: unknown) {
     const message = error instanceof Error ? error.message : 'Unknown error';
     return NextResponse.json({ error: message }, { status: 500 });
   }
}
