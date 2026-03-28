# Doc-Crawler-Web ("Context")

## Overview
Web app that converts documentation websites into a single clean Markdown file. Two-stage fetching: fast HTTP first, Puppeteer fallback for JS-heavy sites.

## Commands
```bash
npm run dev       # Development server
npm run build     # Production build
npm run start     # Start production
npm run lint      # ESLint
```

## Tech Stack
- **Framework**: Next.js 16.1.6, React 19, TypeScript
- **Scraping**: Puppeteer, Cheerio, Turndown (HTML→Markdown)
- **Styling**: Tailwind CSS 4
- **Animation**: Motion (Framer Motion)
- **Icons**: Lucide React

## Architecture
- Frontend: Single-page React component (`Crawler.tsx`) with form + progress + preview
- Backend: `POST /api/crawl` — accepts `{ url, depth, maxPages }`
- `DocCrawler` class manages crawl lifecycle
- Rate limiting: 20 req/60s per IP, max 3 concurrent crawls
- Supports: Docusaurus, VitePress, Nextra, MkDocs, GitBook, ReadTheDocs, Sphinx

## Key Files
- `src/app/api/crawl/route.ts` — API endpoint
- `src/components/Crawler.tsx` — Main UI component
- `src/app/page.tsx` — Landing page

## No Database
Pure in-memory, no external APIs.
