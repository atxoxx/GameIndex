import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpDown,
  CalendarDays,
  Check,
  Heart,
  Pencil,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import StoreGameCard from "../components/store/StoreGameCard";
import { useWishlistContext } from "../context/WishlistContext";
import { requestShareToFriends } from "./friendSuggestionSignal";
import type { StoreGameSummary, WishlistEntry } from "../types/game";
import { Button, ConfirmModal, PageHeader, Panel, StatBand, SubTabs } from "../components/ui";
import PageWidget from "../components/PageWidget";
import { useLanguage } from "../context/LanguageContext";
import "../styles/page-wishlist.css";
import "../styles/wishlist.css";

type WishlistSort = "date_added" | "name" | "rating" | "release_date";
type WishlistGroup = "all" | "released" | "coming_soon";

const SORT_LABELS: Record<WishlistSort, string> = {
  date_added: "wishlist.sortDateAdded",
  name: "wishlist.sortNameAZ",
  rating: "wishlist.sortHighestRated",
  release_date: "wishlist.sortReleaseDate",
};

const WISHLIST_FILTERS_KEY = "gamelib_wishlist_filters_v1";

interface PersistedFilters {
  search: string;
  genres: string[];
  platforms: string[];
  sort: WishlistSort;
  group: WishlistGroup;
}

const DEFAULT_FILTERS: PersistedFilters = {
  search: "",
  genres: [],
  platforms: [],
  sort: "date_added",
  group: "all",
};

function parseStoredFilters(raw: unknown): PersistedFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_FILTERS;
  }
  const obj = raw as Record<string, unknown>;
  const sort: WishlistSort =
    obj.sort === "name" || obj.sort === "rating" || obj.sort === "release_date"
      ? obj.sort
      : "date_added";
  const group: WishlistGroup =
    obj.group === "released" || obj.group === "coming_soon"
      ? obj.group
      : "all";
  return {
    search: typeof obj.search === "string" ? obj.search : "",
    genres: Array.isArray(obj.genres)
      ? obj.genres.filter((g): g is string => typeof g === "string")
      : [],
    platforms: Array.isArray(obj.platforms)
      ? obj.platforms.filter((p): p is string => typeof p === "string")
      : [],
    sort,
    group,
  };
}

function isReleased(entry: WishlistEntry): boolean {
  if (!entry.firstReleaseDate) return false;
  const t = new Date(entry.firstReleaseDate).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

/**
 * WishlistPage: dedicated tab mounted at `/wishlist`. Reads its state from the
 * lifted `WishlistProvider` that wraps `<Routes>` in `App.tsx`, so the same
 * wishlist state tree is shared with `StorePage`'s cards. Users can:
 *
 *   - See all wishlisted games in a grid, grouped by released / coming soon.
 *   - Search, filter by genre/platform, and sort the list.
 *   - Attach a free-text note to each game (persisted locally).
 *   - Toggle hearts to remove items, or clear the whole list at once.
 *
 * Density is read from `DensityContext` (also lifted), so toggling the density
 * in the Store page updates this page automatically.
 */
export default function WishlistPage() {
  const navigate = useNavigate();
  const { wishlist, hydrated, toggle, setNote, clear } = useWishlistContext();
  const { t } = useLanguage();

  // ── Filter / sort state (persisted to localStorage) ──────────────────
  const [filters, setFilters] = useState<PersistedFilters>(() => {
    try {
      const raw = localStorage.getItem(WISHLIST_FILTERS_KEY);
      if (raw) return parseStoredFilters(JSON.parse(raw));
    } catch {
      /* corrupt or unavailable */
    }
    return DEFAULT_FILTERS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(WISHLIST_FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* storage may throw in private mode */
    }
  }, [filters]);

  const setSearch = useCallback(
    (search: string) => setFilters((f) => ({ ...f, search })),
    []
  );
  const setSort = useCallback(
    (sort: WishlistSort) => setFilters((f) => ({ ...f, sort })),
    []
  );
  const setGroup = useCallback(
    (group: WishlistGroup) => setFilters((f) => ({ ...f, group })),
    []
  );
  const toggleGenre = useCallback(
    (g: string) =>
      setFilters((f) => ({
        ...f,
        genres: f.genres.includes(g)
          ? f.genres.filter((x) => x !== g)
          : [...f.genres, g],
      })),
    []
  );
  const togglePlatform = useCallback(
    (p: string) =>
      setFilters((f) => ({
        ...f,
        platforms: f.platforms.includes(p)
          ? f.platforms.filter((x) => x !== p)
          : [...f.platforms, p],
      })),
    []
  );
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);
  const clearFacetFilters = useCallback(
    () => setFilters((f) => ({ ...f, genres: [], platforms: [] })),
    []
  );

  // ── Derived facet lists from the current wishlist ────────────────────
  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (const e of wishlist) for (const g of e.genres ?? []) if (g) set.add(g);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [wishlist]);

  const genreCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of wishlist)
      for (const g of e.genres ?? []) if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    return counts;
  }, [wishlist]);

  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const e of wishlist)
      for (const p of e.platforms ?? []) if (p) set.add(p);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [wishlist]);

  const platformCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of wishlist)
      for (const p of e.platforms ?? []) if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    return counts;
  }, [wishlist]);

  const activeFacetCount = filters.genres.length + filters.platforms.length;

  // ── Filter + sort the list ───────────────────────────────────────────
  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const genreFilterSet =
      filters.genres.length > 0
        ? new Set(filters.genres.map((g) => g.toLowerCase()))
        : null;
    const platformFilterSet =
      filters.platforms.length > 0
        ? new Set(filters.platforms.map((p) => p.toLowerCase()))
        : null;

    let list = wishlist.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (genreFilterSet) {
        if (!e.genres || !e.genres.some((g) => genreFilterSet.has(g.toLowerCase()))) {
          return false;
        }
      }
      if (platformFilterSet) {
        if (!e.platforms || !e.platforms.some((p) => platformFilterSet.has(p.toLowerCase()))) {
          return false;
        }
      }
      if (filters.group === "released" && !isReleased(e)) return false;
      if (filters.group === "coming_soon" && isReleased(e)) return false;
      return true;
    });

    list = [...list];
    switch (filters.sort) {
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "rating":
        list.sort(
          (a, b) => (b.rating ?? b.aggregatedRating ?? 0) - (a.rating ?? a.aggregatedRating ?? 0)
        );
        break;
      case "release_date": {
        const releaseTimes = new Map<string, number>();
        for (const e of list) {
          releaseTimes.set(
            e.slug,
            e.firstReleaseDate ? new Date(e.firstReleaseDate).getTime() : 0
          );
        }
        list.sort((a, b) => (releaseTimes.get(b.slug) ?? 0) - (releaseTimes.get(a.slug) ?? 0));
        break;
      }
      case "date_added":
      default:
        list.sort((a, b) => b.addedAt - a.addedAt);
        break;
    }
    return list;
  }, [wishlist, filters]);

  const releasedCount = useMemo(
    () => wishlist.filter((e) => isReleased(e)).length,
    [wishlist]
  );

  const noteCount = useMemo(
    () => wishlist.filter((e) => (e.note ?? "").trim().length > 0).length,
    [wishlist]
  );

  // ── Clear-wishlist confirm dialog ────────────────────────────────────
  const [confirmClear, setConfirmClear] = useState(false);
  const handleClear = useCallback(() => {
    clear();
    setConfirmClear(false);
  }, [clear]);

  const handleCardClick = (game: StoreGameSummary) => {
    navigate(`/store/${game.slug}`);
  };

  const handleBrowseStore = () => {
    navigate("/store");
  };

  // ── Filters popover (genres / platforms) ─────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) {
        setFiltersOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen]);

  return (
    <div className="wishlist-page page">
      <PageWidget page="wishlist" widget="wishlistHeader">
        <div className="ui-item-wishlistHeader wl-head">
          <PageHeader
            eyebrow={t("wishlist.eyebrow")}
            title={t("wishlist.title")}
            description={t("wishlist.description")}
            icon={<Heart size={22} />}
            actions={
              wishlist.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 size={14} />}
                  onClick={() => setConfirmClear(true)}
                >
                  {t("wishlist.clearAll")}
                </Button>
              )
            }
          />

          {wishlist.length > 0 && (
            <StatBand
              className="wl-stats"
              ariaLabel={t("wishlist.statsAria")}
              items={[
                {
                  id: "saved",
                  label: t("wishlist.stats.saved"),
                  value: wishlist.length,
                  icon: <Heart size={14} />,
                },
                {
                  id: "out",
                  label: t("wishlist.stats.outNow"),
                  value: releasedCount,
                  tone: "success",
                  icon: <Check size={14} />,
                },
                {
                  id: "upcoming",
                  label: t("wishlist.stats.comingSoon"),
                  value: wishlist.length - releasedCount,
                  tone: "accent",
                  icon: <CalendarDays size={14} />,
                },
                {
                  id: "notes",
                  label: t("wishlist.stats.withNotes"),
                  value: noteCount,
                  icon: <Pencil size={14} />,
                },
              ]}
            />
          )}
        </div>
      </PageWidget>

      {wishlist.length === 0 ? (
        <Panel
          className="wl-empty"
          role="status"
          aria-live="polite"
        >
          <Heart size={26} className="wl-empty__icon" aria-hidden="true" />
          {hydrated ? (
            <>
              <strong>{t("wishlist.noGames")}</strong>
              <p>{t("wishlist.noGamesHint")}</p>
              <Button
                variant="primary"
                rightIcon={<ArrowRight size={15} />}
                onClick={handleBrowseStore}
              >
                {t("wishlist.browseStore")}
              </Button>
            </>
          ) : (
            <p>{t("wishlist.loading")}</p>
          )}
        </Panel>
      ) : (
        <>
          {/* ── Toolbar ─────────────────────────────────────────────── */}
          <PageWidget page="wishlist" widget="wishlistToolbar">
          <div className="ui-item-wishlistToolbar wl-controls">
            <div className="wl-controls__row">
              <div className="wl-search">
                <Search size={15} className="wl-search__icon" aria-hidden="true" />
                <input
                  type="text"
                  value={filters.search}
                  placeholder={t("wishlist.searchPlaceholder")}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("wishlist.searchPlaceholder")}
                />
                {filters.search && (
                  <button
                    type="button"
                    className="wl-search__clear"
                    onClick={() => setSearch("")}
                    aria-label={t("wishlist.clearSearch")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="wl-controls__end">
              {(availableGenres.length > 0 || availablePlatforms.length > 0) && (
                <PageWidget page="wishlist" widget="filters">
                <div className="wishlist-filter-wrap ui-complete-only ui-item-filters" ref={filtersRef}>
                  <button
                    type="button"
                    className={`wishlist-filter-btn${activeFacetCount > 0 ? " active" : ""}`}
                    onClick={() => setFiltersOpen((v) => !v)}
                    aria-expanded={filtersOpen}
                    aria-haspopup="dialog"
                    aria-label={t("wishlist.filtersAria")}
                  >
                    <SlidersHorizontal size={14} aria-hidden="true" />
                    {t("wishlist.filters")}
                    {activeFacetCount > 0 && (
                      <span className="wishlist-filter-badge">{activeFacetCount}</span>
                    )}
                  </button>

                  {filtersOpen && (
                    <div
                      className="wishlist-filter-popover"
                      role="dialog"
                      aria-label={t("wishlist.filters")}
                    >
                      {availableGenres.length > 0 && (
                        <div className="wishlist-filter-section">
                          <h4>{t("wishlist.genres")}</h4>
                          <div className="wishlist-filter-options">
                            {availableGenres.map((g) => (
                              <button
                                key={`g-${g}`}
                                type="button"
                                className={`wishlist-filter-option${
                                  filters.genres.includes(g) ? " active" : ""
                                }`}
                                onClick={() => toggleGenre(g)}
                                aria-pressed={filters.genres.includes(g)}
                              >
                                <span className="wishlist-filter-option-name">{g}</span>
                                <span className="wishlist-filter-option-count">
                                  {genreCounts.get(g) ?? 0}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {availablePlatforms.length > 0 && (
                        <div className="wishlist-filter-section">
                          <h4>{t("wishlist.platforms")}</h4>
                          <div className="wishlist-filter-options">
                            {availablePlatforms.map((p) => (
                              <button
                                key={`p-${p}`}
                                type="button"
                                className={`wishlist-filter-option${
                                  filters.platforms.includes(p) ? " active" : ""
                                }`}
                                onClick={() => togglePlatform(p)}
                                aria-pressed={filters.platforms.includes(p)}
                              >
                                <span className="wishlist-filter-option-name">{p}</span>
                                <span className="wishlist-filter-option-count">
                                  {platformCounts.get(p) ?? 0}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeFacetCount > 0 && (
                        <div className="wishlist-filter-footer">
                          <button
                            type="button"
                            className="wishlist-filter-clear"
                            onClick={clearFacetFilters}
                          >
                            {t("wishlist.clearFilters")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                </PageWidget>
              )}

              <label className="wl-sort">
                <ArrowUpDown size={14} className="wl-sort__icon" aria-hidden="true" />
                <select
                  value={filters.sort}
                  onChange={(e) => setSort(e.target.value as WishlistSort)}
                  aria-label={t("wishlist.sortAria")}
                >
                  {(Object.keys(SORT_LABELS) as WishlistSort[]).map((s) => (
                    <option key={s} value={s}>
                      {t(SORT_LABELS[s])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            </div>

            <SubTabs
              className="wl-subtabs"
              ariaLabel={t("wishlist.groupByStatus")}
              value={filters.group}
              onChange={(id) => setGroup(id as WishlistGroup)}
              items={[
                { id: "all", label: t("wishlist.all"), count: wishlist.length },
                { id: "released", label: t("wishlist.outNow"), count: releasedCount },
                {
                  id: "coming_soon",
                  label: t("wishlist.comingSoon"),
                  count: wishlist.length - releasedCount,
                },
              ]}
              trailing={
                <span className="wl-result-count">
                  {t("wishlist.showing", {
                    visible: visible.length,
                    total: wishlist.length,
                  })}
                </span>
              }
            />
          </div>
          </PageWidget>

          {/* ── Grid ──────────────────────────────────────────────── */}
          {visible.length === 0 ? (
            <Panel className="wl-empty wl-empty--compact" role="status" aria-live="polite">
              <strong>{t("wishlist.noMatches")}</strong>
              <p>{t("wishlist.noMatchesHint")}</p>
              <Button variant="secondary" onClick={resetFilters}>
                {t("wishlist.clearFilters")}
              </Button>
            </Panel>
          ) : (
            <PageWidget page="wishlist" widget="wishlistGrid">
              <div className="wishlist-page-grid ui-item-wishlistGrid">
                {visible.map((entry) => (
                  <WishlistCard
                    key={entry.slug}
                    entry={entry}
                    onOpen={() => handleCardClick(entry)}
                    onToggle={() => toggle(entry)}
                    onNoteChange={(note) => setNote(entry.slug, note)}
                  />
                ))}
              </div>
            </PageWidget>
          )}
        </>
      )}

      <ConfirmModal
        open={confirmClear}
        title={t("wishlist.clearTitle")}
        message={t("wishlist.clearBody", {
          count: wishlist.length,
          plural: wishlist.length !== 1 ? "s" : "",
        })}
        confirmLabel={t("wishlist.clearAll")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

/**
 * WishlistCard: a `StoreGameCard` augmented with the "added on" date and an
 * inline note editor. The note is local to the card while editing and flushed
 * up via `onNoteChange` (which persists through `WishlistContext.setNote`).
 */
function WishlistCard({
  entry,
  onOpen,
  onToggle,
  onNoteChange,
}: {
  entry: WishlistEntry;
  onOpen: () => void;
  onToggle: () => void;
  onNoteChange: (note: string) => void;
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const shareToFriends = () => {
    requestShareToFriends({
      gameId: entry.slug,
      gameName: entry.name,
      coverUrl: entry.coverUrl,
    });
    navigate("/friends");
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note ?? "");
  const [expanded, setExpanded] = useState(false);

  // Keep the draft in sync if the entry note changes externally.
  useEffect(() => {
    if (!editing) setDraft(entry.note ?? "");
  }, [entry.note, editing]);

  const saveNote = useCallback(() => {
    onNoteChange(draft);
    setEditing(false);
    setExpanded(false);
  }, [draft, onNoteChange]);

  const addedLabel = useMemo(() => {
    const d = new Date(entry.addedAt);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [entry.addedAt]);

  // ── Release date + live "time until release" countdown ────────────────
  const release = useMemo(() => {
    if (!entry.firstReleaseDate) return null;
    const date = new Date(entry.firstReleaseDate);
    if (!Number.isFinite(date.getTime())) return null;
    const released = date.getTime() <= Date.now();
    return {
      date,
      released,
      label: date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    };
  }, [entry.firstReleaseDate]);

  // Tick every minute so the countdown stays fresh without thrashing.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (release?.released) return;
    const id = setInterval(() => {
      // Day/hour countdown doesn't need to tick in a hidden tab.
      if (document.hidden) return;
      setNow(Date.now());
    }, 60_000);
    return () => clearInterval(id);
  }, [release?.released]);

  const countdown = useMemo(() => {
    if (!release || release.released) return null;
    let diff = Math.max(0, release.date.getTime() - now);
    const days = Math.floor(diff / 86_400_000);
    diff -= days * 86_400_000;
    const hours = Math.floor(diff / 3_600_000);
    diff -= hours * 3_600_000;
    const minutes = Math.floor(diff / 60_000);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }, [release, now]);

  const showFullNote = expanded || draft.length <= 120;

  return (
    <div className="wishlist-card-wrap wishlist-card-wrap--brand">
      <StoreGameCard
        game={entry}
        wishlisted
        onClick={onOpen}
        onToggleWishlist={(game) => {
          // StoreGameCard passes the game; we just need the toggle behavior.
          onToggle();
          void game;
        }}
      />
      <div className="wishlist-card-meta">
          <span className="wishlist-added-date" title={t("wishlist.addedOn", { date: addedLabel })}>
            {t("wishlist.addedOn", { date: addedLabel })}
          </span>
        <button
          type="button"
          className="wishlist-share-btn"
          onClick={shareToFriends}
          title={t("wishlist.shareWithFriends")}
        >
          <Share2 size={14} aria-hidden="true" />
          {t("wishlist.shareToFriends")}
        </button>
      </div>

      {release && (
        <div
          className={`wishlist-release${release.released ? " released" : ""}`}
          title={
            release.released
              ? t("wishlist.releasedAria", { date: release.label })
              : t("wishlist.releasesAria", { date: release.label })
          }
        >
          <span className="wishlist-release-icon" aria-hidden="true">
            <CalendarDays size={14} />
          </span>
          <span className="wishlist-release-text">
            {release.released ? (
              <span className="wishlist-release-out">{t("wishlist.outNowLabel")}</span>
            ) : (
              <>
                <span className="wishlist-release-count">{countdown}</span>
                <span className="wishlist-release-date">{release.label}</span>
              </>
            )}
          </span>
        </div>
      )}

      <div className="wishlist-note">
        {editing ? (
          <div className="wishlist-note-editor">
            <textarea
              value={draft}
              placeholder={t("wishlist.notePlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(entry.note ?? "");
                  setEditing(false);
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  saveNote();
                }
              }}
              autoFocus
              rows={3}
              aria-label={t("wishlist.noteForAria", { name: entry.name })}
            />
            <div className="wishlist-note-actions">
              <button
                type="button"
                className="wishlist-note-cancel"
                onClick={() => {
                  setDraft(entry.note ?? "");
                  setEditing(false);
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="wishlist-note-save"
                onClick={saveNote}
              >
                {t("wishlist.saveNote")}
              </button>
            </div>
          </div>
        ) : entry.note ? (
          <div className="wishlist-note-view-row">
            <button
              type="button"
              className="wishlist-note-view"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <span className="wishlist-note-text">
                {showFullNote ? entry.note : `${entry.note.slice(0, 120)}…`}
              </span>
            </button>
            <button
              type="button"
              className="wishlist-note-edit"
              onClick={() => {
                setDraft(entry.note ?? "");
                setEditing(true);
              }}
              aria-label={t("wishlist.editNoteLabel", { name: entry.name })}
              title={t("wishlist.editNote")}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="wishlist-note-add"
            onClick={() => setEditing(true)}
          >
            <Plus size={14} aria-hidden="true" />
            {t("wishlist.addNote")}
          </button>
        )}
      </div>
    </div>
  );
}
