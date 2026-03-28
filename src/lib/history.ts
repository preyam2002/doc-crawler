const HISTORY_KEY = "context-crawl-history";
const MAX_HISTORY = 20;

export interface CrawlHistoryEntry {
  url: string;
  hostname: string;
  pageCount: number;
  sizeBytes: number;
  method: string;
  durationMs: number;
  crawledAt: string;
}

export function getHistory(): CrawlHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addToHistory(entry: CrawlHistoryEntry) {
  const history = getHistory();
  // Remove duplicate URLs
  const filtered = history.filter((h) => h.url !== entry.url);
  filtered.unshift(entry);
  // Keep only MAX_HISTORY entries
  const trimmed = filtered.slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
