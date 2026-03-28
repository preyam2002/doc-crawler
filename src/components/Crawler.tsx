'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { addToHistory, getHistory, type CrawlHistoryEntry } from '@/lib/history';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface CrawlData {
  markdown: string;
  pageCount: number;
  source: string;
  method?: string;
}

interface CrawlProgress {
  currentUrl: string;
  pagesCrawled: number;
  pagesFound: number;
}

interface CrawlerProps {
  initialUrl?: string;
  autoStart?: boolean;
  defaultShowMarkdown?: boolean;
}

const formatDuration = (ms: number | null) => {
  if (ms == null) return '';
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const truncateUrl = (url: string) => {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 27) + '…' : u.pathname;
    return `${u.hostname}${path}`;
  } catch {
    return url.length > 50 ? url.slice(0, 47) + '…' : url;
  }
};

const METHOD_LABEL: Record<string, string> = {
  'direct-md': 'Direct',
  jina: 'Reader',
  http: 'HTTP',
  puppeteer: 'Browser',
};

const ease = [0.16, 1, 0.3, 1] as const;

export default function Crawler({
  initialUrl = '',
  autoStart = false,
  defaultShowMarkdown = false,
}: CrawlerProps) {
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<CrawlData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(defaultShowMarkdown);
  const [progress, setProgress] = useState(0);
  const [depth, setDepth] = useState(1);
  const [maxPages, setMaxPages] = useState(50);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [crawlInfo, setCrawlInfo] = useState<CrawlProgress | null>(null);

  const autoStarted = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { if (initialUrl) setUrl(initialUrl); }, [initialUrl]);
  useEffect(() => { setShowMarkdown(defaultShowMarkdown); }, [defaultShowMarkdown]);

  useEffect(() => {
    if (status !== 'loading') {
      setProgress(status === 'success' ? 100 : 0);
      return;
    }
    const t = setInterval(() => {
      setProgress((p) => (p < 88 ? p + 0.3 : p));
    }, 2000);
    return () => clearInterval(t);
  }, [status]);

  const hostname = useMemo(() => {
    const c = data?.source || url;
    if (!c) return '';
    try { return new URL(c).hostname; } catch { return ''; }
  }, [data?.source, url]);

  const handleCrawl = useCallback(
    async (e?: FormEvent, overrideUrl?: string) => {
      e?.preventDefault();
      const target = (overrideUrl ?? url).trim();
      if (!target || status === 'loading') return;

      setUrl(target);
      setStatus('loading');
      setData(null);
      setErrorMsg('');
      setCopied(false);
      setElapsedMs(null);
      setCrawlInfo(null);
      setProgress(3);

      abortRef.current = new AbortController();
      const t0 = Date.now();
      try {
        const res = await fetch('/api/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, depth, maxPages }),
          signal: abortRef.current.signal,
        });

        const ct = res.headers.get('content-type') || '';

        if (ct.includes('application/json')) {
          const json = await res.json() as Record<string, unknown>;
          throw new Error(
            typeof json?.error === 'string' ? (json.error as string) : 'Failed to crawl this site.',
          );
        }

        if (!res.body) throw new Error('No response stream');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let completed = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;

            let eventType = '';
            let eventData = '';
            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) eventType = line.slice(7);
              else if (line.startsWith('data: ')) eventData += line.slice(6);
            }

            if (!eventType || !eventData) continue;

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(eventData);
            } catch {
              continue;
            }

            if (eventType === 'progress') {
              setCrawlInfo({
                currentUrl: (parsed.url as string) || '',
                pagesCrawled: (parsed.pagesCrawled as number) ?? 0,
                pagesFound: (parsed.pagesFound as number) ?? 0,
              });
              const crawled = (parsed.pagesCrawled as number) ?? 0;
              const found = (parsed.pagesFound as number) ?? 0;
              if (found > 0 && crawled > 0) {
                const cap = Math.min(found, maxPages);
                const pct = 3 + (crawled / cap) * 87;
                setProgress((prev) => Math.max(prev, Math.min(pct, 90)));
              }
            } else if (eventType === 'complete') {
              completed = true;
              setProgress(100);
              const crawlData = parsed as unknown as CrawlData;
              setData(crawlData);
              setStatus('success');
              // Save to history
              try {
                const hostname = new URL(url).hostname;
                addToHistory({
                  url,
                  hostname,
                  pageCount: crawlData.pageCount,
                  sizeBytes: new Blob([crawlData.markdown]).size,
                  method: crawlData.method || crawlData.source || 'unknown',
                  durationMs: Date.now() - t0,
                  crawledAt: new Date().toISOString(),
                });
              } catch {}
            } else if (eventType === 'error') {
              throw new Error((parsed.error as string) || 'Crawl failed');
            }
          }
        }

        if (!completed) {
          throw new Error('Connection lost during crawl.');
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setStatus('idle');
          setProgress(0);
          setCrawlInfo(null);
          return;
        }
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        abortRef.current = null;
        setElapsedMs(Date.now() - t0);
      }
    },
    [depth, maxPages, status, url],
  );

  useEffect(() => {
    if (autoStart && initialUrl && !autoStarted.current) {
      autoStarted.current = true;
      void handleCrawl(undefined, initialUrl);
    }
  }, [autoStart, handleCrawl, initialUrl]);

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };

  const handleDownload = () => {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = `${(hostname || 'docs').replace(/\./g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(href);
  };

  const handleReset = () => {
    setStatus('idle');
    setUrl('');
    setData(null);
    setErrorMsg('');
    setCopied(false);
    setShowMarkdown(defaultShowMarkdown);
    setElapsedMs(null);
    setCrawlInfo(null);
    autoStarted.current = false;
    window.history.pushState({}, '', '/');
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const isIdle = status === 'idle';

  return (
    <main
      className={cn(
        'min-h-svh bg-background flex flex-col items-center px-6',
        isIdle ? 'justify-center' : 'pt-20',
      )}
    >
      {/* Atmospheric radial glow */}
      <div
        className={cn(
          'pointer-events-none fixed inset-0 transition-opacity duration-[2s]',
          isIdle ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_42%,rgba(255,255,255,0.025),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_600px_at_50%_8%,rgba(255,255,255,0.035),transparent)]" />
      </div>

      <div className={cn('w-full transition-[max-width] duration-500 ease-out', isIdle ? 'max-w-xl' : 'max-w-2xl')}>

        {/* ── Title ── */}
        <div className={cn(isIdle ? 'text-center mb-14' : 'mb-8')}>
          <motion.h1
            className={cn(
              isIdle
                ? 'font-[var(--font-display)] italic leading-[0.88] tracking-[-0.03em] bg-gradient-to-b from-foreground via-foreground/75 to-foreground/20 bg-clip-text text-transparent'
                : 'font-medium cursor-pointer text-foreground/30 hover:text-foreground/50 transition-colors tracking-normal leading-none',
            )}
            onClick={!isIdle ? handleReset : undefined}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0, fontSize: isIdle ? 'min(6.5rem, 16vw)' : '0.8125rem' }}
            transition={{ duration: 0.8, ease }}
          >
            Context
          </motion.h1>

          <AnimatePresence>
            {isIdle && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, height: 0, marginTop: 0 }}
                transition={{ duration: 0.5, ease, delay: 0.15 }}
                className="mt-7 text-[17px] text-muted-foreground/40 font-light tracking-wide"
              >
                Turn any docs site into one clean Markdown file.
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* ── Search ── */}
        <motion.form
          onSubmit={(e) => void handleCrawl(e)}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease, delay: 0.25 }}
        >
          <div
            className={cn(
              'flex items-center border transition-all duration-300',
              isIdle
                ? 'h-[4.5rem] rounded-2xl px-7 gap-5 bg-white/[0.02] border-border/40 focus-within:border-border/70 focus-within:bg-white/[0.035] focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_0_60px_-12px_rgba(255,255,255,0.06)]'
                : 'h-12 rounded-xl px-5 gap-3 border-border/50 focus-within:border-ring',
            )}
          >
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a documentation URL…"
              className={cn(
                'flex-1 min-w-0 bg-transparent text-foreground placeholder:text-muted-foreground/25 outline-none',
                isIdle ? 'text-[15px]' : 'text-sm',
              )}
              disabled={status === 'loading'}
              autoFocus
            />
            {isIdle && <div className="h-7 w-px bg-border/30 shrink-0" />}
            <button
              type="submit"
              disabled={!url.trim() || status === 'loading'}
              aria-label="Start crawl"
              className={cn(
                'shrink-0 flex items-center justify-center transition-all duration-200',
                'disabled:opacity-15 disabled:pointer-events-none cursor-pointer',
                isIdle
                  ? 'h-12 w-12 rounded-xl bg-foreground text-background hover:bg-foreground/80 hover:scale-105 active:scale-95'
                  : 'h-7 w-7 rounded-lg bg-foreground/[0.08] text-foreground/50 hover:bg-foreground/[0.12] hover:text-foreground',
              )}
            >
              {status === 'loading' ? (
                <Loader2 className={cn('animate-spin', isIdle ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5')} />
              ) : (
                <ArrowRight className={isIdle ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'} />
              )}
            </button>
          </div>

          {/* Options — always visible in idle */}
          <AnimatePresence>
            {isIdle && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease }}
              >
                <div className="mt-8 flex gap-4">
                  <div className="flex-1 px-6 py-5 rounded-xl border border-border/20 bg-white/[0.012] hover:border-border/35 transition-colors duration-300">
                    <label className="block text-[10px] font-medium text-muted-foreground/40 uppercase tracking-[0.2em] mb-4">
                      Depth
                    </label>
                    <div className="flex gap-2">
                      {[1, 2].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDepth(d)}
                          className={cn(
                            'h-9 px-4 text-xs font-medium rounded-lg transition-all duration-200 cursor-pointer',
                            depth === d
                              ? 'bg-foreground text-background'
                              : 'bg-foreground/[0.04] text-muted-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/80',
                          )}
                        >
                          Level {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 px-6 py-5 rounded-xl border border-border/20 bg-white/[0.012] hover:border-border/35 transition-colors duration-300">
                    <label className="block text-[10px] font-medium text-muted-foreground/40 uppercase tracking-[0.2em] mb-4">
                      Max pages
                      <span className="text-foreground/40 ml-2 normal-case tracking-normal font-[var(--font-mono)] text-[11px]">
                        {maxPages}
                      </span>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={maxPages}
                      onChange={(e) => setMaxPages(Number(e.target.value))}
                      className="w-full mt-1 cursor-pointer"
                    />
                  </div>
                </div>
                <p className="mt-6 text-center text-[11px] text-muted-foreground/15">
                  Press <kbd className="mx-0.5 px-1.5 py-0.5 rounded border border-border/20 text-[10px] font-[var(--font-mono)]">⏎</kbd> to crawl
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.form>

        {/* ── Recent Crawls ── */}
        <AnimatePresence>
          {isIdle && (() => {
            const history = getHistory();
            if (history.length === 0) return null;
            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, delay: 0.4 }}
                className="mt-10"
              >
                <p className="text-[10px] font-medium text-muted-foreground/25 uppercase tracking-[0.2em] mb-3">
                  Recent
                </p>
                <div className="space-y-1.5">
                  {history.slice(0, 5).map((entry) => (
                    <button
                      key={entry.url}
                      type="button"
                      onClick={() => {
                        setUrl(entry.url);
                        void handleCrawl(undefined, entry.url);
                      }}
                      className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-border/15 bg-white/[0.008] hover:border-border/30 hover:bg-white/[0.02] transition-all duration-200 group text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors flex-shrink-0" />
                        <span className="text-xs text-muted-foreground/50 group-hover:text-foreground/60 transition-colors truncate">
                          {entry.hostname}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/20 flex-shrink-0 ml-3">
                        <span>{entry.pageCount}p</span>
                        <span>{formatSize(entry.sizeBytes)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* ── Progress ── */}
        <AnimatePresence>
          {status === 'loading' && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
              className="mt-10 px-7 py-6 rounded-xl border border-border/20 bg-white/[0.012]"
              style={{ animation: 'glow-pulse 2.5s ease-in-out infinite' }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex gap-[3px] items-center shrink-0">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="block w-1 h-1 rounded-full bg-muted-foreground/60"
                        style={{
                          animation: 'dot-pulse 1.2s ease-in-out infinite',
                          animationDelay: `${i * 0.15}s`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-[13px] text-muted-foreground/50 truncate font-[var(--font-mono)]">
                    {crawlInfo?.currentUrl
                      ? truncateUrl(crawlInfo.currentUrl)
                      : 'Starting…'}
                  </span>
                </div>
                <div className="flex items-center gap-4 shrink-0 ml-4">
                  {crawlInfo && crawlInfo.pagesCrawled > 0 && (
                    <span className="text-[13px] text-muted-foreground/30 tabular-nums font-[var(--font-mono)]">
                      {crawlInfo.pagesCrawled}
                      {crawlInfo.pagesFound > crawlInfo.pagesCrawled
                        ? ` / ${Math.min(crawlInfo.pagesFound, maxPages)}`
                        : ''}{' '}
                      pages
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="text-[13px] text-muted-foreground/25 hover:text-muted-foreground transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <div className="h-[3px] w-full rounded-full bg-foreground/[0.04] overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-foreground/20 relative overflow-hidden"
                  initial={{ width: '0%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                >
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                    style={{ animation: 'shimmer 1.8s ease-in-out infinite' }}
                  />
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Error ── */}
        <AnimatePresence>
          {status === 'error' && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease }}
              className="mt-10 rounded-xl border border-destructive/15 bg-destructive/[0.04] px-7 py-6 flex items-start justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="h-4 w-4 text-destructive/40 shrink-0 mt-0.5" />
                <p className="text-sm text-destructive/70 leading-relaxed">{errorMsg}</p>
              </div>
              <button
                onClick={() => { setStatus('idle'); setErrorMsg(''); }}
                className="text-xs text-destructive/25 hover:text-destructive/50 transition-colors shrink-0 mt-0.5 cursor-pointer"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Results ── */}
        <AnimatePresence>
          {status === 'success' && data && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease, delay: 0.05 }}
              className="mt-10 pb-24"
            >
              <div className="rounded-xl border border-border/25 bg-card/40 overflow-hidden">
                {/* Header */}
                <div className="px-7 py-6 flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground/30" />
                    <span className="text-sm font-medium text-foreground/70">{hostname}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground/35 font-[var(--font-mono)]">
                    {data.method && (
                      <span className="text-[10px] font-medium uppercase tracking-widest px-2.5 py-1 rounded-md bg-foreground/[0.03] border border-border/15">
                        {METHOD_LABEL[data.method] || data.method}
                      </span>
                    )}
                    <span>{data.pageCount} {data.pageCount === 1 ? 'page' : 'pages'}</span>
                    <span className="text-border/20 select-none">·</span>
                    <span>{formatSize(data.markdown.length)}</span>
                    {elapsedMs != null && (
                      <>
                        <span className="text-border/20 select-none">·</span>
                        <span>{formatDuration(elapsedMs)}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="px-7 py-5 flex items-center gap-3 border-t border-border/15">
                  <button
                    onClick={() => void handleCopy()}
                    className="inline-flex items-center gap-2.5 h-11 px-6 rounded-xl text-sm font-medium border border-border/25 text-foreground/50 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="inline-flex items-center gap-2.5 h-11 px-6 rounded-xl text-sm font-medium bg-foreground text-background hover:bg-foreground/80 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download .md
                  </button>
                  <button
                    onClick={handleReset}
                    className="ml-auto inline-flex items-center gap-2 h-9 px-4 rounded-lg text-xs text-muted-foreground/25 hover:text-muted-foreground hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" />
                    New
                  </button>
                </div>

                {/* Preview toggle */}
                <button
                  onClick={() => setShowMarkdown(!showMarkdown)}
                  className="w-full px-7 py-5 flex items-center justify-between text-muted-foreground/25 hover:text-muted-foreground/50 hover:bg-foreground/[0.015] border-t border-border/15 transition-colors cursor-pointer"
                >
                  <span className="text-[10px] font-medium uppercase tracking-[0.2em]">Preview</span>
                  <motion.div
                    animate={{ rotate: showMarkdown ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </motion.div>
                </button>

                {/* Preview content */}
                <AnimatePresence>
                  {showMarkdown && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease }}
                      className="overflow-hidden"
                    >
                      <div className="max-h-[480px] overflow-auto border-t border-border/15">
                        <pre className="p-7 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/40 font-[var(--font-mono)]">
                          {data.markdown.length > 50_000
                            ? data.markdown.slice(0, 50_000) + '\n\n… truncated — download for full content'
                            : data.markdown}
                        </pre>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
