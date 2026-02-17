'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Copy, Download, Loader2 } from 'lucide-react';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface CrawlerProps {
  initialUrl?: string;
  autoStart?: boolean;
  defaultShowMarkdown?: boolean;
}

function formatSeconds(ms: number | null) {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export default function Crawler({ initialUrl = '', autoStart = false, defaultShowMarkdown = false }: CrawlerProps) {
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<{ markdown: string; pageCount: number; source: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(defaultShowMarkdown);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [progress, setProgress] = useState(0);
  const [depth, setDepth] = useState(1);
  const [maxPages, setMaxPages] = useState(50);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const autoStarted = useRef(false);

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  useEffect(() => {
    setShowMarkdown(defaultShowMarkdown);
  }, [defaultShowMarkdown]);

  useEffect(() => {
    if (status !== 'loading') {
      setProgress(status === 'success' ? 100 : 0);
      return;
    }

    const t = setInterval(() => {
      setProgress((p) => (p < 92 ? p + 3 + Math.random() * 4 : p));
    }, 650);

    return () => clearInterval(t);
  }, [status]);

  const hostname = useMemo(() => {
    const candidate = data?.source || url;
    if (!candidate) return '';
    try {
      return new URL(candidate).hostname;
    } catch {
      return '';
    }
  }, [data?.source, url]);

  const handleCrawl = useCallback(
    async (e?: FormEvent, overrideUrl?: string) => {
      e?.preventDefault();
      const targetUrl = (overrideUrl ?? url).trim();
      if (!targetUrl || status === 'loading') return;

      setUrl(targetUrl);
      setStatus('loading');
      setData(null);
      setErrorMsg('');
      setCopied(false);
      setElapsedMs(null);

      const startedAt = Date.now();
      try {
        const res = await fetch('/api/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: targetUrl, depth, maxPages }),
        });
        const json: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof (json as { error?: unknown } | null)?.error === 'string'
              ? (json as { error: string }).error
              : 'Failed to crawl';
          throw new Error(message);
        }

        setData(json as { markdown: string; pageCount: number; source: string });
        setStatus('success');
      } catch (err: unknown) {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setElapsedMs(Date.now() - startedAt);
      }
    },
    [depth, maxPages, status, url]
  );

  useEffect(() => {
    if (autoStart && initialUrl && !autoStarted.current) {
      autoStarted.current = true;
      void handleCrawl(undefined, initialUrl);
    }
  }, [autoStart, handleCrawl, initialUrl]);

  async function handleCopy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function handleDownload() {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = `${(hostname || 'docs').replace(/\./g, '-')}-context.md`;
    a.click();
    URL.revokeObjectURL(href);
  }

  function handleReset() {
    setStatus('idle');
    setUrl('');
    setData(null);
    setErrorMsg('');
    setCopied(false);
    setShowMarkdown(defaultShowMarkdown);
    setElapsedMs(null);
    autoStarted.current = false;
    window.history.pushState({}, '', '/');
  }

  const examples = [
    'tailwindcss.com/docs',
    'docs.wal.app/docs',
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-[1219px] px-6 py-16 md:px-10 md:py-24">
        
        <header className="mb-16 text-center">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-white/40">Docs to Markdown</p>
          <h1 className="mt-6 text-5xl font-medium tracking-tight text-white">Context</h1>
          <p className="mx-auto mt-6 max-w-md text-base leading-7 text-white/50">
            Turn any docs site into one clean Markdown file.
          </p>
        </header>

        <form onSubmit={(e) => void handleCrawl(e)} className="mb-10">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.example.com"
              className="flex-1 rounded-md bg-white/5 px-4 py-3 text-sm text-white placeholder-white/25 outline-none ring-1 ring-white/10 focus:ring-white/20"
              disabled={status === 'loading'}
              autoFocus
            />
            <button
              type="submit"
              disabled={!url.trim() || status === 'loading'}
              className="shrink-0 rounded-md bg-white px-6 py-3 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40"
            >
              {status === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  Generate <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setUrl(`https://${ex}`)}
                disabled={status === 'loading'}
                className="text-sm text-white/35 hover:text-white/70"
              >
                {ex}
              </button>
            ))}
            <span className="text-white/20">|</span>
            <button
              type="button"
              onClick={() => setOptionsOpen(!optionsOpen)}
              className="text-sm text-white/35 hover:text-white/70"
            >
              {optionsOpen ? 'Hide options' : 'Options'}
            </button>
          </div>

          {optionsOpen && (
            <div className="mt-4 grid grid-cols-2 gap-4 rounded-md bg-white/5 p-4">
              <div>
                <label className="mb-3 block font-mono text-xs font-medium uppercase tracking-wider text-white/40">Depth</label>
                <div className="flex gap-2">
                  {[1, 2].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDepth(d)}
                      disabled={status === 'loading'}
                      className={`flex-1 rounded py-2 text-sm font-medium ${
                        depth === d ? 'bg-white text-black' : 'bg-white/5 text-white/60'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-3 block font-mono text-xs font-medium uppercase tracking-wider text-white/40">
                  Max Pages: {maxPages}
                </label>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={maxPages}
                  onChange={(e) => setMaxPages(Number(e.target.value))}
                  disabled={status === 'loading'}
                  className="mt-1 w-full accent-white"
                />
              </div>
            </div>
          )}

          {status === 'loading' && (
            <div className="mt-6">
              <div className="h-0.5 w-full rounded-full bg-white/10">
                <div className="h-full rounded-full bg-white/60" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-3 text-center font-mono text-xs font-medium uppercase tracking-widest text-white/40">
                {progress < 25 ? 'Booting browser...' : progress < 60 ? 'Discovering...' : progress < 92 ? 'Rendering...' : 'Merging...'}
              </p>
            </div>
          )}
        </form>

        {status === 'error' && (
          <div className="mb-10 rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-400">{errorMsg}</div>
        )}

        {status === 'success' && data && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col gap-4 rounded-md bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/60">
                <span className="font-mono">context.md</span>
                <span className="text-white/20">·</span>
                <span>{data.pageCount} pages</span>
                <span className="text-white/20">·</span>
                <span>{Math.round(data.markdown.length / 1024)}KB</span>
                <span className="text-white/20">·</span>
                <span>{formatSeconds(elapsedMs)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="rounded px-3 py-1.5 text-sm text-white/50 hover:bg-white/5"
                >
                  New
                </button>
                <button
                  onClick={() => void handleCopy()}
                  className="flex items-center gap-2 rounded bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 rounded bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-white/90"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              </div>
            </div>

            <div className="mt-4">
              <button
                onClick={() => setShowMarkdown(!showMarkdown)}
                className="flex w-full items-center justify-between rounded-md bg-white/5 px-4 py-3 text-sm text-white/50 hover:bg-white/10"
              >
                <span className="font-mono text-xs font-medium uppercase tracking-wider">Markdown</span>
                <span>{showMarkdown ? 'Hide' : 'Show'}</span>
              </button>
              {showMarkdown && (
                <div className="mt-2 max-h-96 overflow-auto rounded-md bg-white/5 p-4">
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/70">
                    {data.markdown}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        <footer className="mt-20 border-t border-white/10 pt-10">
          <div className="grid grid-cols-1 gap-8 text-center sm:grid-cols-3">
            <div>
              <p className="font-mono text-xs font-medium uppercase tracking-wider text-white/30">Pipeline</p>
              <p className="mt-2 text-sm text-white/50">Markdown or browser render</p>
            </div>
            <div>
              <p className="font-mono text-xs font-medium uppercase tracking-wider text-white/30">Output</p>
              <p className="mt-2 text-sm text-white/50">Single merged .md</p>
            </div>
            <div>
              <p className="font-mono text-xs font-medium uppercase tracking-wider text-white/30">Limits</p>
              <p className="mt-2 text-sm text-white/50">Depth 1-2, max 50 pages</p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
