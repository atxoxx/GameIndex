import type {
  PaletteCategory,
  PaletteRecentItem,
  MatchHighlight,
  CalculationResult,
  ParsedQueryFilters,
} from "./commandPaletteTypes";

const RECENT_STORAGE_KEY = "gamelib.command_palette_recent:v2";
const MAX_RECENTS = 20;

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
 * Parses structured power filters from the raw search string.
 * Supports:
 * - is:installed / is:cloud / is:running / is:wishlist
 * - source:steam / source:gog / source:epic / source:rockstar / source:ubisoft / source:local
 * - genre:rpg / tag:action
 * - dev:valve / pub:ea
 * - year:2024 / year:>2020 / year:<2015
 */
export function parseQueryFilters(raw: string): ParsedQueryFilters {
  let text = raw.trim();
  const filters: ParsedQueryFilters = { cleanQuery: "" };

  // Remove leading scope trigger characters if any
  if (/^[@>/#$?]\s*/.test(text)) {
    text = text.replace(/^[@>/#$?]\s*/, "");
  }

  // Tokenize by whitespace while respecting quotes
  const tokens = text.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const remainingTokens: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === "is:installed" || lower === "installed:true") {
      filters.isInstalled = true;
    } else if (lower === "is:cloud" || lower === "is:uninstalled" || lower === "installed:false") {
      filters.isCloud = true;
    } else if (lower === "is:running") {
      filters.isRunning = true;
    } else if (lower === "is:wishlist" || lower === "is:wishlisted") {
      filters.isWishlisted = true;
    } else if (lower.startsWith("source:") || lower.startsWith("from:") || lower.startsWith("store:")) {
      filters.source = lower.split(":")[1]?.replace(/"/g, "");
    } else if (lower.startsWith("genre:") || lower.startsWith("g:")) {
      filters.genre = lower.split(":")[1]?.replace(/"/g, "");
    } else if (lower.startsWith("tag:")) {
      filters.tag = lower.split(":")[1]?.replace(/"/g, "");
    } else if (lower.startsWith("dev:") || lower.startsWith("developer:")) {
      filters.developer = lower.split(":")[1]?.replace(/"/g, "");
    } else if (lower.startsWith("pub:") || lower.startsWith("publisher:")) {
      filters.publisher = lower.split(":")[1]?.replace(/"/g, "");
    } else if (lower.startsWith("year:")) {
      const val = lower.slice(5).trim();
      if (val.startsWith(">")) {
        filters.yearOp = ">";
        filters.year = parseInt(val.slice(1), 10) || undefined;
      } else if (val.startsWith("<")) {
        filters.yearOp = "<";
        filters.year = parseInt(val.slice(1), 10) || undefined;
      } else {
        filters.yearOp = "=";
        filters.year = parseInt(val, 10) || undefined;
      }
    } else {
      remainingTokens.push(token);
    }
  }

  filters.cleanQuery = remainingTokens.join(" ").trim();
  return filters;
}

/**
 * Calculates a match score for a target text against a multi-token search query.
 * Returns -1 if not all required tokens match.
 */
export function scoreMatch(
  query: string,
  target: string,
  extraTerms: (string | undefined)[] = []
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();

  // 1. Exact string match
  if (t === q) return 1200;

  // 2. Starts with complete query
  if (t.startsWith(q)) {
    return 900 + Math.max(0, 50 - (t.length - q.length));
  }

  // 3. Word boundary match for full query
  const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(q)}`, "i");
  if (wordBoundaryRegex.test(t)) {
    return 750 + Math.max(0, 30 - t.indexOf(q));
  }

  // 4. Acronym match (e.g. "gow" -> "God of War", "rdr2" -> "Red Dead Redemption 2")
  const words = t.split(/[\s\-_:]+/).filter(Boolean);
  if (words.length > 1) {
    const acronym = words.map((w) => w[0]).join("");
    if (acronym === q) return 700;
    if (acronym.startsWith(q)) return 600;
    // Acronym with digits (e.g. "gta5" for "Grand Theft Auto V" or "Grand Theft Auto 5")
    const numWords = words.map((w) => {
      const match = w.match(/^(\d+|[a-zA-Z])/);
      return match ? match[1].toLowerCase() : "";
    }).join("");
    if (numWords === q) return 680;
  }

  // 5. Multi-token decomposition matching (e.g. "witcher wild" matches "The Witcher 3: Wild Hunt")
  const queryTokens = q.split(/\s+/).filter(Boolean);
  if (queryTokens.length > 1) {
    let allMatched = true;
    let tokenScore = 400;
    let prevIndex = -1;

    for (const token of queryTokens) {
      const directIdx = t.indexOf(token);
      if (directIdx !== -1) {
        tokenScore += 50;
        if (prevIndex !== -1 && directIdx > prevIndex) {
          tokenScore += 40; // in-order sequence bonus
        }
        prevIndex = directIdx;
      } else {
        // Check if token matches in extra terms
        let extraMatched = false;
        for (const term of extraTerms) {
          if (term && term.toLowerCase().includes(token)) {
            extraMatched = true;
            tokenScore += 20;
            break;
          }
        }
        if (!extraMatched) {
          allMatched = false;
          break;
        }
      }
    }

    if (allMatched) {
      return tokenScore;
    }
  }

  // 6. Direct substring match
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    return 380 - Math.min(subIdx * 2, 100);
  }

  // 7. Fuzzy subsequence match
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
    return Math.max(120, 260 - gapPenalty * 6);
  }

  // 8. Extra metadata / tag terms match
  for (const term of extraTerms) {
    if (!term) continue;
    const termLower = term.toLowerCase();
    if (termLower.startsWith(q)) return 140;
    if (termLower.includes(q)) return 100;
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

  // Multi-token match highlight
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    for (const token of tokens) {
      let startIndex = 0;
      let matchIdx = t.indexOf(token, startIndex);
      while (matchIdx !== -1) {
        ranges.push({ start: matchIdx, end: matchIdx + token.length });
        startIndex = matchIdx + token.length;
        matchIdx = t.indexOf(token, startIndex);
      }
    }
    return mergeOverlappingRanges(ranges);
  }

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

  return mergeOverlappingRanges(ranges);
}

function mergeOverlappingRanges(ranges: MatchHighlight[]): MatchHighlight[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: MatchHighlight[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= current.end) {
      current.end = Math.max(current.end, sorted[i].end);
    } else {
      merged.push(current);
      current = { ...sorted[i] };
    }
  }
  merged.push(current);
  return merged;
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Evaluates safe arithmetic expressions and unit conversions (Raycast-style instant tool).
 * Returns null if the query is not a mathematical or conversion expression.
 */
export function evaluateExpression(query: string): CalculationResult | null {
  const q = query.trim();
  if (q.length < 2) return null;

  // 1. Data Unit Conversion (e.g. "45 gb in mb", "1.2 tb to gb", "1024 mb in gb")
  const dataConvMatch = q.match(/^([\d.,]+)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)\s*(?:in|to|=|as)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)$/i);
  if (dataConvMatch) {
    const rawVal = parseFloat(dataConvMatch[1].replace(/,/g, ""));
    const fromUnit = dataConvMatch[2].toLowerCase();
    const toUnit = dataConvMatch[3].toLowerCase();

    if (!isNaN(rawVal)) {
      const toBytes = (v: number, u: string): number => {
        if (u === "b") return v;
        if (u === "kb") return v * 1000;
        if (u === "mb") return v * 1000 * 1000;
        if (u === "gb") return v * 1000 * 1000 * 1000;
        if (u === "tb") return v * 1000 * 1000 * 1000 * 1000;
        if (u === "kib") return v * 1024;
        if (u === "mib") return v * 1024 * 1024;
        if (u === "gib") return v * 1024 * 1024 * 1024;
        if (u === "tib") return v * 1024 * 1024 * 1024 * 1024;
        return v;
      };

      const fromBytes = (bytes: number, u: string): number => {
        if (u === "b") return bytes;
        if (u === "kb") return bytes / 1000;
        if (u === "mb") return bytes / (1000 * 1000);
        if (u === "gb") return bytes / (1000 * 1000 * 1000);
        if (u === "tb") return bytes / (1000 * 1000 * 1000 * 1000);
        if (u === "kib") return bytes / 1024;
        if (u === "mib") return bytes / (1024 * 1024);
        if (u === "gib") return bytes / (1024 * 1024 * 1024);
        if (u === "tib") return bytes / (1024 * 1024 * 1024 * 1024);
        return bytes;
      };

      const bytes = toBytes(rawVal, fromUnit);
      const converted = fromBytes(bytes, toUnit);
      const formatted = converted % 1 === 0 ? converted.toString() : converted.toFixed(2).replace(/\.?0+$/, "");

      return {
        expression: `${rawVal} ${fromUnit.toUpperCase()} → ${toUnit.toUpperCase()}`,
        result: `${formatted} ${toUnit.toUpperCase()}`,
        details: `${rawVal} ${fromUnit.toUpperCase()} = ${formatted} ${toUnit.toUpperCase()} (${formatBytes(bytes) || ""})`,
        unit: toUnit.toUpperCase(),
      };
    }
  }

  // 2. Gaming Frame-Time / Refresh Rate Conversion (e.g. "144 fps to ms", "16.6 ms to fps")
  const fpsMatch = q.match(/^([\d.,]+)\s*fps\s*(?:in|to|=|as)?\s*ms$/i);
  if (fpsMatch) {
    const fps = parseFloat(fpsMatch[1]);
    if (fps > 0) {
      const ms = (1000 / fps).toFixed(2);
      return {
        expression: `${fps} FPS frame time`,
        result: `${ms} ms`,
        details: `At ${fps} FPS, each frame takes ${ms} milliseconds`,
        unit: "ms",
      };
    }
  }

  const msMatch = q.match(/^([\d.,]+)\s*ms\s*(?:in|to|=|as)?\s*fps$/i);
  if (msMatch) {
    const ms = parseFloat(msMatch[1]);
    if (ms > 0) {
      const fps = (1000 / ms).toFixed(1);
      return {
        expression: `${ms} ms frame time`,
        result: `${fps} FPS`,
        details: `A frame time of ${ms} ms corresponds to ~${fps} frames per second`,
        unit: "FPS",
      };
    }
  }

  // 3. Pure Arithmetic (e.g. "1440 * 2560", "120 / 60", "4.5 * 1024", "(100 + 25) * 1.2")
  // Only match if string contains math operators and numbers
  if (!/^[\d\s.,+\-*/%^()xX]+$/.test(q)) return null;
  if (!/[\d]/.test(q) || !/[+\-*/%^xX]/.test(q)) return null;

  try {
    const normalized = q
      .replace(/x/gi, "*")
      .replace(/\^/g, "**")
      .replace(/(\d+(?:\.\d+)?)\s*%\s*(?:of|\*)\s*(\d+(?:\.\d+)?)/gi, "($1 / 100 * $2)")
      .replace(/,/g, "");

    // Strict validation to avoid dangerous code execution
    if (!/^[0-9+\-*/().\s*]+$/.test(normalized)) return null;

    // Evaluate using Function constructor with no arguments
    const result = Function(`"use strict"; return (${normalized})`)();
    if (typeof result !== "number" || isNaN(result) || !isFinite(result)) return null;

    const formattedResult = Number.isInteger(result)
      ? result.toLocaleString()
      : result.toFixed(4).replace(/\.?0+$/, "");

    return {
      expression: q,
      result: formattedResult,
      details: `${q} = ${formattedResult}`,
    };
  } catch {
    return null;
  }
}

/**
 * Formats a unix timestamp into relative text ("Just now", "5m ago", "2h ago", "Yesterday", "3d ago", or date)
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
 * Storage helpers for recent command executions and frecency management
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
    const recents = getRecentItems();
    const existingIndex = recents.findIndex((r) => r.id === id);
    const existing = existingIndex !== -1 ? recents[existingIndex] : null;

    const updatedItem: PaletteRecentItem = {
      id,
      title,
      category,
      timestamp: Date.now(),
      frequency: (existing?.frequency || 0) + 1,
    };

    const next = recents.filter((r) => r.id !== id);
    next.unshift(updatedItem);

    localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(next.slice(0, MAX_RECENTS))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function deleteRecentItem(id: string) {
  try {
    const recents = getRecentItems().filter((r) => r.id !== id);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recents));
  } catch {
    // Ignore
  }
}

export function clearRecentItems() {
  try {
    localStorage.removeItem(RECENT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
