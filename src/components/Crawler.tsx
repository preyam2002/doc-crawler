'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowRight, Download, Copy, Check, Loader2, Command, FileText } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

interface CrawlerProps {
  initialUrl?: string;
  autoStart?: boolean;
}

export default function Crawler({ initialUrl = '', autoStart = false }: CrawlerProps) {
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [data, setData] = useState<{ markdown: string; pageCount: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl);
    }
  }, [initialUrl]);

  useEffect(() => {
    if (autoStart && initialUrl && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      handleCrawl();
    }
  }, [autoStart, initialUrl]);

  useEffect(() => {
    if (status === 'loading') {
      const interval = setInterval(() => {
        setProgress(prev => (prev < 90 ? prev + Math.random() * 5 : prev));
      }, 800);
      return () => clearInterval(interval);
    } else if (status === 'success') {
      setProgress(100);
    } else {
      setProgress(0);
    }
  }, [status]);

  const handleCrawl = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim() || status === 'loading') return;

    setStatus('loading');
    setData(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'Failed to crawl');
      }

      setData(json);
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  const handleCopy = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${new URL(url).hostname.replace(/\./g, '-')}-context.md`;
    a.click();
  };

  const handleReset = () => {
    setStatus('idle');
    setUrl('');
    setData(null);
    hasAutoStarted.current = false;
    window.history.pushState({}, '', '/');
  };

  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen w-full overflow-hidden bg-[#050505] selection:bg-white/20 font-sans text-[#EDEDED]">
      
      {/* Subtle Gradient Atmosphere */}
      <div className="absolute inset-0 w-full h-full pointer-events-none">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[80vw] h-[60vh] bg-gradient-to-b from-white/[0.03] to-transparent blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-2xl px-6 flex flex-col items-center">
        
        {/* Header - Extremely Minimal */}
        <div className={cn(
          "transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col items-center mb-16",
          status === 'idle' ? "translate-y-0 opacity-100" : "translate-y-[-10px] opacity-0 pointer-events-none absolute"
        )}>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight text-center mb-6 text-white">
            Context
          </h1>
          <p className="text-base md:text-lg text-white/40 text-center max-w-md leading-relaxed font-light">
            Turn documentation into a single markdown file.
          </p>
        </div>

        {/* Interaction Zone */}
        <div className="w-full relative">
          
          {/* Main Input Form */}
          <div className={cn(
            "relative transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]",
            status === 'success' ? "opacity-0 pointer-events-none scale-95 absolute inset-0" : "opacity-100 scale-100"
          )}>
            <form onSubmit={handleCrawl} className="relative w-full group">
              <div className={cn(
                "relative flex items-center bg-[#0A0A0A] border border-white/10 rounded-xl p-1.5 transition-all duration-300",
                "focus-within:border-white/20 focus-within:shadow-[0_0_30px_-5px_rgba(255,255,255,0.05)]",
                status === 'loading' && "opacity-80"
              )}>
                <div className="pl-4 pr-3 text-white/20">
                  {status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Command className="w-5 h-5" />}
                </div>
                <input
                  type="url"
                  placeholder="https://docs.example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={status === 'loading'}
                  className="flex-1 bg-transparent border-none outline-none text-white placeholder-white/20 h-12 text-base font-medium w-full tracking-tight"
                  autoFocus
                />
                <button 
                  type="submit"
                  disabled={status === 'loading' || !url}
                  className={cn(
                    "h-10 px-6 rounded-lg font-medium text-sm transition-all duration-200",
                    !url ? "opacity-0 pointer-events-none" : "opacity-100",
                    "bg-white text-black hover:bg-gray-200"
                  )}
                >
                  Enter
                </button>
              </div>
            </form>

            {/* Status / Error */}
            <div className="absolute top-full left-0 w-full mt-6 text-center">
              {status === 'loading' && (
                <div className="flex flex-col items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-500">
                  <div className="text-xs font-mono text-white/30 tracking-widest uppercase">Processing</div>
                  <div className="h-0.5 w-24 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-white transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}
              
              {status === 'error' && (
                <div className="text-sm text-red-400/80 bg-red-500/5 border border-red-500/10 px-4 py-2 rounded-lg inline-block animate-in fade-in slide-in-from-top-2">
                  {errorMsg}
                </div>
              )}
            </div>
          </div>

          {/* Success State */}
          <div className={cn(
            "w-full transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] absolute top-0 left-0",
            status === 'success' ? "opacity-100 translate-y-0 relative" : "opacity-0 translate-y-12 pointer-events-none absolute"
          )}>
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-6 text-white border border-white/10">
                <FileText className="w-5 h-5" />
              </div>
              
              <h2 className="text-2xl font-medium text-white mb-2">Ready</h2>
              <p className="text-white/40 text-sm mb-8">
                Merged {data?.pageCount} pages from <span className="text-white/60">{new URL(url || 'https://example.com').hostname}</span>
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm">
                <button 
                  onClick={handleDownload}
                  className="w-full h-12 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
                <button 
                  onClick={handleCopy}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/10 text-white font-medium rounded-lg hover:bg-white/5 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <button 
                onClick={handleReset}
                className="mt-8 text-xs text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest"
              >
                Reset
              </button>
            </div>
          </div>

        </div>
      </div>
      
      {/* Subtle Footer Info */}
      <div className="absolute bottom-8 text-[10px] text-white/10 font-mono tracking-widest uppercase">
        Max Depth: 2 • Limit: 50 Pages
      </div>
    </main>
  );
}
