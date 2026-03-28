# Context — Documentation Crawler

Transform any documentation website into a single, clean Markdown file. Supports Docusaurus, VitePress, Nextra, MkDocs, GitBook, ReadTheDocs, Sphinx, and more.

## Features

- **Multi-strategy fetching** — cascading approach: direct Markdown → Jina Reader API → HTTP + Cheerio → Puppeteer browser rendering
- **Real-time progress** — Server-Sent Events stream crawl status as pages are discovered and processed
- **Smart extraction** — 55+ content selectors tuned for popular documentation platforms, strips nav/sidebar/footer automatically
- **Configurable depth** — control crawl depth (1-2 levels) and max pages (1-50)
- **Copy & download** — one-click copy to clipboard or download as `.md` file
- **URL sharing** — paste any URL as a path (`/https://docs.example.com`) for instant crawling
- **Rate limiting** — IP-based throttling (20 req/min, max 3 concurrent crawls)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19, TypeScript |
| Scraping | Puppeteer, Cheerio, Turndown |
| Styling | Tailwind CSS v4, Motion |
| External | Jina Reader API (fallback) |

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), paste a documentation URL, and hit Enter.

## API

### POST /api/crawl

**Request:**
```json
{
  "url": "https://docs.example.com",
  "depth": 2,
  "maxPages": 25
}
```

**Response:** SSE stream with `progress`, `complete`, and `error` events.

## Architecture

```
src/
├── app/
│   ├── api/crawl/route.ts    # DocCrawler class + SSE endpoint
│   ├── [...url]/page.tsx     # URL sharing catch-all route
│   ├── page.tsx              # Landing page
│   └── globals.css           # Dark theme + animations
├── components/
│   └── Crawler.tsx           # Main UI (form, progress, preview)
└── lib/
    └── utils.ts              # Class name utilities
```

**Fetching cascade:**
1. `tryDirectMd()` — attempt raw `.md` file fetch (5s timeout)
2. `tryJinaReader()` — Jina AI reader API for clean extraction (15s timeout)
3. `tryHttpFetch()` — plain HTTP + Cheerio HTML parsing (8s timeout)
4. `tryPuppeteer()` — full browser rendering for JS-heavy sites (30s timeout)

## License

MIT

Built by [Preyam](https://github.com/preyam2002)
