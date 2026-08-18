import { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";
import { useLanguage } from "../../context/LanguageContext";
import type { StoreGameSummary } from "../../types/game";
import type { Friend } from "./friendsTypes";
import {
  displayName,
  getInitials,
  getProceduralAvatarStyle,
  isAppBlacklisted,
  safeCurrentlyPlaying,
} from "../../pages/friendsStorage";

export {
  displayName,
  getInitials,
  getProceduralAvatarStyle,
  isAppBlacklisted,
  safeCurrentlyPlaying,
};

// ── Formatting Helpers ──────────────────────────────────────────────

export function formatHours(totalMinutes: number, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!totalMinutes || totalMinutes <= 0) return t("friendsPage.hoursZero");
  const h = Math.floor(totalMinutes / 60);
  if (h >= 1000) return t("friendsPage.hoursK", { h: (h / 1000).toFixed(1) });
  return t("friendsPage.hoursH", { h });
}

export function formatDateTime(dateTimeStr: string, tz?: string): string {
  try {
    const d = new Date(dateTimeStr);
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    if (tz) {
      try {
        opts.timeZone = tz;
      } catch {
        /* invalid tz — fall back to local */
      }
    }
    return d.toLocaleString(undefined, opts);
  } catch {
    return dateTimeStr;
  }
}

export function tzAbbrev(dateTimeStr: string, tz?: string): string {
  if (!tz) return "";
  try {
    const d = new Date(dateTimeStr);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(d);
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    return name ? ` (${name})` : "";
  } catch {
    return "";
  }
}

export function sessionsConflict(
  a: { id?: string; scheduledAt: string; durationMin?: number },
  b: { id?: string; scheduledAt: string; durationMin?: number }
): boolean {
  if (a.id && b.id && a.id === b.id) return false;
  const startA = new Date(a.scheduledAt).getTime();
  const startB = new Date(b.scheduledAt).getTime();
  if (Number.isNaN(startA) || Number.isNaN(startB)) return false;
  const endA = startA + (a.durationMin || 120) * 60_000;
  const endB = startB + (b.durationMin || 120) * 60_000;
  return startA < endB && startB < endA;
}

export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Next occurrence of a recurring session on/after `afterMs`, formatted as a
 * datetime-local string (matching GameSession.scheduledAt). Returns null when
 * the rule is exhausted (past `until`) or the base date is invalid.
 */
export function nextOccurrence(
  baseIso: string,
  recurrence: { frequency: "daily" | "weekly" | "monthly"; until?: string },
  afterMs: number
): string | null {
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return null;
  const until = recurrence.until ? new Date(recurrence.until).getTime() : Infinity;
  if (!Number.isFinite(until)) return null;

  const d = new Date(base);
  let guard = 0;
  while (d.getTime() < afterMs && guard < 1200) {
    if (recurrence.frequency === "daily") d.setDate(d.getDate() + 1);
    else if (recurrence.frequency === "weekly") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    guard++;
  }
  if (d.getTime() < afterMs || d.getTime() > until) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Reads an image file, downsizes it to a bounded data URL so it can travel in
 * the outbox, and returns a DmAttachment. Rejects files over 8MB and anything
 * that fails to decode as an image.
 */
export function fileToImageAttachment(file: File): Promise<{ id: string; name: string; mimeType: string; dataUrl: string } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          resolve({
            id: `att_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            name: file.name || "image.png",
            mimeType: "image/jpeg",
            dataUrl: canvas.toDataURL("image/jpeg", 0.75),
          });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = ev.target?.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function countdownLabel(targetIso: string, t: (key: string, vars?: Record<string, unknown>) => string): string {
  const diff = new Date(targetIso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "";
  if (diff <= 0) return t("friendsPage.nowLive");
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t("friendsPage.countdownMin", { m: mins });
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) {
    return remMin > 0
      ? t("friendsPage.countdownHourMin", { h: hours, m: remMin })
      : t("friendsPage.countdownHour", { h: hours });
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0
    ? t("friendsPage.countdownDayHour", { d: days, h: remH })
    : t("friendsPage.countdownDay", { d: days });
}

export function formatLastSeen(epochSecs: number | undefined, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!epochSecs) return t("friendsPage.formatNever");
  const diffSecs = Math.floor(Date.now() / 1000) - epochSecs;
  if (diffSecs < 60) return t("friendsPage.formatJustNow");
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return t("friendsPage.minutesAgo", { m: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("friendsPage.hoursAgo", { h: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("friendsPage.daysAgo", { d: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("friendsPage.monthsAgo", { m: months });
  return t("friendsPage.yearsAgo", { y: Math.floor(months / 12) });
}

export function formatFriendsSince(addedAt: number | undefined, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!addedAt) return "";
  const days = Math.floor((Date.now() - addedAt) / 86_400_000);
  if (days < 1) return t("friendsPage.formatFriendsSinceToday");
  if (days < 30) {
    return t(days === 1 ? "friendsPage.friendsForDay" : "friendsPage.friendsForDays", { count: days });
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return t(months === 1 ? "friendsPage.friendsForMonth" : "friendsPage.friendsForMonths", { count: months });
  }
  const years = Math.floor(months / 12);
  return t(years > 1 || months >= 24 ? "friendsPage.friendsForYears" : "friendsPage.friendsForYear", { count: years });
}

/**
 * A friend counts as online when they're in a game, their status says so, or
 * their presence heartbeat (`lastActive`) is under ~3 minutes old. An explicit
 * "Offline" status wins over a stale heartbeat.
 */
export function isOnline(friend: Friend): boolean {
  const status = (friend.status || "").toLowerCase();
  if (safeCurrentlyPlaying(friend.currentlyPlaying)) return true;
  if (status.includes("offline")) return false;
  if (status.includes("online") || status.includes("playing")) return true;
  if (friend.lastActive && Math.floor(Date.now() / 1000) - friend.lastActive < 180) return true;
  return false;
}

export function presenceLabel(friend: Friend, t: (key: string, vars?: Record<string, unknown>) => string): string {
  const playing = safeCurrentlyPlaying(friend.currentlyPlaying);
  if (playing) return t("friendsPage.playingGame", { game: playing });
  if (isOnline(friend)) return t("friendsPage.formatOnline");
  return "";
}

export function sharedGamesCount(friend: Friend, myGameIds: Set<string>): number {
  if (!friend.games || friend.games.length === 0) return 0;
  let count = 0;
  for (const g of friend.games) {
    if (isAppBlacklisted(g.name, g.id)) continue;
    if (myGameIds.has(g.id)) count++;
  }
  return count;
}

// ── QR Code Component ───────────────────────────────────────────────

export function FriendCodeQR({ code }: { code: string }) {
  const { t } = useLanguage();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(code, { margin: 1, width: 160, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!dataUrl) return null;
  return <img src={dataUrl} alt={t("friends.friendQrCode")} className="friend-qr-img" width={160} height={160} />;
}

// ── Searchable Game Selector Component ──────────────────────────────

export function SearchableGameSelector({
  games,
  selectedGameId,
  onSelect,
  placeholder,
}: {
  games: any[];
  selectedGameId: string;
  onSelect: (gameId: string) => void;
  placeholder?: string;
}) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return games.slice(0, 10);
    return games.filter((g) => g.name.toLowerCase().includes(query));
  }, [games, searchQuery]);

  const selectedGame = useMemo(() => games.find((g) => g.id === selectedGameId), [games, selectedGameId]);

  if (selectedGame) {
    return (
      <div className="selected-game-display-card searchable-game-selector__selected">
        <div className="selected-game-details">
          <div className="selected-game-thumb">
            {selectedGame.name.slice(0, 2).toUpperCase()}
          </div>
          <span className="selected-game-title">{selectedGame.name}</span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn--mini"
          onClick={() => onSelect("")}
        >
          {t("common.change")}
        </button>
      </div>
    );
  }

  return (
    <div className="searchable-game-selector" ref={containerRef}>
      <div className="game-search-input-wrapper">
        <input
          type="text"
          className="game-search-input"
          placeholder={placeholder ?? t("friends.typeGameName")}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
        {searchQuery && (
          <button
            type="button"
            className="game-search-clear-btn"
            onClick={() => setSearchQuery("")}
            title={t("friends.clearText")}
          >
            ×
          </button>
        )}
      </div>

      {isOpen && (
        <div className="game-search-results">
          {filteredGames.length === 0 ? (
            <div className="game-search-no-results">{t("friends.noMatchesLibrary")}</div>
          ) : (
            filteredGames.map((game) => (
              <button
                key={game.id}
                type="button"
                className="game-search-item"
                onClick={() => {
                  onSelect(game.id);
                  setSearchQuery("");
                  setIsOpen(false);
                }}
              >
                <div className="game-search-item-thumb">
                  {game.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="game-search-item-name">{game.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Unified Game Picker Component ───────────────────────────────────

export function GamePicker({
  libraryGames,
  friends,
  selectedGameId,
  selectedGameName,
  onSelect,
}: {
  libraryGames: any[];
  friends: Friend[];
  selectedGameId: string;
  selectedGameName: string;
  onSelect: (game: { id: string; name: string }) => void;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<"library" | "friend" | "store">("library");
  const [friendId, setFriendId] = useState("");
  const [search, setSearch] = useState("");
  const [storeResults, setStoreResults] = useState<StoreGameSummary[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (mode !== "store" || !search.trim()) {
      setStoreResults([]);
      return;
    }
    const q = search.trim();
    const timer = setTimeout(async () => {
      setStoreLoading(true);
      try {
        const res = await invoke<StoreGameSummary[]>("search_store_games", { query: q, offset: 0, limit: 12 });
        setStoreResults(res || []);
      } catch {
        setStoreResults([]);
      } finally {
        setStoreLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [mode, search]);

  const selectedFriend = friends.find((f) => f.id === friendId);
  const friendLibGames = (selectedFriend?.games || []).filter((g) => !isAppBlacklisted(g.name, g.id));

  const baseList =
    mode === "friend"
      ? friendLibGames.map((g) => ({ id: g.id, name: g.name }))
      : libraryGames.map((g) => ({ id: g.id, name: g.name }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (mode !== "library" && mode !== "friend") return baseList;
    if (!q) return baseList.slice(0, 12);
    return baseList.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 12);
  }, [baseList, search, mode]);

  const libraryCoverById = useMemo(() => {
    const m = new Map<string, string>();
    (libraryGames as any[]).forEach((g) => {
      if (g && g.coverArtUrl) m.set(String(g.id), g.coverArtUrl);
    });
    return m;
  }, [libraryGames]);

  const storeCoverById = useMemo(() => {
    const m = new Map<string, string>();
    storeResults.forEach((g) => {
      if (g && g.coverUrl) m.set(`store_${g.id}`, g.coverUrl);
    });
    return m;
  }, [storeResults]);

  const coverFor = (id: string): string | undefined => libraryCoverById.get(id) || storeCoverById.get(id);

  const GameCover = ({ id, name, className }: { id: string; name: string; className?: string }) => {
    const cover = coverFor(id);
    if (cover) {
      return <img src={cover} alt={name} className={className} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />;
    }
    return <div className={className}>{name.slice(0, 2).toUpperCase()}</div>;
  };

  if (selectedGameId) {
    return (
      <div className="selected-game-display-card">
        <div className="selected-game-details">
          <GameCover id={selectedGameId} name={selectedGameName} className="selected-game-thumb" />
          <span className="selected-game-title">{selectedGameName}</span>
        </div>
        <button type="button" className="btn btn-secondary btn--mini" onClick={() => onSelect({ id: "", name: "" })}>
          {t("common.change")}
        </button>
      </div>
    );
  }

  return (
    <div className="game-picker" ref={containerRef}>
      <div className="game-picker-modes">
        <button type="button" className={`picker-mode${mode === "library" ? " active" : ""}`} onClick={() => { setMode("library"); setIsOpen(true); }}>{t("friends.myLibrary")}</button>
        <button type="button" className={`picker-mode${mode === "friend" ? " active" : ""}`} onClick={() => { setMode("friend"); setIsOpen(true); }}>{t("friends.friendsLibrary")}</button>
        <button type="button" className={`picker-mode${mode === "store" ? " active" : ""}`} onClick={() => { setMode("store"); setIsOpen(true); }}>{t("friends.storeSearch")}</button>
      </div>

      {mode === "friend" && (
        <select className="profile-input" value={friendId} onChange={(e) => setFriendId(e.target.value)}>
          <option value="">{t("friends.selectFriend")}</option>
          {friends.map((f) => (
            <option key={f.id} value={f.id}>{displayName(f)}</option>
          ))}
        </select>
      )}

      <div className="game-search-input-wrapper">
        <input
          type="text"
          className="game-search-input"
          placeholder={mode === "store" ? t("friends.searchStoreCatalog") : t("friends.searchGamesPlaceholder")}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
        />
        {search && (
          <button type="button" className="game-search-clear-btn" onClick={() => setSearch("")} title={t("common.clear")}>×</button>
        )}
      </div>

      {isOpen && (
        <div className="game-search-results">
          {mode === "store" ? (
            storeLoading ? (
              <div className="game-search-no-results">{t("friends.searchingStore")}</div>
            ) : storeResults.length === 0 ? (
              <div className="game-search-no-results">{search.trim() ? t("friends.noStoreMatches") : t("friendsPage.noStoreMatches")}</div>
            ) : (
              storeResults.map((g) => (
                <button key={g.id} type="button" className="game-search-item" onClick={() => { onSelect({ id: `store_${g.id}`, name: g.name }); setSearch(""); setIsOpen(false); }}>
                  <GameCover id={`store_${g.id}`} name={g.name} className="game-search-item-thumb" />
                  <span className="game-search-item-name">{g.name}</span>
                </button>
              ))
            )
          ) : filtered.length === 0 ? (
            <div className="game-search-no-results">{mode === "friend" && !friendId ? t("friends.pickFriendFirst") : t("friendsPage.noMatchesFound")}</div>
          ) : (
            filtered.map((g) => (
              <button key={g.id} type="button" className="game-search-item" onClick={() => { onSelect(g); setSearch(""); setIsOpen(false); }}>
                <GameCover id={g.id} name={g.name} className="game-search-item-thumb" />
                <span className="game-search-item-name">{g.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── SVG Icons ───────────────────────────────────────────────────────

export function UsersIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function UserIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function CalendarIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function RecommendIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

export function SuggestionIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <circle cx="12" cy="14.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function CompareIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function LeaderboardIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

export function TrashIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  );
}

export function P2pSyncIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M16 3h5v5" />
      <path d="M8 21H3v-5" />
      <path d="M12 22v-3a3 3 0 0 0-3-3H6" />
      <path d="M12 2v3a3 3 0 0 0 3 3h3" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ThreeDotsIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

export function MessageIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function PinIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M12 17v5" />
      <path d="M9 3h6v3l-1.5 2v4l2 2H8.5l2-2V6L9 3Z" />
    </svg>
  );
}

export function PencilIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

export function BlockIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

export function StarIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function TrophyIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

export function GamepadIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <line x1="6" y1="12" x2="10" y2="12" />
      <line x1="8" y1="10" x2="8" y2="14" />
      <line x1="15" y1="13" x2="15.01" y2="13" />
      <line x1="18" y1="11" x2="18.01" y2="11" />
      <rect x="2" y="6" width="20" height="12" rx="2" />
    </svg>
  );
}

export function MapPinIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function ClockIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function ThumbsUpIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

export function HeartIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

export function FireIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function TagIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42Z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

export function LightbulbIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

export function BarChartIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function HandshakeIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </svg>
  );
}

export function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function SendIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export function PaperclipIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function SmileIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

export function PlayIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

export function EditIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}

export function RepeatIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export function VoteIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function PlusIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function ActivityIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

export function NoteIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
