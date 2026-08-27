import type { PaletteCategory, PaletteRecentItem, MatchHighlight } from "./commandPaletteTypes";

const RECENT_STORAGE_KEY = "gamelib.command_palette_recent:v1";
const MAX_RECENTS = 12;

export const THEME_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  dark: { bg: "#08090c", text: "#f3f5fa", accent: "#635bff" },
  light: { bg: "#f8fafc", text: "#0f172a", accent: "#6d28d9" },
  nord: { bg: "#242933", text: "#eceff4", accent: "#88c0d0" },
  cyberpunk: { bg: "#050508", text: "#f8fafd", accent: "#00f0ff" },
  emerald: { bg: "#040a06", text: "#f0fdf4", accent: "#10b981" },
  dracula: { bg: "#181920", text: "#f8f8f2", accent: "#bd93f9" },
  solarized: { bg: "#001e26", text: "#fdf6e3", accent: "#268bd2" },
  tokyonight: { bg: "#13141c", text: "#c0caf5", accent: "#7aa2f7" },
  gruvbox: { bg: "#1d2021", text: "#fbf1c7", accent: "#fe8019" },
  catppuccin: { bg: "#181825", text: "#cdd6f4", accent: "#cba6f7" },
  sunset: { bg: "#140710", text: "#fff1f3", accent: "#ff6b6b" },
  oceanic: { bg: "#030d17", text: "#f0fdfa", accent: "#00e5ff" },
  rosepine: { bg: "#12101b", text: "#e0def4", accent: "#eb6f92" },
  synthwave: { bg: "#0f071a", text: "#fbf5ff", accent: "#ff2a85" },
  forest: { bg: "#060d08", text: "#f2fbf4", accent: "#84cc16" },
  desert: { bg: "#120c06", text: "#fffbeb", accent: "#e0ab55" },
  aurora: { bg: "#04030d", text: "#faf5ff", accent: "#9a6bff" },
  oled: { bg: "#000000", text: "#ffffff", accent: "#3b82f6" },
  highcontrast: { bg: "#000000", text: "#ffffff", accent: "#ffff00" },
};

/**
 * Calculates a match score for a target text against a search query.
 * Returns -1 if no match.
 */
export function scoreMatch(
  query: string,
  target: string,
  extraTerms: (string | undefined)[] = []
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();

  // 1. Exact match
  if (t === q) return 1000;

  // 2. Starts with query
  if (t.startsWith(q)) {
    return 800 + Math.max(0, 50 - (t.length - q.length));
  }

  // 3. Word boundary match (e.g. "dead" in "Red Dead Redemption")
  const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(q)}`, "i");
  if (wordBoundaryRegex.test(t)) {
    return 650 + Math.max(0, 30 - t.indexOf(q));
  }

  // 4. Acronym match (e.g. "gow" -> "God of War", "rdr" -> "Red Dead Redemption")
  const words = t.split(/[\s\-_:]+/).filter(Boolean);
  if (words.length > 1) {
    const acronym = words.map((w) => w[0]).join("");
    if (acronym === q) return 550;
    if (acronym.startsWith(q)) return 480;
  }

  // 5. Direct substring match
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    return 350 - Math.min(subIdx * 2, 100);
  }

  // 6. Fuzzy subsequence match
  let qIdx = 0;
  let matches = 0;
  let gapPenalty = 0;
  let prevMatchIdx = -1;

  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      matches++;
      if (prevMatchIdx !== -1) {
        gapPenalty += Math.max(0, i - prevMatchIdx - 1);
      }
      prevMatchIdx = i;
      qIdx++;
    }
  }

  if (matches === q.length) {
    return Math.max(120, 200 - gapPenalty * 5);
  }

  // 7. Extra metadata / tag terms match
  for (const term of extraTerms) {
    if (!term) continue;
    const termLower = term.toLowerCase();
    if (termLower.includes(q)) {
      return 90;
    }
  }

  return -1;
}

/**
 * Returns index ranges where the query matches within text for visual highlighting.
 */
export function getMatchRanges(text: string, query: string): MatchHighlight[] {
  const q = query.trim().toLowerCase();
  if (!q || !text) return [];

  const t = text.toLowerCase();
  const ranges: MatchHighlight[] = [];

  // Direct substring match first
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    return [{ start: subIdx, end: subIdx + q.length }];
  }

  // Fuzzy subsequence matches
  let qIdx = 0;
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      ranges.push({ start: i, end: i + 1 });
      qIdx++;
    }
  }

  // Merge consecutive single-char ranges
  if (ranges.length <= 1) return ranges;
  const merged: MatchHighlight[] = [];
  let current = { ...ranges[0] };

  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start === current.end) {
      current.end = ranges[i].end;
    } else {
      merged.push(current);
      current = { ...ranges[i] };
    }
  }
  merged.push(current);

  return merged;
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Formats a unix timestamp into relative text ("5m ago", "2h ago", "Yesterday", "3d ago", or date)
 */
export function formatRelativeTime(timestamp: number | undefined): string | null {
  if (!timestamp) return null;
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 14) return `${diffDays}d ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats bytes to human-readable size
 */
export function formatBytes(bytes: number | undefined): string | null {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  let unitIndex = 0;
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }
  return `${val.toFixed(unitIndex >= 3 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * Storage helpers for recent command executions / searches
 */
export function getRecentItems(): PaletteRecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentItem(id: string, title: string, category: PaletteCategory) {
  try {
    const recents = getRecentItems().filter((r) => r.id !== id);
    recents.unshift({
      id,
      title,
      category,
      timestamp: Date.now(),
    });
    localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(recents.slice(0, MAX_RECENTS))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function clearRecentItems() {
  try {
    localStorage.removeItem(RECENT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
