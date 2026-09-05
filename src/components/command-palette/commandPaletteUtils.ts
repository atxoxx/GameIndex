import type {
  PaletteCategory,
  PaletteRecentItem,
  MatchHighlight,
  CalculationResult,
  ParsedQueryFilters,
  LibraryStatsData,
} from "./commandPaletteTypes";
import type { Game } from "../../types/game";

const RECENT_STORAGE_KEY = "gamelib.command_palette_recent:v2";
const MAX_RECENTS = 25;

export const THEME_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  adaptive: { bg: "#07070d", text: "#f5f6fc", accent: "#7c66ff" },
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

/** Common gaming abbreviation aliases mapping for instant acronym searches */
const COMMON_ACRONYMS: Record<string, string[]> = {
  gow: ["god of war", "gears of war"],
  rdr: ["red dead redemption"],
  rdr2: ["red dead redemption 2", "red dead redemption ii"],
  cp2077: ["cyberpunk 2077", "cyberpunk"],
  bg3: ["baldur's gate 3", "baldurs gate 3", "baldur's gate iii"],
  bg1: ["baldur's gate", "baldurs gate"],
  bg2: ["baldur's gate ii", "baldur's gate 2"],
  gta: ["grand theft auto"],
  gta5: ["grand theft auto v", "grand theft auto 5"],
  gta4: ["grand theft auto iv", "grand theft auto 4"],
  re4: ["resident evil 4", "resident evil iv"],
  re2: ["resident evil 2", "resident evil ii"],
  re8: ["resident evil village", "resident evil 8"],
  hl2: ["half-life 2", "half life 2"],
  botw: ["breath of the wild", "the legend of zelda: breath of the wild"],
  totk: ["tears of the kingdom", "the legend of zelda: tears of the kingdom"],
  er: ["elden ring", "shadow of the erdtree"],
  sotet: ["shadow of the erdtree", "elden ring"],
  ds3: ["dark souls iii", "dark souls 3"],
  ds1: ["dark souls", "dark souls remastered"],
  ds2: ["dark souls ii", "dark souls 2"],
  hfw: ["horizon forbidden west"],
  hzd: ["horizon zero dawn"],
  tarkov: ["escape from tarkov"],
  mc: ["minecraft"],
  cod: ["call of duty"],
  mw2: ["modern warfare 2", "modern warfare ii"],
  civ6: ["civilization vi", "civilization 6"],
  mhw: ["monster hunter: world", "monster hunter world"],
  ac: ["assassin's creed", "animal crossing", "armored core"],
  ac6: ["armored core vi", "armored core 6"],
  ff7: ["final fantasy vii", "final fantasy 7"],
  ff14: ["final fantasy xiv", "final fantasy 14"],
  ffxiv: ["final fantasy xiv", "final fantasy 14"],
  ff16: ["final fantasy xvi", "final fantasy 16"],
  ffxvi: ["final fantasy xvi", "final fantasy 16"],
  dbd: ["dead by daylight"],
  poe: ["path of exile", "pillars of eternity"],
  lol: ["league of legends"],
  cs2: ["counter-strike 2", "counter strike 2"],
  csgo: ["counter-strike: global offensive"],
  tf2: ["team fortress 2"],
  wow: ["world of warcraft"],
  rottr: ["rise of the tomb raider"],
  sottr: ["shadow of the tomb raider"],
  tw3: ["the witcher 3", "witcher 3"],
  wukong: ["black myth: wukong", "black myth wukong", "wukong"],
  bmw: ["black myth: wukong", "black myth wukong"],
  hd2: ["helldivers 2", "helldivers ii"],
  helldivers: ["helldivers 2", "helldivers"],
  sf6: ["street fighter 6", "street fighter vi"],
  tekken8: ["tekken 8"],
  t8: ["tekken 8"],
  p3r: ["persona 3 reload"],
  p5r: ["persona 5 royal"],
  palworld: ["palworld"],
  val: ["valorant"],
  apex: ["apex legends"],
  d4: ["diablo iv", "diablo 4"],
  sm2: ["space marine 2", "warhammer 40,000: space marine 2"],
  stalker2: ["s.t.a.l.k.e.r. 2", "stalker 2"],
  kcd: ["kingdom come: deliverance", "kingdom come deliverance"],
  kcd2: ["kingdom come: deliverance ii", "kingdom come deliverance 2"],
  dd2: ["dragon's dogma 2", "dragons dogma 2"],
  tlou: ["the last of us", "the last of us part i"],
  tlou2: ["the last of us part ii", "the last of us part 2"],
  aw2: ["alan wake 2", "alan wake ii"],
};

/**
 * Parses structured power filters from the raw search string.
 * Supports:
 * - is:installed / is:cloud / is:running / is:wishlist / is:fav / is:unplayed / is:untracked / is:hidden
 * - source:steam / source:gog / source:epic / source:rockstar / source:ubisoft / source:local / source:emulator
 * - genre:rpg / tag:action
 * - dev:fromsoftware / pub:sony
 * - year:2024 / year:>2020 / year:<2015
 * - rating:>80 / rating:<60 / rating:4
 * - playtime:>10h / playtime:<5h / playtime:0
 * - size:>50gb / size:<10gb / size:>1tb
 * - sort:recent / sort:playtime / sort:rating / sort:name / sort:size
 */
export function parseQueryFilters(raw: string): ParsedQueryFilters {
  let text = raw.trim();
  const filters: ParsedQueryFilters = { cleanQuery: "" };

  // Remove leading scope trigger characters if any (@, >, /, #, $, ?, !, ~, =)
  // but preserve negation filters like !installed or !fav
  if (!/^!(?:installed|fav|unplayed|running)\b/i.test(text) && /^[@>/#$?!~=]\s*/.test(text)) {
    text = text.replace(/^[@>/#$?!~=]\s*/, "");
  }

  // Tokenize by whitespace while respecting quotes
  const tokens = text.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const remainingTokens: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === "is:installed" || lower === "installed:true" || lower === "+installed") {
      filters.isInstalled = true;
    } else if (
      lower === "is:cloud" ||
      lower === "is:uninstalled" ||
      lower === "installed:false" ||
      lower === "!installed" ||
      lower === "-installed"
    ) {
      filters.isCloud = true;
    } else if (lower === "is:running" || lower === "running:true") {
      filters.isRunning = true;
    } else if (lower === "is:wishlist" || lower === "is:wishlisted" || lower === "wishlist:true") {
      filters.isWishlisted = true;
    } else if (
      lower === "is:fav" ||
      lower === "is:favorite" ||
      lower === "fav:true" ||
      lower === "favorite:true" ||
      lower === "+fav"
    ) {
      filters.isFavorite = true;
    } else if (lower === "!fav" || lower === "-fav" || lower === "fav:false") {
      // Exclude favorites
    } else if (lower === "is:unplayed" || lower === "unplayed:true" || lower === "is:backlog") {
      filters.isUnplayed = true;
    } else if (lower === "is:untracked" || lower === "untracked:true") {
      filters.isUntracked = true;
    } else if (lower === "is:hidden" || lower === "hidden:true") {
      filters.isHidden = true;
    } else if (lower.startsWith("source:") || lower.startsWith("from:") || lower.startsWith("store:")) {
      filters.source = lower.split(":")[1]?.replace(/"/g, "");
    } else if (lower.startsWith("genre:") || lower.startsWith("g:")) {
      filters.genre = lower.split(":")[1]?.replace(/"/g, "");
    } else if (lower.startsWith("tag:") || lower.startsWith("t:")) {
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
    } else if (lower.startsWith("rating:") || lower.startsWith("score:")) {
      const val = lower.replace(/^(?:rating|score):/, "").trim();
      if (val.startsWith(">")) {
        filters.ratingOp = ">";
        filters.rating = parseFloat(val.slice(1)) || undefined;
      } else if (val.startsWith("<")) {
        filters.ratingOp = "<";
        filters.rating = parseFloat(val.slice(1)) || undefined;
      } else {
        filters.ratingOp = "=";
        filters.rating = parseFloat(val) || undefined;
      }
    } else if (lower.startsWith("playtime:") || lower.startsWith("time:") || lower.startsWith("hours:")) {
      const val = lower.replace(/^(?:playtime|time|hours):/, "").trim();
      if (val.startsWith(">")) {
        filters.playtimeOp = ">";
        filters.playtimeHours = parsePlaytimeStringToHours(val.slice(1));
      } else if (val.startsWith("<")) {
        filters.playtimeOp = "<";
        filters.playtimeHours = parsePlaytimeStringToHours(val.slice(1));
      } else {
        filters.playtimeOp = "=";
        filters.playtimeHours = parsePlaytimeStringToHours(val);
      }
    } else if (lower.startsWith("size:") || lower.startsWith("disk:")) {
      const val = lower.replace(/^(?:size|disk):/, "").trim();
      if (val.startsWith(">")) {
        filters.sizeOp = ">";
        filters.sizeBytes = parseSizeStringToBytes(val.slice(1));
      } else if (val.startsWith("<")) {
        filters.sizeOp = "<";
        filters.sizeBytes = parseSizeStringToBytes(val.slice(1));
      } else {
        filters.sizeOp = "=";
        filters.sizeBytes = parseSizeStringToBytes(val);
      }
    } else if (lower.startsWith("sort:")) {
      const val = lower.split(":")[1]?.replace(/"/g, "") as any;
      if (["recent", "playtime", "rating", "name", "size"].includes(val)) {
        filters.sort = val;
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
 * Returns -1 if not matching.
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
  if (t === q) return 1500;

  // 2. Starts with complete query
  if (t.startsWith(q)) {
    return 1100 + Math.max(0, 60 - (t.length - q.length));
  }

  // 3. Word boundary match for full query
  const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(q)}`, "i");
  if (wordBoundaryRegex.test(t)) {
    return 950 + Math.max(0, 40 - t.indexOf(q));
  }

  // 4. Known acronym dictionary match (e.g. "gow", "rdr2", "cp2077", "bg3", "gta5")
  if (COMMON_ACRONYMS[q]) {
    for (const phrase of COMMON_ACRONYMS[q]) {
      if (t.includes(phrase)) {
        return 920;
      }
    }
  }

  // 5. Dynamic word acronym / initialism match
  const words = t.split(/[\s\-_:.]+/).filter(Boolean);
  if (words.length > 1) {
    const acronym = words.map((w) => w[0]).join("");
    if (acronym === q) return 860;
    if (acronym.startsWith(q)) return 780;

    // Acronym with digits (e.g. "gta5" for "Grand Theft Auto V" or "Grand Theft Auto 5")
    const numWords = words
      .map((w) => {
        const match = w.match(/^(\d+|[a-zA-Z])/);
        return match ? match[1].toLowerCase() : "";
      })
      .join("");
    if (numWords === q) return 840;
  }

  // 6. Multi-token decomposition matching
  const queryTokens = q.split(/\s+/).filter(Boolean);
  if (queryTokens.length > 1) {
    let allMatched = true;
    let tokenScore = 600;
    let prevIndex = -1;

    for (const token of queryTokens) {
      const directIdx = t.indexOf(token);
      if (directIdx !== -1) {
        tokenScore += 60;
        if (prevIndex !== -1 && directIdx > prevIndex) {
          tokenScore += 50; // In-order bonus
        }
        prevIndex = directIdx;
      } else {
        // Check extra terms
        let extraMatched = false;
        for (const term of extraTerms) {
          if (term && term.toLowerCase().includes(token)) {
            extraMatched = true;
            tokenScore += 30;
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

  // 7. Direct substring match
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    return 500 - Math.min(subIdx * 2, 120);
  }

  // 8. Fuzzy subsequence match
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
    return Math.max(160, 380 - gapPenalty * 5);
  }

  // 9. Levenshtein typo-tolerant single word match (tolerates 1-2 mistypes for q.length >= 4)
  if (q.length >= 4 && words.length > 0) {
    let bestDist = 999;
    for (const word of words) {
      const dist = levenshteinDistance(q, word.slice(0, q.length + 2));
      if (dist < bestDist) bestDist = dist;
    }
    if (bestDist <= (q.length > 6 ? 2 : 1)) {
      return 280 - bestDist * 60;
    }
  }

  // 10. Extra metadata / tag terms match
  for (const term of extraTerms) {
    if (!term) continue;
    const termLower = term.toLowerCase();
    if (termLower.startsWith(q)) return 200;
    if (termLower.includes(q)) return 140;
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
 * Calculates Levenshtein distance for typo tolerance
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Parses user size string (e.g. "50gb", "100mb", "1.5tb") into numeric bytes
 */
export function parseSizeStringToBytes(str: string): number | undefined {
  const match = str.trim().toLowerCase().match(/^([\d.,]+)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)?$/);
  if (!match) return undefined;
  const val = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(val)) return undefined;
  const unit = match[2] || "gb";

  if (unit === "b") return val;
  if (unit === "kb") return val * 1000;
  if (unit === "mb") return val * 1000 * 1000;
  if (unit === "gb") return val * 1000 * 1000 * 1000;
  if (unit === "tb") return val * 1000 * 1000 * 1000 * 1000;
  if (unit === "kib") return val * 1024;
  if (unit === "mib") return val * 1024 * 1024;
  if (unit === "gib") return val * 1024 * 1024 * 1024;
  if (unit === "tib") return val * 1024 * 1024 * 1024 * 1024;
  return val * 1000 * 1000 * 1000;
}

/**
 * Parses playtime string (e.g. "10h", "120m", "5.5 hours") into numeric hours
 */
export function parsePlaytimeStringToHours(str: string): number | undefined {
  const match = str.trim().toLowerCase().match(/^([\d.,]+)\s*(h|hr|hours?|m|min|minutes?)?$/);
  if (!match) return undefined;
  const val = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(val)) return undefined;
  const unit = match[2] || "h";

  if (unit.startsWith("m")) return val / 60;
  return val;
}

/**
 * Formats duration in seconds into human readable time (e.g. "1 hr 45 min", "42 sec", "15 min")
 */
export function formatDurationSeconds(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} sec`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) {
    const remSec = Math.round(sec % 60);
    return remSec > 0 ? `${mins} min ${remSec}s` : `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) {
    return remMin > 0 ? `${hours} hr ${remMin} min` : `${hours} hr`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days} days`;
}

/**
 * Evaluates safe arithmetic expressions, unit conversions, download time estimations,
 * and aspect ratios (Raycast/Alfred style instant tool).
 */
export function evaluateExpression(query: string): CalculationResult | null {
  const q = query.trim();
  if (q.length < 2) return null;

  // 1. Download Time Estimator (e.g. "80 gb at 100 mbps", "50 gb @ 20 mb/s", "100 gb at 1 gbps", "40 gb in 50 mbps")
  const dlMatch = q.match(/^([\d.,]+)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)\s*(?:at|@|in)\s*([\d.,]+)\s*(mbps|gbps|kbps|mb\/s|gb\/s|kb\/s|mbit\/s|gbit\/s)$/i);
  if (dlMatch) {
    const sizeVal = parseFloat(dlMatch[1].replace(/,/g, ""));
    const sizeUnit = dlMatch[2].toLowerCase();
    const speedVal = parseFloat(dlMatch[3].replace(/,/g, ""));
    const speedUnit = dlMatch[4].toLowerCase();

    if (!isNaN(sizeVal) && !isNaN(speedVal) && speedVal > 0) {
      const sizeInBytes = parseSizeStringToBytes(`${sizeVal}${sizeUnit}`) || 0;
      let speedBytesPerSec = 0;

      if (speedUnit.includes("mbps") || speedUnit.includes("mbit/s")) {
        speedBytesPerSec = (speedVal * 1000 * 1000) / 8;
      } else if (speedUnit.includes("gbps") || speedUnit.includes("gbit/s")) {
        speedBytesPerSec = (speedVal * 1000 * 1000 * 1000) / 8;
      } else if (speedUnit.includes("kbps")) {
        speedBytesPerSec = (speedVal * 1000) / 8;
      } else if (speedUnit.includes("mb/s")) {
        speedBytesPerSec = speedVal * 1000 * 1000;
      } else if (speedUnit.includes("gb/s")) {
        speedBytesPerSec = speedVal * 1000 * 1000 * 1000;
      } else if (speedUnit.includes("kb/s")) {
        speedBytesPerSec = speedVal * 1000;
      }

      if (speedBytesPerSec > 0) {
        const totalSec = sizeInBytes / speedBytesPerSec;
        const formattedTime = formatDurationSeconds(totalSec);
        return {
          expression: `${sizeVal} ${sizeUnit.toUpperCase()} @ ${speedVal} ${speedUnit.toUpperCase()}`,
          result: `~${formattedTime}`,
          details: `Downloading ${sizeVal} ${sizeUnit.toUpperCase()} at ${speedVal} ${speedUnit.toUpperCase()} will take approximately ${formattedTime}`,
          unit: "Time",
          calcType: "download",
        };
      }
    }
  }

  // 2. Display Resolution / Aspect Ratio (e.g. "2560x1440 ratio", "3840 x 2160 aspect", "1920x1080 ratio", "2560*1440 aspect")
  const resMatch = q.match(/^(\d{3,5})\s*(?:x|\*)\s*(\d{3,5})\s*(?:ratio|aspect|res|resolution)?$/i);
  if (resMatch && (q.toLowerCase().includes("ratio") || q.toLowerCase().includes("aspect") || q.toLowerCase().includes("x") || q.toLowerCase().includes("res"))) {
    const w = parseInt(resMatch[1], 10);
    const h = parseInt(resMatch[2], 10);
    if (w > 0 && h > 0) {
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const divisor = gcd(w, h);
      let rw = w / divisor;
      let rh = h / divisor;

      // Normalize common display ratios (e.g. 8:5 -> 16:10, 64:27 -> 21:9)
      if (rw === 8 && rh === 5) {
        rw = 16;
        rh = 10;
      } else if (Math.abs(w / h - 21 / 9) < 0.05) {
        rw = 21;
        rh = 9;
      } else if (Math.abs(w / h - 32 / 9) < 0.05) {
        rw = 32;
        rh = 9;
      }

      const megapixels = ((w * h) / 1000000).toFixed(2);
      let standardName = "";
      if (w === 1920 && h === 1080) standardName = "FHD (1080p)";
      else if (w === 2560 && h === 1440) standardName = "QHD / 2K (1440p)";
      else if (w === 3840 && h === 2160) standardName = "4K UHD (2160p)";
      else if (w === 3440 && h === 1440) standardName = "UW-QHD Ultrawide";
      else if (w === 5120 && h === 1440) standardName = "Dual QHD (Super Ultrawide)";
      else if (w === 1280 && h === 720) standardName = "HD (720p)";
      else if (w === 1280 && h === 800) standardName = "Steam Deck (800p)";

      return {
        expression: `${w} × ${h} Resolution`,
        result: `${rw}:${rh} (${megapixels} MP)`,
        details: `${w} × ${h} has a ${rw}:${rh} aspect ratio with ${megapixels} million pixels${standardName ? ` · ${standardName}` : ""}`,
        unit: `${rw}:${rh}`,
        calcType: "resolution",
      };
    }
  }

  // 3. Data Unit Conversion (e.g. "45 gb in mb", "1.2 tb to gb", "1024 mb in gb", "500 gib to mib")
  const dataConvMatch = q.match(/^([\d.,]+)\s*(b|kb|mb|gb|tb|pb|kib|mib|gib|tib)\s*(?:in|to|=|as)\s*(b|kb|mb|gb|tb|pb|kib|mib|gib|tib)$/i);
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
        if (u === "pb") return v * 1000 * 1000 * 1000 * 1000 * 1000;
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
        if (u === "pb") return bytes / (1000 * 1000 * 1000 * 1000 * 1000);
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
        calcType: "data",
      };
    }
  }

  // 4. Gaming Frame-Time / Refresh Rate Conversion (e.g. "144 fps to ms", "16.6 ms to fps", "240 fps in ms")
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
        calcType: "frametime",
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
        calcType: "frametime",
      };
    }
  }

  // 5. Pure Arithmetic & Percentages (e.g. "1440 * 2560", "120 / 60", "4.5 * 1024", "(100 + 25) * 1.2", "20% of 150")
  const percentOfMatch = q.match(/^([\d.,]+)\s*%\s*(?:of|\*)\s*([\d.,]+)$/i);
  if (percentOfMatch) {
    const pct = parseFloat(percentOfMatch[1].replace(/,/g, ""));
    const base = parseFloat(percentOfMatch[2].replace(/,/g, ""));
    if (!isNaN(pct) && !isNaN(base)) {
      const res = (pct / 100) * base;
      const formatted = res % 1 === 0 ? res.toString() : res.toFixed(4).replace(/\.?0+$/, "");
      return {
        expression: `${pct}% of ${base}`,
        result: formatted,
        details: `${pct}% of ${base} = ${formatted}`,
        calcType: "math",
      };
    }
  }

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

    const result = Function(`"use strict"; return (${normalized})`)();
    if (typeof result !== "number" || isNaN(result) || !isFinite(result)) return null;

    const formattedResult = Number.isInteger(result)
      ? result.toLocaleString()
      : result.toFixed(4).replace(/\.?0+$/, "");

    return {
      expression: q,
      result: formattedResult,
      details: `${q} = ${formattedResult}`,
      calcType: "math",
    };
  } catch {
    return null;
  }
}

/**
 * Calculates aggregate library statistics and KPIs
 */
export function calculateLibraryStats(games: Game[]): LibraryStatsData {
  const totalGames = games.length;
  const installedGames = games.filter((g) => g.installed).length;
  const totalSizeBytes = games.reduce((acc, g) => acc + (g.sizeBytes || 0), 0);
  const favoriteCount = games.filter((g) => g.favorite).length;

  let totalPlaytimeHours = 0;
  let unplayedCount = 0;
  let topPlayedGame: { name: string; playTime: string; coverArtUrl?: string } | undefined = undefined;
  let maxPlaytimeHours = 0;

  games.forEach((g) => {
    const hours = parsePlaytimeStringToHours(g.playTime || "") || 0;
    totalPlaytimeHours += hours;
    if (hours === 0 && !g.lastPlayed) {
      unplayedCount++;
    }
    if (hours > maxPlaytimeHours) {
      maxPlaytimeHours = hours;
      topPlayedGame = {
        name: g.name,
        playTime: g.playTime || `${Math.round(hours)}h`,
        coverArtUrl: g.coverArtUrl,
      };
    }
  });

  return {
    totalGames,
    installedGames,
    totalSizeBytes,
    totalPlaytimeHours: Math.round(totalPlaytimeHours * 10) / 10,
    favoriteCount,
    unplayedCount,
    topPlayedGame,
  };
}

/**
 * Formats a unix timestamp into relative text ("Just now", "5m ago", "2h ago", "Yesterday", "3d ago", or date)
 */
export function formatRelativeTime(
  timestamp: number | undefined,
  locale?: string
): string | null {
  if (!timestamp) return null;
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (typeof Intl !== "undefined" && Intl.RelativeTimeFormat) {
    try {
      const rtf = new Intl.RelativeTimeFormat(locale || undefined, { numeric: "auto" });
      if (diffSec < 60) return rtf.format(-Math.max(1, diffSec), "second");
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return rtf.format(-diffMin, "minute");
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return rtf.format(-diffHour, "hour");
      const diffDays = Math.floor(diffHour / 24);
      if (diffDays < 14) return rtf.format(-diffDays, "day");
    } catch {
      // Fallback below
    }
  }

  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 14) return `${diffDays}d ago`;

  return new Date(timestamp).toLocaleDateString(locale || undefined, {
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
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
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

/**
 * Cleans and formats raw game synopses / descriptions into readable paragraphs:
 * - Decodes HTML entities commonly returned by store scrapers (&quot;, &amp;, etc.)
 * - Normalizes missing spaces after ellipses ("word...Next" -> "word... Next")
 * - Normalizes missing spaces after sentence punctuation ("word.Next" -> "word. Next")
 * - Splits into clean paragraphs on double newlines while collapsing excessive whitespace
 */
export function formatSummaryParagraphs(text?: string | null): string[] {
  if (!text) return [];
  const cleaned = text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/(\.{2,}|…)([A-Za-zÀ-ÿ0-9])/g, "$1 $2")
    .replace(/([a-zà-ÿ]{2,}[.!?])([A-ZÀ-ÖØ-ß])/g, "$1 $2")
    .replace(/[ \t]+/g, " ")
    .trim();

  const paragraphs = cleaned
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs.length > 0 ? paragraphs : [cleaned];
}

