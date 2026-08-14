import { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAchievements } from "../context/AchievementContext";
import { useGames } from "../context/GameContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useFocusable } from "../hooks/useFocusable";
import {
  type Game,
  type Achievement,
  type AchievementSource,
  type AchievementRarity,
  getAchievementRarity,
  RARITY_COLORS,
} from "../types/game";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { Button, ConfirmModal } from "./ui";
import AchievementSourceBadge from "./achievements/AchievementSourceBadge";
import ManualLinkModal from "./achievements/ManualLinkModal";
import ManualUnlockEditorModal from "./achievements/ManualUnlockEditorModal";
import RetroLinkModal from "./achievements/RetroLinkModal";

type SortKey = "default" | "name" | "rarity" | "unlockDate";
type FilterKey = "all" | "unlocked" | "locked";

const RARITY_TIERS: readonly AchievementRarity[] = [
  "common",
  "uncommon",
  "rare",
  "ultra_rare",
];

export default function AchievementsTab({ game }: { game: Game }) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const {
    getGameAchievements,
    syncGameAchievements,
    syncLocalAchievements,
    syncRetroAchievements,
    syncManualAchievements,
    syncGogAchievements,
    syncEpicAchievements,
    removeManualLink,
    getRetroSettings,
    links,
    isSyncing,
  } = useAchievements();
  const { updateGame } = useGames();
  const { showToast } = useToast();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [syncing, setSyncing] = useState(false);
  // Auto-load state: try to populate the achievement list for any game
  // (resolving a Steam AppID by name when the game doesn't have one).
  const [autoState, setAutoState] = useState<"idle" | "loading" | "noappid" | "done">(
    "idle"
  );
  const autoTriedRef = useRef<string | null>(null);
  const linkedSyncRef = useRef<string | null>(null);

  // Modal + unlink-confirm state.
  const [showManualLink, setShowManualLink] = useState(false);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [showRetroLink, setShowRetroLink] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const achievementData = getGameAchievements(game.id);
  const achievements = achievementData?.achievements ?? [];
  const total = achievementData?.total ?? 0;
  const unlocked = achievementData?.unlocked ?? 0;
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  const source: AchievementSource = achievementData?.source ?? "steam";

  const manualLink = useMemo(
    () => (links[game.id] ?? []).find((l) => l.source === "manual") ?? null,
    [links, game.id]
  );

  /** Sources this game can sync from, derived from its fields + links. */
  const availableSources = useMemo(() => {
    const set = new Set<AchievementSource>();
    if (game.steamAppId || game.platform === "Steam") set.add("steam");
    if (game.emulatorId || game.romPath) set.add("retro");
    if (game.gogGameId) set.add("gog");
    if (game.epicNamespace) set.add("epic");
    for (const l of links[game.id] ?? []) set.add(l.source);
    // Always keep the active source selectable, even if the game's fields
    // changed since the payload was synced.
    if (achievementData) set.add(achievementData.source ?? "steam");
    return set;
  }, [game, links, achievementData]);

  // Whether this platform is mapped to a RetroAchievements console —
  // gates the "Detect by ROM hash" shortcut in the empty state.
  const [retroConsoleMapped, setRetroConsoleMapped] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getRetroSettings()
      .then((s) => {
        if (!cancelled) {
          setRetroConsoleMapped(
            s.consoleMap?.some(
              (m) => m.platform.toLowerCase() === game.platform.toLowerCase()
            ) ?? false
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [getRetroSettings, game.platform]);

  // Filter & sort
  const displayAchievements = useMemo(() => {
    let list = [...achievements];

    // Filter
    if (filter === "unlocked") list = list.filter((a) => a.achieved);
    if (filter === "locked") list = list.filter((a) => !a.achieved);

    // Sort
    if (sort === "name") {
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else if (sort === "rarity") {
      list.sort((a, b) => a.percent - b.percent); // rarest first
    } else if (sort === "unlockDate") {
      list.sort((a, b) => {
        if (a.achieved && !b.achieved) return -1;
        if (!a.achieved && b.achieved) return 1;
        return b.unlockTime - a.unlockTime;
      });
    }
    // "default" keeps the backend's original sort (unlocked by date desc, then locked by rarity desc)

    return list;
  }, [achievements, filter, sort]);

  // Resolve a Steam AppID for this game: use the persisted one, else
  // look it up by name and persist it so the watcher can track it too.
  async function resolveAppId(): Promise<number | null> {
    if (game.steamAppId) return game.steamAppId;
    try {
      const found = await invoke<number | null>("lookup_steam_app_id_for_game", {
        gameName: game.name,
      });
      if (found) {
        updateGame(game.id, { steamAppId: found });
        return found;
      }
    } catch {
      /* ignore — treated as "no appid" */
    }
    return null;
  }

  /** Steam-sourced sync: the Web API first (real unlock state when the
   *  game is owned + connected), falling back to the local crack/schema
   *  path so the list still renders for games not owned on Steam. */
  async function steamSync(): Promise<void> {
    if (game.platform === "Steam" && game.steamAppId) {
      await syncGameAchievements(game.id, game.steamAppId);
      return;
    }
    const appid = await resolveAppId();
    if (!appid) throw new Error(t("achievements.noAppidToast"));
    try {
      await syncGameAchievements(game.id, appid);
    } catch {
      await syncLocalAchievements(game.id, appid);
    }
  }

  /** Run the sync for one source. Throws so callers can toast once. */
  async function syncSource(src: AchievementSource): Promise<void> {
    switch (src) {
      case "steam":
        await steamSync();
        return;
      case "retro":
        await syncRetroAchievements(game.id);
        return;
      case "manual":
        await syncManualAchievements(game.id);
        return;
      case "gog": {
        const [result] = await syncGogAchievements([game.id]);
        if (!result?.data) throw new Error(result?.error ?? "GOG sync failed");
        return;
      }
      case "epic": {
        const [result] = await syncEpicAchievements([game.id]);
        if (!result?.data) throw new Error(result?.error ?? "Epic sync failed");
        return;
      }
    }
  }

  /** Refresh the ACTIVE source (the header + toolbar buttons). */
  async function handleRefresh() {
    if (syncing || isSyncing) return;
    setSyncing(true);
    try {
      await syncSource(source);
      showToast(t("achievements.syncedToast"), "success");
    } catch (err) {
      showToast(t("achievements.syncFailedToast", { err: String(err) }), "error");
    } finally {
      setSyncing(false);
    }
  }

  /** Switch the source picker to another source (syncs it on click). */
  async function switchSource(src: AchievementSource) {
    if (src === source || syncing || isSyncing) return;
    setSyncing(true);
    try {
      await syncSource(src);
      showToast(t("achievements.syncedToast"), "success");
    } catch (err) {
      showToast(t("achievements.syncFailedToast", { err: String(err) }), "error");
    } finally {
      setSyncing(false);
    }
  }

  /** Keep the legacy handleSync (empty-state sync button, own toasts). */
  async function handleSync() {
    setSyncing(true);
    try {
      await steamSync();
      showToast(t("achievements.syncedToast"), "success");
    } catch (err) {
      showToast(t("achievements.syncFailedToast", { err: String(err) }), "error");
    } finally {
      setSyncing(false);
    }
  }

  async function handleUnlink() {
    try {
      await removeManualLink(game.id);
      showToast(t("achievements.unlinkedToast"), "success");
    } catch (err) {
      showToast(t("achievements.syncFailedToast", { err: String(err) }), "error");
    } finally {
      setConfirmUnlink(false);
    }
  }

  async function detectByRomHash() {
    if (syncing || isSyncing) return;
    setSyncing(true);
    try {
      await syncRetroAchievements(game.id);
      showToast(t("achievements.syncedToast"), "success");
    } catch (err) {
      showToast(t("achievements.syncFailedToast", { err: String(err) }), "error");
    } finally {
      setSyncing(false);
    }
  }

  // Auto-load achievements the first time the tab is opened for a game
  // that has no cached data yet — so achievements are visible for all
  // games without requiring a manual sync. Games with an explicit
  // source link (manual / retro) sync that source deterministically;
  // everything else falls back to the Steam AppID lookup path.
  useEffect(() => {
    if (achievementData) return;

    if (manualLink && game.steamAppId == null) {
      const key = `${manualLink.source}:${manualLink.providerId ?? ""}`;
      if (linkedSyncRef.current === key) return;
      linkedSyncRef.current = key;
      let cancelled = false;
      setAutoState("loading");
      (async () => {
        try {
          if (manualLink.source === "manual") {
            await syncManualAchievements(game.id);
          } else if (manualLink.source === "retro") {
            await syncRetroAchievements(game.id);
          }
          if (!cancelled) setAutoState("done");
        } catch {
          if (!cancelled) setAutoState("done");
        }
      })();
      return () => {
        cancelled = true;
        // StrictMode double-mounts effects in dev: the cleanup of the
        // first (discarded) mount must forget the guard, otherwise the
        // remount early-returns below and nothing ever syncs — leaving
        // the tab stuck at "loading achievements…".
        linkedSyncRef.current = null;
      };
    }

    if (autoTriedRef.current === game.id) return;
    autoTriedRef.current = game.id;
    let cancelled = false;
    (async () => {
      setAutoState("loading");
      try {
        let appid = game.steamAppId ?? null;
        if (!appid) {
          appid = await invoke<number | null>("lookup_steam_app_id_for_game", {
            gameName: game.name,
          });
          if (appid && !cancelled) updateGame(game.id, { steamAppId: appid });
        }
        if (!appid) {
          if (!cancelled) setAutoState("noappid");
          return;
        }
        if (game.platform === "Steam") {
          // Owned Steam games: pull the authoritative unlock state from
          // the Steam Web API so achievements show as unlocked right
          // away instead of a schema that renders everything locked.
          // Only when Steam isn't connected do we fall back to the
          // local schema so the list is still visible; any other
          // failure (e.g. a private profile) is left for the Sync button
          // to surface as an honest error.
          try {
            await syncGameAchievements(game.id, appid);
          } catch (err) {
            const msg = String(err ?? "");
            if (msg.includes("Not connected to Steam") && !cancelled) {
              await syncLocalAchievements(game.id, appid);
            }
          }
        } else {
          // Local games: try the Steam Web API first (real unlock state
          // when owned + connected), falling back to the local
          // crack/schema path so the list still renders.
          try {
            await syncGameAchievements(game.id, appid);
          } catch {
            if (!cancelled) await syncLocalAchievements(game.id, appid);
          }
        }
        if (!cancelled) setAutoState("done");
      } catch {
        if (!cancelled) setAutoState("done");
      }
    })();
    return () => {
      cancelled = true;
      // StrictMode double-mounts effects in dev: the cleanup of the
      // first (discarded) mount must forget the guard, otherwise the
      // remount early-returns above and nothing ever syncs — leaving
      // the tab stuck at "loading achievements…".
      autoTriedRef.current = null;
    };
    // `game.steamAppId` is intentionally NOT a dependency: this effect
    // persists a name-resolved appid via `updateGame`, which would
    // re-trigger the effect, run the cleanup (`cancelled = true`) and
    // strand the in-flight sync at the loading state. `autoTriedRef`
    // already makes the effect a one-shot per game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, achievementData, manualLink]);

  const emptySyncFocus = useFocusable(handleSync);

  const formatDate = (ts: number) => {
    if (ts === 0) return "";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // First / last unlock across the payload.
  const { firstUnlock, lastUnlock } = useMemo(() => {
    let first = 0;
    let last = 0;
    for (const a of achievements) {
      if (a.achieved && a.unlockTime > 0) {
        if (first === 0 || a.unlockTime < first) first = a.unlockTime;
        if (a.unlockTime > last) last = a.unlockTime;
      }
    }
    return { firstUnlock: first, lastUnlock: last };
  }, [achievements]);

  // Rarity distribution for the stats bar
  const rarityBreakdown = useMemo(() => {
    const counts: Record<AchievementRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      ultra_rare: 0,
    };
    for (const a of achievements) {
      counts[getAchievementRarity(a.percent)]++;
    }
    return counts;
  }, [achievements]);

  // Unlocked achievements per rarity tier (drives the sidebar X/Y rows).
  const rarityUnlocked = useMemo(() => {
    const counts: Record<AchievementRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      ultra_rare: 0,
    };
    for (const a of achievements) {
      if (a.achieved) counts[getAchievementRarity(a.percent)]++;
    }
    return counts;
  }, [achievements]);

  // ─── Auto-load / empty states ─────────────────────────────────────
  if (!achievementData) {
    if (autoState === "loading") {
      return (
        <div className="achievements-empty">
          <div className="achievements-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 15l-2 5-1-3-3-1 5-2z" />
              <path d="M18.364 5.636a9 9 0 0 1-12.728 12.728" />
            </svg>
          </div>
          <h3>{t("achievements.loading")}</h3>
          <p>{t("achievements.loadingDesc")}</p>
        </div>
      );
    }

    // Explicitly linked game (manual / retro) with no data yet: offer the
    // link management actions instead of the generic "not found" text.
    if (manualLink) {
      return (
        <div className="achievements-empty">
          <div className="achievements-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <h3>{t("achievements.noData")}</h3>
          <p>
            {t("achievements.manualLink.linkedAs", {
              name: manualLink.displayName ?? manualLink.providerId ?? "",
            })}
          </p>
          <div className="ach-empty-actions">
            <button
              className="achievements-btn"
              onClick={() => setShowManualEditor(true)}
            >
              {t("achievements.editManualUnlocks")}
            </button>
            <button
              className="achievements-btn achievements-btn--secondary"
              onClick={() => setConfirmUnlink(true)}
            >
              {t("achievements.unlink")}
            </button>
          </div>
        </div>
      );
    }

    if (autoState === "noappid") {
      if (game.platform === "Steam") {
        return (
          <div className="achievements-empty">
            <div className="achievements-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 15l-2 5-1-3-3-1 5-2z" />
                <path d="M18.364 5.636a9 9 0 0 1-12.728 12.728" />
              </svg>
            </div>
            <h3>{t("achievements.notFound")}</h3>
            <p>{t("achievements.notFoundDesc")}</p>
          </div>
        );
      }
      // Local / unlinked game: the important new flow — offer linking.
      return (
        <NoSourceEmptyState
          game={game}
          retroConsoleMapped={retroConsoleMapped}
          onLinkSteam={() => setShowManualLink(true)}
          onLinkRetro={() => setShowRetroLink(true)}
          onDetectRom={detectByRomHash}
          syncing={syncing || isSyncing}
        />
      );
    }

    if (game.platform === "Steam") {
      return (
        <div className="achievements-empty">
          <div className="achievements-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="8" r="6" />
              <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
            </svg>
          </div>
          <h3>{t("achievements.noDataTitle")}</h3>
          <p>{t("achievements.clickSyncSteam")}</p>
          <button
            className="achievements-sync-btn"
            {...(isBigScreen ? emptySyncFocus : { onClick: handleSync })}
            disabled={syncing || isSyncing}
          >
            {syncing ? (
              <>
                <span className="achievements-spinner" />
                {t("achievements.syncing")}
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                {t("achievements.sync")}
              </>
            )}
          </button>
        </div>
      );
    }

    return (
      <NoSourceEmptyState
        game={game}
        retroConsoleMapped={retroConsoleMapped}
        onLinkSteam={() => setShowManualLink(true)}
        onLinkRetro={() => setShowRetroLink(true)}
        onDetectRom={detectByRomHash}
        syncing={syncing || isSyncing}
      />
    );
  }

  // ─── Main achievements view ───────────────────────────────────────
  return (
    <div className="achievements-tab">
      {/* ── Header: cover · ring · identity · dates · refresh ─────── */}
      <div className="ach-tab-header">
        <div className="ach-tab-cover">
          {game.coverArtUrl ? (
            <img src={game.coverArtUrl} alt={game.name} loading="lazy" />
          ) : (
            <div className="ach-tab-cover-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
          )}
        </div>

        <div className="ach-tab-ring">
          <svg className="achievements-ring" viewBox="0 0 120 120">
            <circle
              className="achievements-ring-bg"
              cx="60" cy="60" r="52"
              stroke="var(--color-bg-tertiary)"
              strokeWidth="9"
              fill="transparent"
            />
            <circle
              className="achievements-ring-fill"
              cx="60" cy="60" r="52"
              strokeWidth="9"
              stroke={pct >= 100 ? "var(--color-success)" : "var(--color-accent)"}
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - pct / 100)}
              strokeLinecap="round"
              fill="transparent"
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="achievements-ring-label">
            <span className="achievements-ring-pct">{pct}%</span>
            <span className="achievements-ring-sub">{unlocked}/{total}</span>
          </div>
        </div>

        <div className="ach-tab-identity">
          <div className="ach-tab-title-row">
            <h3 className="ach-tab-name">{game.name}</h3>
            <AchievementSourceBadge source={source} />
          </div>
          <div className="ach-tab-dates">
            <span className="ach-tab-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden>
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <b>{t("achievements.firstUnlock")}</b>
              <span>{firstUnlock ? formatDate(firstUnlock) : "—"}</span>
            </span>
            <span className="ach-tab-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <b>{t("achievements.lastUnlock")}</b>
              <span>{lastUnlock ? formatDate(lastUnlock) : "—"}</span>
            </span>
          </div>
        </div>

        <div className="ach-tab-actions">
          {source === "manual" && manualLink && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManualEditor(true)}
            >
              {t("achievements.editManualUnlocks")}
            </Button>
          )}
          <button
            className="achievements-sync-btn achievements-sync-btn-sm ach-tab-refresh"
            onClick={handleRefresh}
            disabled={syncing || isSyncing}
            title={t("achievements.syncFrom", {
              source: t(`achievements.source.${source}`),
            })}
          >
            {syncing || isSyncing ? (
              <span className="achievements-spinner" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Source picker (multi-source games) ────────────────────── */}
      {availableSources.size > 1 && (
        <div
          className="ach-source-picker"
          role="radiogroup"
          aria-label={t("achievements.sourceLabel")}
        >
          {[...availableSources].map((src) => (
            <button
              key={src}
              role="radio"
              aria-checked={src === source}
              className={`ach-source-picker-btn${src === source ? " active" : ""}`}
              data-source={src}
              onClick={() => switchSource(src)}
              disabled={syncing || isSyncing}
            >
              {t(`achievements.source.${src}`)}
            </button>
          ))}
        </div>
      )}

      {/* ── Filter & Sort bar ────────────────────────────────────── */}
      <div className="achievements-toolbar">
        <div className="achievements-filters">
          {(["all", "unlocked", "locked"] as const).map((f) => (
            <AchievementFilterButton
              key={f}
              f={f}
              active={filter === f}
              total={total}
              unlocked={unlocked}
              setFilter={setFilter}
              isBigScreen={isBigScreen}
            />
          ))}
        </div>
        <div className="achievements-sort">
          <label className="achievements-sort-label">{t("achievements.sort")}</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="achievements-sort-select"
          >
            <option value="default">{t("achievements.sortDefault")}</option>
            <option value="name">{t("achievements.sortName")}</option>
            <option value="rarity">{t("achievements.sortRarity")}</option>
            <option value="unlockDate">{t("achievements.sortUnlockDate")}</option>
          </select>
        </div>
      </div>

      {/* ── Grid + rarity sidebar ─────────────────────────────────── */}
      <div className="ach-tab-body">
        <div className="ach-tab-main">
          <div className="achievements-grid">
            {displayAchievements.map((a) => (
              <AchievementCard
                key={a.apiName}
                achievement={a}
                formatDate={formatDate}
                isBigScreen={isBigScreen}
              />
            ))}
          </div>

          {displayAchievements.length === 0 && (
            <div className="achievements-no-results">
              {filter === "all"
                ? t("achievements.noResults")
                : t("achievements.noResultsFilter", {
                    filter: t(`achievements.filterWord.${filter}`),
                  })}
            </div>
          )}
        </div>

        <aside className="ach-rarity-side">
          <div className="ach-rarity-side-stats">
            <div className="achievements-stat-card">
              <span className="achievements-stat-value">{unlocked}</span>
              <span className="achievements-stat-label">{t("achievements.unlocked")}</span>
            </div>
            <div className="achievements-stat-card">
              <span className="achievements-stat-value achievements-stat-locked">{total - unlocked}</span>
              <span className="achievements-stat-label">{t("achievements.locked")}</span>
            </div>
            <div className="achievements-stat-card">
              <span className="achievements-stat-value">{total}</span>
              <span className="achievements-stat-label">{t("achievements.total")}</span>
            </div>
          </div>

          <h4 className="ach-rarity-side-title">
            {t("achievementsPage.rarityDistribution")}
          </h4>

          {RARITY_TIERS.map((tier) => {
            const tierTotal = rarityBreakdown[tier];
            const tierUnlocked = rarityUnlocked[tier];
            const tierPct = tierTotal > 0 ? Math.round((tierUnlocked / tierTotal) * 100) : 0;
            return (
              <div className="ach-rarity-row" key={tier}>
                <div className="ach-rarity-row-head">
                  <span className="ach-rarity-row-label" style={{ color: RARITY_COLORS[tier] }}>
                    {t(`achievementsPage.rarity.${tier}`)}
                  </span>
                  <span className="ach-rarity-row-counts">
                    {tierUnlocked}/{tierTotal}
                  </span>
                </div>
                <div className="ach-rarity-row-bar">
                  <div
                    className="ach-rarity-row-fill"
                    style={{ width: `${tierPct}%`, background: RARITY_COLORS[tier] }}
                  />
                </div>
              </div>
            );
          })}
        </aside>
      </div>

      {/* Last synced footer */}
      {achievementData.lastSynced && (
        <div className="achievements-last-synced">
          {t("achievements.lastSynced", { date: new Date(achievementData.lastSynced).toLocaleString() })}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────── */}
      {showManualLink && (
        <ManualLinkModal gameId={game.id} onClose={() => setShowManualLink(false)} />
      )}
      {showRetroLink && (
        <RetroLinkModal game={game} onClose={() => setShowRetroLink(false)} />
      )}
      {showManualEditor && manualLink && (
        <ManualUnlockEditorModal
          gameId={game.id}
          link={manualLink}
          onClose={() => setShowManualEditor(false)}
        />
      )}
      <ConfirmModal
        open={confirmUnlink}
        title={t("achievements.unlink")}
        message={t("achievements.unlinkConfirm", { name: game.name })}
        confirmLabel="achievements.unlink"
        cancelLabel="common.cancel"
        busy={syncing}
        onConfirm={handleUnlink}
        onCancel={() => setConfirmUnlink(false)}
      />
    </div>
  );
}

// ─── No-source linking empty state ────────────────────────────────────

function NoSourceEmptyState({
  game,
  retroConsoleMapped,
  onLinkSteam,
  onLinkRetro,
  onDetectRom,
  syncing,
}: {
  game: Game;
  retroConsoleMapped: boolean;
  onLinkSteam: () => void;
  onLinkRetro: () => void;
  onDetectRom: () => void;
  syncing: boolean;
}) {
  const { t } = useLanguage();
  const hasRom = !!game.emulatorId || !!game.romPath;
  return (
    <div className="achievements-empty">
      <div className="achievements-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </div>
      <h3>{t("achievements.noSourceTitle")}</h3>
      <p>
        {game.platform === "Steam"
          ? t("achievements.noSourceSteamDesc")
          : t("achievements.noSourceDesc")}
      </p>
      <div className="ach-empty-actions">
        <button className="achievements-btn" onClick={onLinkSteam} disabled={syncing}>
          {t("achievements.linkSteamGame")}
        </button>
        <button
          className="achievements-btn achievements-btn--secondary"
          onClick={onLinkRetro}
          disabled={syncing}
        >
          {t("achievements.retroAchievements")}
        </button>
        {hasRom && retroConsoleMapped && (
          <button
            className="achievements-btn achievements-btn--secondary"
            onClick={onDetectRom}
            disabled={syncing}
          >
            {syncing ? (
              <>
                <span className="achievements-spinner" />
                {t("achievements.syncing")}
              </>
            ) : (
              t("achievements.detectByRomHash")
            )}
          </button>
        )}
      </div>
      {hasRom && !retroConsoleMapped && (
        <p className="ach-empty-hint">{t("achievements.noConsoleMapped")}</p>
      )}
    </div>
  );
}

// ─── Achievement Card (plugin-style tile) ─────────────────────────────

function AchievementCard({
  achievement: a,
  formatDate,
  isBigScreen,
}: {
  achievement: Achievement;
  formatDate: (ts: number) => string;
  isBigScreen?: boolean;
}) {
  const focusProps = useFocusable(() => {});
  const rarity = getAchievementRarity(a.percent);
  return (
    <div
      className={`achievement-card ${a.achieved ? "unlocked" : "locked"}`}
      {...(isBigScreen ? focusProps : {})}
    >
      <div className="achievement-card-icon">
        <img
          src={(a.achieved ? a.icon : a.iconGray) || a.icon}
          alt={a.displayName}
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      <div className="achievement-card-body">
        <div className="achievement-card-header">
          <h4 className="achievement-card-name">{a.displayName}</h4>
          {a.achieved && a.unlockTime > 0 && (
            <span className="achievement-card-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatDate(a.unlockTime)}
            </span>
          )}
        </div>
        <p className="achievement-card-desc">{a.description}</p>
        <div className="achievement-card-rarity">
          <div className="achievement-card-rarity-bar">
            <div
              className="achievement-card-rarity-fill"
              style={{ width: `${a.percent}%`, background: RARITY_COLORS[rarity] }}
            />
          </div>
          <span
            className="achievement-card-rarity-pct"
            style={{ color: RARITY_COLORS[rarity] }}
          >
            {a.percent.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

interface AchievementFilterButtonProps {
  f: FilterKey;
  active: boolean;
  total: number;
  unlocked: number;
  setFilter: (f: FilterKey) => void;
  isBigScreen?: boolean;
}

function AchievementFilterButton({
  f,
  active,
  total,
  unlocked,
  setFilter,
  isBigScreen,
}: AchievementFilterButtonProps) {
  const { t } = useLanguage();
  const focusProps = useFocusable(() => setFilter(f));
  return (
    <button
      className={`achievements-filter-btn ${active ? "active" : ""}`}
      {...(isBigScreen ? focusProps : { onClick: () => setFilter(f) })}
    >
       {f === "all" ? t("achievements.filter.all", { total }) : f === "unlocked" ? t("achievements.filter.unlocked", { count: unlocked }) : t("achievements.filter.locked", { count: total - unlocked })}
    </button>
  );
}
