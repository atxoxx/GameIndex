import type { Game } from "../types/game";
import { formatPlayTime, parsePlayTime } from "../types/game";

/**
 * libraryExportHtml — builds a fully self-contained, static HTML page
 * that showcases a user's game library. The output has no external
 * dependencies (fonts, CDNs, frameworks): every style is inline and the
 * only interactivity is a few lines of vanilla JS (live name filter,
 * per-platform group collapsing and a dark/light theme toggle).
 *
 * The file is meant to be shared with anyone — open it in any browser,
 * even fully offline. All game data (names, genres, playtime strings,
 * cover data-URLs, …) is HTML-escaped before it ever touches the
 * template. Nothing from the library is trusted into the markup.
 */

export type LibraryExportSort = "name" | "recent" | "played";
export type LibraryExportTheme = "dark" | "light";

export interface LibraryExportOptions {
  /** Embed cover art as base64 data-URLs (can make the file large). */
  includeCovers: boolean;
  /** Show per-game playtime. */
  includePlaytime: boolean;
  /** Show the platform / store badge. */
  includePlatforms: boolean;
  /** Show genre tags. */
  includeGenres: boolean;
  /** Show the user star rating + IGDB score. */
  includeRating: boolean;
  /** Show the release year (parsed defensively from `releaseDate`). */
  includeYear: boolean;
  /** Sort order applied within each group / the whole list. */
  sort: LibraryExportSort;
  /** Initial theme of the exported page (togglable in-page). */
  theme: LibraryExportTheme;
  /** Organise the page into per-platform sections with sticky headers. */
  groupByPlatform: boolean;
}

interface ExportMeta {
  /** App name shown in the page header/footer (e.g. "GameIndex"). */
  appName?: string;
  /** Pre-formatted display date, e.g. "August 9, 2026". */
  exportDate?: string;
}

export const LIBRARY_EXPORT_DEFAULTS: LibraryExportOptions = {
  includeCovers: true,
  includePlaytime: true,
  includePlatforms: true,
  includeGenres: true,
  includeRating: false,
  includeYear: false,
  sort: "name",
  theme: "dark",
  groupByPlatform: true,
};

// ─── Escaping ────────────────────────────────────────────────────────
// Every string that originates from game data passes through here before
// entering the template. `escapeHtml` neutralises `<`, `>`, `&`, `"` and
// `'` so a hostile title can neither break the markup nor inject markup
// of its own.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Field helpers ───────────────────────────────────────────────────

/** Defensive 4-digit year extraction from the free-form `releaseDate`. */
function extractYear(releaseDate: string | undefined | null): number | null {
  if (!releaseDate) return null;
  const match = releaseDate.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  return year >= 1970 && year <= 2100 ? year : null;
}

/** True when the playtime string represents a non-zero amount. */
function hasPlaytime(playTime: string | undefined): boolean {
  if (!playTime) return false;
  return parsePlayTime(playTime) > 0;
}

function makeSorter(sort: LibraryExportSort) {
  switch (sort) {
    case "recent":
      return (a: Game, b: Game) => (b.addedAt ?? 0) - (a.addedAt ?? 0);
    case "played":
      return (a: Game, b: Game) => parsePlayTime(b.playTime) - parsePlayTime(a.playTime);
    case "name":
    default:
      return (a: Game, b: Game) => a.name.localeCompare(b.name);
  }
}

/** First letter (or "?") used as the cover placeholder glyph. */
function coverFallbackGlyph(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0].toUpperCase();
}

function totalPlaytimeMinutes(games: Game[]): number {
  return games.reduce((sum, g) => sum + parsePlayTime(g.playTime), 0);
}

/**
 * CSS class slug for a platform name — "Steam" → `pf-steam`, "GOG" →
 * `pf-gog`, anything unknown/empty → no class (neutral styling). Drives
 * the tasteful per-platform colour coding on pills + group dots.
 */
function platformSlug(platform: string | undefined | null): string {
  if (!platform) return "";
  return platform.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The most common platform (or null when nothing is usable). */
function topPlatform(games: Game[]): string | null {
  const counts = new Map<string, number>();
  for (const g of games) {
    if (g.platform) counts.set(g.platform, (counts.get(g.platform) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [platform, n] of counts) {
    if (n > bestCount) {
      best = platform;
      bestCount = n;
    }
  }
  return best;
}

/** The most common genre (or null when nothing is usable). */
function topGenre(games: Game[]): string | null {
  const counts = new Map<string, number>();
  for (const g of games) {
    for (const genre of g.genres ?? []) {
      if (genre) counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [genre, n] of counts) {
    if (n > bestCount) {
      best = genre;
      bestCount = n;
    }
  }
  return best;
}

interface Group {
  label: string;
  games: Game[];
}

/**
 * Bucket the (already sorted) games by platform. Groups are ordered
 * biggest-first so the most populated shelves lead; alphabetical as the
 * tie-breaker keeps the order deterministic.
 */
function groupGames(games: Game[], groupByPlatform: boolean): Group[] {
  if (!groupByPlatform) return [{ label: "", games }];
  const map = new Map<string, Game[]>();
  for (const g of games) {
    const label = (g.platform ?? "").trim() || "Other";
    const list = map.get(label);
    if (list) list.push(g);
    else map.set(label, [g]);
  }
  return [...map.entries()]
    .map(([label, list]) => ({ label, games: list }))
    .sort((a, b) => b.games.length - a.games.length || a.label.localeCompare(b.label));
}

// ─── Card rendering ──────────────────────────────────────────────────

function renderCard(game: Game, opts: LibraryExportOptions, index: number): string {
  const title = escapeHtml(game.name.trim() || "Untitled");
  const dataName = escapeHtml(game.name.toLowerCase());
  const stagger = Math.min(index, 12) * 45;

  // Cover block: real art when enabled + present, otherwise a soft
  // gradient placeholder with the title's first letter in a glass glyph.
  let coverBlock: string;
  if (opts.includeCovers && game.coverArtUrl) {
    coverBlock = `
        <div class="cover">
          <img src="${escapeHtml(game.coverArtUrl)}" alt="${title} cover" loading="lazy">
        </div>`;
  } else {
    coverBlock = `
        <div class="cover cover--fallback" aria-hidden="true">
          <span class="fallback-glyph">${escapeHtml(coverFallbackGlyph(game.name))}</span>
        </div>`;
  }

  // Meta pills: platform (colour-coded dot), year, playtime.
  const metaPills: string[] = [];
  if (opts.includePlatforms && game.platform) {
    const slug = platformSlug(game.platform);
    metaPills.push(
      `<span class="pill pill-platform${slug ? ` pf-${slug}` : ""}">${escapeHtml(game.platform)}</span>`,
    );
  }
  if (opts.includeYear) {
    const year = extractYear(game.releaseDate);
    if (year !== null) {
      metaPills.push(`<span class="pill">${year}</span>`);
    }
  }
  if (opts.includePlaytime && hasPlaytime(game.playTime)) {
    metaPills.push(`<span class="pill pill--accent">${escapeHtml(game.playTime)}</span>`);
  }
  const metaRow = metaPills.length > 0
    ? `
        <div class="meta">${metaPills.join("")}</div>`
    : "";

  // Genre chips.
  let genresRow = "";
  if (opts.includeGenres && game.genres && game.genres.length > 0) {
    const chips = game.genres.map((g) => `<span class="genre">${escapeHtml(g)}</span>`).join("");
    genresRow = `
        <div class="genres">${chips}</div>`;
  }

  // Ratings: user stars (1-5) + IGDB score (0-100).
  let ratingRow = "";
  if (opts.includeRating) {
    const parts: string[] = [];
    const user = game.rating;
    if (typeof user === "number" && user >= 1 && user <= 5) {
      const full = Math.round(user);
      const stars = "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
      parts.push(`<span class="stars" aria-label="Rated ${full} out of 5">${stars}</span>`);
    }
    if (typeof game.igdbRating === "number" && game.igdbRating > 0) {
      const score = Math.round(game.igdbRating);
      parts.push(`<span class="igdb">IGDB ${score}</span>`);
    }
    if (parts.length > 0) {
      ratingRow = `
        <div class="rating">${parts.join("")}</div>`;
    }
  }

  return `
    <article class="card" data-name="${dataName}" style="animation-delay:${stagger}ms">
      ${coverBlock}
      <div class="card-body">
        <h3 class="card-title">${title}</h3>${metaRow}${genresRow}${ratingRow}
      </div>
    </article>`;
}

// ─── Page shell ──────────────────────────────────────────────────────

function renderPage(
  games: Game[],
  opts: LibraryExportOptions,
  meta: ExportMeta,
): string {
  const appName = meta.appName ?? "GameIndex";
  const date = meta.exportDate ?? new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const count = games.length;
  const groups = groupGames(games, opts.groupByPlatform);
  const total = totalPlaytimeMinutes(games);

  // Hero meta line: app · count · playtime · export date.
  const heroParts: string[] = [`${count} ${count === 1 ? "game" : "games"}`];
  if (opts.includePlaytime && total > 0) heroParts.push(`${formatPlayTime(total)} played`);
  heroParts.push(`Exported ${date}`);
  const heroMeta = heroParts.join(" · ");

  // KPI stat strip — only tiles whose data is enabled + present.
  const stats: { value: string; label: string }[] = [{ value: String(count), label: "Games" }];
  if (opts.includePlaytime && total > 0) {
    stats.push({ value: formatPlayTime(total), label: "Played" });
  }
  if (opts.includePlatforms) {
    const tp = topPlatform(games);
    if (tp) stats.push({ value: tp, label: "Top platform" });
  }
  if (opts.includeGenres) {
    const tg = topGenre(games);
    if (tg) stats.push({ value: tg, label: "Top genre" });
  }
  const statsStrip = stats.length > 0
    ? `
    <div class="stats-strip">
${stats.map((s) => `
      <div class="stat">
        <span class="stat-value">${escapeHtml(s.value)}</span>
        <span class="stat-label">${escapeHtml(s.label)}</span>
      </div>`).join("")}
    </div>`
    : "";

  // Groups (or a single unlabelled grid when grouping is off).
  const body = groups
    .map((group) => {
      const cards = group.games.map((g, i) => renderCard(g, opts, i)).join("\n");
      if (opts.groupByPlatform) {
        const slug = platformSlug(group.label);
        return `
    <section class="group">
      <h2 class="group-header">
        <span class="group-dot${slug ? ` pf-${slug}` : ""}" aria-hidden="true"></span>
        <span class="group-name">${escapeHtml(group.label)}</span>
        <span class="group-count">${group.games.length}</span>
      </h2>
      <div class="grid">
${cards}
      </div>
    </section>`;
      }
      return `
    <div class="grid">
${cards}
    </div>`;
    })
    .join("");

  const emptyState = count === 0
    ? `
    <div class="empty">
      <div class="empty-icon">${EMPTY_ICON}</div>
      <h2>Nothing here yet</h2>
      <p>Add games to your library in ${escapeHtml(appName)}, then export again to share them.</p>
    </div>`
    : `
    <div class="empty" id="empty" hidden>
      <div class="empty-icon">${EMPTY_ICON}</div>
      <h2>No games match your search</h2>
      <p>Try a different name, or clear the search to see everything again.</p>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(appName)} — Game Library (${count})</title>
<style>
${STYLE}
</style>
</head>
<body class="theme-${opts.theme}">
  <div class="wrap">
    <header class="hero">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">${BRAND_ICON}</div>
        <div>
          <div class="eyebrow">${escapeHtml(appName)}</div>
          <h1>Game Library</h1>
          <div class="hero-meta">${escapeHtml(heroMeta)}</div>
        </div>
      </div>
      <button type="button" class="theme-btn" id="themeToggle">
        <span class="icon-sun" aria-hidden="true">${SUN_ICON}</span>
        <span class="icon-moon" aria-hidden="true">${MOON_ICON}</span>
        <span class="theme-btn-label">Light mode</span>
      </button>
    </header>

    ${statsStrip}

    <div class="controls">
      <label class="search">
        ${SEARCH_ICON}
        <input type="search" id="search" placeholder="Search games…" aria-label="Search games" autocomplete="off">
      </label>
      <span class="stats" id="stats">Showing ${count} of ${count} ${count === 1 ? "game" : "games"}</span>
    </div>

    <main>
${body}
    </main>

    ${emptyState}

    <footer class="footer">
      <span class="footer-brand"><span aria-hidden="true">${FOOTER_MARK}</span>Generated by ${escapeHtml(appName)}</span>
      <span>Exported ${escapeHtml(date)}</span>
    </footer>
  </div>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
}

// ─── Inline assets (kept outside the template for readability) ───────

const BRAND_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26">
    <path d="M6 12h4"/><path d="M14 12h4"/>
    <path d="M17 9c.8-.3 1.6.1 2 1"/>
    <path d="M5 9c-.8-.3-1.6.1-2 1"/>
    <rect x="2" y="8" width="20" height="9" rx="5"/>
  </svg>`;

const FOOTER_MARK = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
    <path d="M6 12h4"/><path d="M14 12h4"/>
    <rect x="2" y="8" width="20" height="9" rx="5"/>
  </svg>`;

const SUN_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2"/><path d="M12 20v2"/>
    <path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>
    <path d="M2 12h2"/><path d="M20 12h2"/>
    <path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
  </svg>`;

const MOON_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>`;

const SEARCH_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" aria-hidden="true">
    <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
  </svg>`;

const EMPTY_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">
    <path d="M4 6h16l-2 12H6L4 6z"/>
    <path d="M4 6l1.5-3h13L20 6"/>
    <path d="M9.5 10v3"/>
    <path d="M14.5 10v3"/>
  </svg>`;

// Vanilla JS: theme toggle (persisted), live name search, per-group
// collapsing. Written defensively — no assumptions about counts, and
// localStorage is wrapped so a sandboxed file:// context can't throw.
const SCRIPT = `
(function () {
  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
  var groups = Array.prototype.slice.call(document.querySelectorAll(".group"));
  var groupCards = groups.map(function (g) {
    return Array.prototype.slice.call(g.querySelectorAll(".card"));
  });
  var input = document.getElementById("search");
  var stats = document.getElementById("stats");
  var empty = document.getElementById("empty");
  var themeBtn = document.getElementById("themeToggle");
  var themeLabel = document.querySelector(".theme-btn-label");

  // ── Theme ──────────────────────────────────────────────────────────
  function applyTheme(t) {
    document.body.className = "theme-" + t;
    if (themeLabel) themeLabel.textContent = t === "dark" ? "Light mode" : "Dark mode";
    try { localStorage.setItem("gamelib-export-theme", t); } catch (e) {}
  }
  var stored = null;
  try { stored = localStorage.getItem("gamelib-export-theme"); } catch (e) {}
  applyTheme(
    stored === "light" || stored === "dark"
      ? stored
      : document.body.className.indexOf("theme-light") !== -1 ? "light" : "dark"
  );
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      applyTheme(document.body.className.indexOf("theme-light") !== -1 ? "dark" : "light");
    });
  }

  // ── Live search + group collapsing ─────────────────────────────────
  function update() {
    var q = (input.value || "").toLowerCase().trim();
    var total = cards.length;
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var name = cards[i].getAttribute("data-name") || "";
      var match = !q || name.indexOf(q) !== -1;
      cards[i].style.display = match ? "" : "none";
      if (match) shown++;
    }
    for (var gi = 0; gi < groups.length; gi++) {
      var shownInGroup = 0;
      for (var c = 0; c < groupCards[gi].length; c++) {
        if (groupCards[gi][c].style.display !== "none") shownInGroup++;
      }
      groups[gi].style.display = shownInGroup ? "" : "none";
      var badge = groups[gi].querySelector(".group-count");
      if (badge) badge.textContent = String(shownInGroup);
    }
    if (stats) {
      stats.textContent = "Showing " + shown + " of " + total + (total === 1 ? " game" : " games");
    }
    if (empty) empty.hidden = shown !== 0;
  }
  if (input) input.addEventListener("input", update);
})();
`;

const STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --font: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display",
           "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif;
    --ease: cubic-bezier(0.21, 0.61, 0.35, 1);
    --radius: 16px;
  }

  /* ── Palettes ───────────────────────────────────────────────────── */
  body.theme-dark {
    --bg: #0b0d12;
    --surface: #141821;
    --surface-2: #1a1f2b;
    --hairline: rgba(255, 255, 255, 0.075);
    --hairline-strong: rgba(255, 255, 255, 0.16);
    --text: #eceef4;
    --text-2: #a4abba;
    --text-3: #626b7d;
    --accent: #7c66ff;
    --accent-strong: #9d8bff;
    --accent-soft: rgba(124, 102, 255, 0.16);
    --chip: rgba(255, 255, 255, 0.05);
    --star: #f5b84d;
    --aurora:
      radial-gradient(980px 520px at 14% -12%, rgba(124, 102, 255, 0.22), transparent 62%),
      radial-gradient(820px 460px at 90% -16%, rgba(34, 211, 238, 0.10), transparent 60%),
      radial-gradient(760px 520px at 55% 112%, rgba(124, 102, 255, 0.12), transparent 62%);
    --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
    --grain-o: 0.05;
    --gloss: rgba(255, 255, 255, 0.07);
    --selection-bg: rgba(124, 102, 255, 0.45);
    --shadow-card: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 14px rgba(0, 0, 0, 0.3);
    --shadow-card-hover: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 2px 6px rgba(0, 0, 0, 0.35), 0 18px 48px rgba(0, 0, 0, 0.55);
    --shadow-chip: 0 6px 18px rgba(0, 0, 0, 0.35);
    --cover-a: #262c3d;
    --cover-b: #141821;
  }

  body.theme-light {
    --bg: #f4f5f9;
    --surface: #ffffff;
    --surface-2: #f1f3f8;
    --hairline: #e2e6ef;
    --hairline-strong: #cfd6e4;
    --text: #16181f;
    --text-2: #4c5464;
    --text-3: #8b94a6;
    --accent: #6d4fe8;
    --accent-strong: #5a3fd4;
    --accent-soft: rgba(109, 79, 232, 0.12);
    --chip: rgba(20, 22, 28, 0.045);
    --star: #e8a33d;
    --aurora:
      radial-gradient(980px 520px at 14% -12%, rgba(124, 102, 255, 0.14), transparent 62%),
      radial-gradient(820px 460px at 90% -16%, rgba(34, 211, 238, 0.10), transparent 60%),
      radial-gradient(760px 520px at 55% 112%, rgba(124, 102, 255, 0.08), transparent 62%);
    --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
    --grain-o: 0.03;
    --gloss: rgba(255, 255, 255, 0.45);
    --selection-bg: rgba(109, 79, 232, 0.28);
    --shadow-card: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 2px rgba(20, 22, 28, 0.05), 0 4px 14px rgba(20, 22, 28, 0.08);
    --shadow-card-hover: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 2px 6px rgba(20, 22, 28, 0.08), 0 18px 44px rgba(20, 22, 28, 0.16);
    --shadow-chip: 0 6px 18px rgba(20, 22, 28, 0.1);
    --cover-a: #dfe3ec;
    --cover-b: #cdd4e2;
  }

  html { color-scheme: dark; }
  body.theme-light { color-scheme: light; }

  body {
    font-family: var(--font);
    background-color: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    line-height: 1.5;
  }

  /* Film-grain overlay + aurora wash (fixed, non-interactive). */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background-image: var(--grain);
    background-size: 160px 160px;
    opacity: var(--grain-o);
  }
  body::after {
    content: "";
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 640px;
    z-index: 0;
    pointer-events: none;
    background: var(--aurora);
  }
  .wrap { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; padding: 44px 24px 64px; }

  ::selection { background: var(--selection-bg); color: var(--text); }

  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--hairline-strong);
    border-radius: 999px;
    border: 3px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--text-3);
    border: 3px solid transparent;
    background-clip: padding-box;
  }

  /* ── Hero ───────────────────────────────────────────────────────── */
  .hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand-mark {
    width: 54px;
    height: 54px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: 16px;
    background: linear-gradient(160deg, var(--surface-2), var(--surface));
    border: 1px solid var(--hairline);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), var(--shadow-card);
    color: var(--accent-strong);
    position: relative;
  }
  .brand-mark::after {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: radial-gradient(120% 120% at 15% 10%, var(--accent-soft), transparent 55%);
    pointer-events: none;
  }
  .eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent-strong);
  }
  h1 {
    margin-top: 6px;
    font-size: clamp(28px, 4.5vw, 40px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.05;
  }
  .hero-meta {
    margin-top: 10px;
    font-size: 13.5px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }

  .theme-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
    background: color-mix(in srgb, var(--surface) 72%, transparent);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 9px 16px;
    cursor: pointer;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: color 0.18s var(--ease), border-color 0.18s var(--ease), transform 0.18s var(--ease);
  }
  .theme-btn:hover { color: var(--text); border-color: var(--hairline-strong); transform: translateY(-1px); }
  .theme-btn:active { transform: translateY(0) scale(0.97); }
  .theme-btn svg { width: 15px; height: 15px; }
  .theme-btn .icon-sun { display: inline; }
  .theme-btn .icon-moon { display: none; }
  body.theme-dark .theme-btn .icon-sun { display: none; }
  body.theme-dark .theme-btn .icon-moon { display: inline; }

  /* ── Stat strip ─────────────────────────────────────────────────── */
  .stats-strip { display: flex; flex-wrap: wrap; gap: 12px; margin: 34px 0 26px; }
  .stat {
    flex: 1 1 140px;
    max-width: 220px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 14px 18px;
    background: color-mix(in srgb, var(--surface) 66%, transparent);
    border: 1px solid var(--hairline);
    border-radius: 14px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: var(--shadow-card);
  }
  .stat-value {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stat-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  /* ── Controls ───────────────────────────────────────────────────── */
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 26px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: 1;
    min-width: 220px;
    max-width: 400px;
    height: 44px;
    padding: 0 16px;
    background: color-mix(in srgb, var(--surface) 66%, transparent);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    color: var(--text-3);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: border-color 0.18s var(--ease), box-shadow 0.18s var(--ease), color 0.18s var(--ease);
  }
  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
    color: var(--accent-strong);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-family: inherit;
    font-size: 14px;
    color: var(--text);
  }
  .search input::placeholder { color: var(--text-3); }
  .search input::-webkit-search-cancel-button { opacity: 0.5; }
  .stats { font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }

  /* ── Groups ─────────────────────────────────────────────────────── */
  .group { margin-bottom: 44px; }
  .group:last-child { margin-bottom: 0; }
  .group-header {
    position: sticky;
    top: 14px;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 8px 16px 8px 13px;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    backdrop-filter: blur(14px) saturate(140%);
    -webkit-backdrop-filter: blur(14px) saturate(140%);
    box-shadow: var(--shadow-chip);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--text);
    width: fit-content;
  }
  .group-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pf, var(--accent));
    box-shadow: 0 0 10px var(--pf, transparent);
    flex-shrink: 0;
  }
  .group-name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group-count {
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent-strong);
    background: var(--accent-soft);
    border-radius: 999px;
    padding: 2px 9px;
  }

  /* ── Grid + cards ───────────────────────────────────────────────── */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
    gap: 20px;
  }
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, var(--surface-2), var(--surface));
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    overflow: hidden;
    transform: translateZ(0);
    box-shadow: var(--shadow-card);
    transition: transform 0.28s var(--ease), box-shadow 0.28s var(--ease), border-color 0.28s var(--ease);
    animation: riseIn 0.5s var(--ease) backwards;
  }
  .card:hover {
    transform: perspective(900px) rotateX(3.5deg) translateY(-7px) scale(1.02);
    border-color: var(--hairline-strong);
    box-shadow: var(--shadow-card-hover);
    z-index: 2;
  }
  /* Gloss sweep — a light band gliding diagonally across the card. */
  .card::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: linear-gradient(115deg, transparent 32%, var(--gloss) 46%, transparent 60%);
    transform: translateX(-130%);
    transition: transform 0.85s var(--ease);
  }
  .card:hover::after { transform: translateX(130%); }

  .cover {
    position: relative;
    aspect-ratio: 2 / 3;
    width: 100%;
    overflow: hidden;
    background: var(--cover-b);
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.5s var(--ease);
  }
  .card:hover .cover img { transform: scale(1.06); }
  .cover::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--hairline-strong);
    opacity: 0.5;
  }
  .cover--fallback {
    display: grid;
    place-items: center;
    background: linear-gradient(165deg, var(--cover-a), var(--cover-b));
  }
  .fallback-glyph {
    width: 74px;
    height: 74px;
    display: grid;
    place-items: center;
    border-radius: 22px;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--text-2);
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    border: 1px solid var(--hairline-strong);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 10px 24px rgba(0, 0, 0, 0.25);
  }

  .card-body {
    padding: 15px 15px 17px;
    display: flex;
    flex-direction: column;
    gap: 11px;
    flex: 1;
  }
  .card-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 39px;
  }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill {
    display: inline-flex;
    align-items: center;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
    background: var(--chip);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 3px 10px;
    white-space: nowrap;
  }
  .pill-platform::before {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--pf, var(--accent));
    flex-shrink: 0;
    margin-right: 6px;
  }
  .pill--accent {
    color: var(--accent-strong);
    border-color: color-mix(in srgb, var(--accent) 28%, transparent);
    background: var(--accent-soft);
  }

  /* Per-platform accent colours (dots on pills + group headers). */
  .pf-steam { --pf: #66c0f4; }
  .pf-gog { --pf: #e0535f; }
  .pf-epic { --pf: #a06de2; }
  .pf-local { --pf: #3ecf8e; }
  .pf-humble { --pf: #f7a928; }
  .pf-rockstar { --pf: #f0b429; }
  .pf-ubisoft { --pf: #5fa7e8; }
  .pf-other { --pf: var(--accent); }

  .genres { display: flex; flex-wrap: wrap; gap: 6px; }
  .genre {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-3);
    background: var(--chip);
    border: 1px solid var(--hairline);
    border-radius: 7px;
    padding: 2px 8px;
  }

  .rating { display: flex; align-items: center; gap: 10px; margin-top: auto; }
  .stars {
    color: var(--star);
    font-size: 14px;
    letter-spacing: 1.5px;
  }
  .igdb {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--text-2);
    background: var(--chip);
    border-radius: 6px;
    padding: 2px 8px;
  }

  /* ── Empty / footer ─────────────────────────────────────────────── */
  .empty {
    margin-top: 44px;
    padding: 72px 24px;
    text-align: center;
    border: 1px dashed var(--hairline-strong);
    border-radius: 20px;
    background: color-mix(in srgb, var(--surface) 40%, transparent);
    animation: riseIn 0.55s var(--ease) backwards;
  }
  .empty-icon {
    width: 72px;
    height: 72px;
    margin: 0 auto 18px;
    display: grid;
    place-items: center;
    border-radius: 20px;
    background: linear-gradient(160deg, var(--surface-2), var(--surface));
    border: 1px solid var(--hairline);
    box-shadow: var(--shadow-card);
    color: var(--text-3);
  }
  .empty h2 { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 8px; }
  .empty p { font-size: 13.5px; color: var(--text-3); max-width: 400px; margin: 0 auto; line-height: 1.6; }

  .footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--hairline);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--text-3);
  }
  .footer-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text-2); }
  .footer-brand svg { width: 14px; height: 14px; color: var(--accent-strong); }

  /* ── Motion ─────────────────────────────────────────────────────── */
  @keyframes riseIn {
    from { opacity: 0; transform: translateY(16px); }
  }
  .hero, .stats-strip, .controls, .footer { animation: riseIn 0.55s var(--ease) backwards; }

  @media (max-width: 640px) {
    .wrap { padding: 26px 16px 48px; }
    h1 { font-size: 26px; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(146px, 1fr)); gap: 14px; }
    .card-body { padding: 12px; }
    .card-title { font-size: 13.5px; min-height: 35px; }
    .stat { flex: 1 1 46%; max-width: none; }
    .group-header { position: static; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
    .card:hover { transform: none; }
    .card:hover .cover img { transform: none; }
    .card::after { transform: none; }
    .theme-btn:hover { transform: none; }
  }
`;

/**
 * Build the complete export HTML string.
 *
 * @param games   The games to include (already filtered/sorted per the
 *                user's scope choice; re-sorted here by `options.sort`).
 * @param options What to include + sort/theme/grouping preferences.
 * @param meta    Optional display strings for the shared page.
 */
export function buildLibraryExportHtml(
  games: Game[],
  options: LibraryExportOptions,
  meta?: ExportMeta,
): string {
  const opts: LibraryExportOptions = { ...LIBRARY_EXPORT_DEFAULTS, ...options };
  // Sort once; groups preserve that order within each section.
  const sorted = [...games].sort(makeSorter(opts.sort));
  return renderPage(sorted, opts, meta ?? {});
}
