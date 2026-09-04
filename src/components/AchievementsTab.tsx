import { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAchievements } from "../context/AchievementContext";
import { useGames } from "../context/GameContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useFocusable } from "../hooks/useFocusable";
import {
  type Game,
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

import {
  calculateGameGamerscore,
  formatUnlockDate,
  formatRelativeTime,
  groupAchievementsByDate,
} from "./achievements/achievementUtils";
import AchievementItemCard from "./achievements/AchievementItemCard";
import AchievementItemRow from "./achievements/AchievementItemRow";
import AchievementTimelineGroup from "./achievements/AchievementTimelineGroup";

type SortKey = "default" | "rarity_rare_first" | "rarity_common_first" | "unlockDate" | "name";
type FilterKey = "all" | "unlocked" | "locked" | "secret";
type ViewMode = "grid" | "list" | "timeline";

const RARITY_TIERS: readonly AchievementRarity[] = [
  "ultra_rare",
  "rare",
  "uncommon",
  "common",
];

const TIER_ICONS: Record<AchievementRarity, string> = {
  ultra_rare: "💎",
  rare: "🌟",
  uncommon: "✨",
  common: "🔹",
};

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
  const [rarityFilter, setRarityFilter] = useState<"all" | AchievementRarity>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSecretAchievements, setShowSecretAchievements] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Auto-load state
  const [autoState, setAutoState] = useState<"idle" | "loading" | "noappid" | "done">("idle");
  const autoTriedRef = useRef<string | null>(null);
  const linkedSyncRef = useRef<string | null>(null);

  // Modal + unlink-confirm state
  const [showManualLink, setShowManualLink] = useState(false);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [showRetroLink, setShowRetroLink] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const achievementData = getGameAchievements(game.id);
  const achievements = achievementData?.achievements ?? [];
  const total = achievementData?.total ?? 0;
  const unlocked = achievementData?.unlocked ?? 0;
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  const isPerfect = pct === 100 && total > 0;
  const source: AchievementSource = achievementData?.source ?? "steam";

  // Gamerscore points for this game
  const gamerscore = useMemo(() => {
    return calculateGameGamerscore(achievements);
  }, [achievements]);

  const manualLink = useMemo(
    () => (links[game.id] ?? []).find((l) => l.source === "manual") ?? null,
    [links, game.id]
  );

  /** Sources this game can sync from */
  const availableSources = useMemo(() => {
    const set = new Set<AchievementSource>();
    if (game.steamAppId || game.platform === "Steam") set.add("steam");
    if (game.emulatorId || game.romPath) set.add("retro");
    if (game.gogGameId) set.add("gog");
    if (game.epicNamespace) set.add("epic");
    for (const l of links[game.id] ?? []) set.add(l.source);
    if (achievementData) set.add(achievementData.source ?? "steam");
    return set;
  }, [game, links, achievementData]);

  // RetroAchievements mapped check
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

  // Filter & sort achievements
  const displayAchievements = useMemo(() => {
    let list = [...achievements];

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.displayName.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (filter === "unlocked") list = list.filter((a) => a.achieved);
    if (filter === "locked") list = list.filter((a) => !a.achieved);
    if (filter === "secret") {
      list = list.filter((a) => !a.achieved && a.description.toLowerCase().includes("hidden"));
    }

    // Rarity tier filter
    if (rarityFilter !== "all") {
      list = list.filter((a) => getAchievementRarity(a.percent) === rarityFilter);
    }

    // Sort
    if (sort === "name") {
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else if (sort === "rarity_rare_first") {
      list.sort((a, b) => a.percent - b.percent); // rarest first
    } else if (sort === "rarity_common_first") {
      list.sort((a, b) => b.percent - a.percent); // most common first
    } else if (sort === "unlockDate") {
      list.sort((a, b) => {
        if (a.achieved && !b.achieved) return -1;
        if (!a.achieved && b.achieved) return 1;
        return b.unlockTime - a.unlockTime;
      });
    }
    // "default" keeps the backend's original sort

    return list;
  }, [achievements, filter, rarityFilter, sort, searchQuery]);

  // Chronological timeline groups for Journey view
  const timelineGroups = useMemo(() => {
    return groupAchievementsByDate(displayAchievements);
  }, [displayAchievements]);

  // First / last unlock across payload
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

  // Rarity breakdown
  const rarityBreakdown = useMemo(() => {
    const totalMap: Record<AchievementRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      ultra_rare: 0,
    };
    const unlockedMap: Record<AchievementRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      ultra_rare: 0,
    };
    for (const a of achievements) {
      const tier = getAchievementRarity(a.percent);
      totalMap[tier]++;
      if (a.achieved) unlockedMap[tier]++;
    }
    return { total: totalMap, unlocked: unlockedMap };
  }, [achievements]);

  // Count secret achievements
  const secretCount = useMemo(() => {
    return achievements.filter(
      (a) => !a.achieved && a.description.toLowerCase().includes("hidden")
    ).length;
  }, [achievements]);

  // Resolve Steam AppId
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
      /* ignore */
    }
    return null;
  }

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

  // Auto-load achievements
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
          try {
            await syncGameAchievements(game.id, appid);
          } catch (err) {
            const msg = String(err ?? "");
            if (msg.includes("Not connected to Steam") && !cancelled) {
              await syncLocalAchievements(game.id, appid);
            }
          }
        } else {
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
      autoTriedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, achievementData, manualLink]);

  const emptySyncFocus = useFocusable(handleSync);

  // Empty states
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

  // ─── Main per-game view ──────────────────────────────────────────
  return (
    <div className="achievements-tab">
      {/* ── Hero Header ───────────────────────────────────────────── */}
      <div className={`ach-tab-hero ${isPerfect ? "is-perfect" : ""}`}>
        {/* Cover Thumbnail */}
        <div className="ach-tab-cover">
          {game.coverArtUrl ? (
            <img src={game.coverArtUrl} alt={game.name} loading="lazy" />
          ) : (
            <div className="ach-tab-cover-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
          )}
        </div>

        {/* Animated Radial Progress Ring */}
        <div className="ach-tab-ring">
          <svg className="achievements-ring" viewBox="0 0 120 120">
            <circle
              className="achievements-ring-bg"
              cx="60"
              cy="60"
              r="52"
              stroke="var(--color-bg-tertiary)"
              strokeWidth="9"
              fill="transparent"
            />
            <circle
              className="achievements-ring-fill"
              cx="60"
              cy="60"
              r="52"
              strokeWidth="9"
              stroke={isPerfect ? "var(--color-warning)" : "var(--color-accent)"}
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

        {/* Identity & Dates & Gamerscore */}
        <div className="ach-tab-identity">
          <div className="ach-tab-title-row">
            <h3 className="ach-tab-name">{game.name}</h3>
            <AchievementSourceBadge source={source} />
            {isPerfect && (
              <span className="ach-tab-perfect-pill" title={t("achievements.perfectComplete")}>
                🏆 100% {t("achievementsPage.filterPerfect")}
              </span>
            )}
          </div>

          {/* Gamerscore points row */}
          <div className="ach-tab-points-row">
            <span className="ach-tab-points-val">
              {gamerscore.earned} <span className="ach-tab-points-max">/ {gamerscore.total} pts</span>
            </span>
            <span className="ach-tab-points-dot">•</span>
            <span className="ach-tab-points-level">
              {gamerscore.pct}% {t("achievementsPage.pointsEarned")}
            </span>
          </div>

          <div className="ach-tab-dates">
            <span className="ach-tab-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <b>{t("achievements.firstUnlock")}</b>
              <span>{firstUnlock ? formatUnlockDate(firstUnlock) : "—"}</span>
            </span>
            <span className="ach-tab-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <b>{t("achievements.lastUnlock")}</b>
              <span>
                {lastUnlock ? `${formatUnlockDate(lastUnlock)} (${formatRelativeTime(lastUnlock)})` : "—"}
              </span>
            </span>
          </div>
        </div>

        {/* Actions toolbar */}
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

      {/* ── Multi-Source Switcher ─────────────────────────────────── */}
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

      {/* ── Toolbar: Filters, Search, Sort, View Modes ───────────── */}
      <div className="ach-tab-toolbar-wrap">
        <div className="achievements-toolbar">
          {/* Status Filters */}
          <div className="achievements-filters">
            {(["all", "unlocked", "locked", "secret"] as const).map((f) => {
              if (f === "secret" && secretCount === 0) return null;
              return (
                <button
                  key={f}
                  className={`achievements-filter-btn ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f === "all"
                    ? t("achievements.filter.all", { total })
                    : f === "unlocked"
                      ? t("achievements.filter.unlocked", { count: unlocked })
                      : f === "locked"
                        ? t("achievements.filter.locked", { count: total - unlocked })
                        : `🔒 ${t("achievements.filterSecret", { count: secretCount })}`}
                </button>
              );
            })}
          </div>

          {/* Rarity Tier Filter */}
          <div className="ach-rarity-filter-pills">
            <button
              type="button"
              className={`ach-rarity-filter-pill ${rarityFilter === "all" ? "active" : ""}`}
              onClick={() => setRarityFilter("all")}
            >
              {t("common.all")}
            </button>
            {RARITY_TIERS.map((tier) => {
              const tierCount = rarityBreakdown.total[tier];
              if (tierCount === 0) return null;
              return (
                <button
                  type="button"
                  key={tier}
                  className={`ach-rarity-filter-pill ${rarityFilter === tier ? "active" : ""}`}
                  style={{
                    color: RARITY_COLORS[tier],
                    borderColor: rarityFilter === tier ? RARITY_COLORS[tier] : undefined,
                  }}
                  onClick={() => setRarityFilter(rarityFilter === tier ? "all" : tier)}
                >
                  {TIER_ICONS[tier]} {t(`achievementsPage.rarity.${tier}`)} ({rarityBreakdown.unlocked[tier]}/{tierCount})
                </button>
              );
            })}
          </div>

          {/* Search bar */}
          <div className="achievements-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="achievements-search-input"
              placeholder={t("achievements.searchAchievementsPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Sort Dropdown */}
          <div className="achievements-sort">
            <label className="achievements-sort-label">{t("achievements.sort")}</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="achievements-sort-select"
            >
              <option value="default">{t("achievements.sortDefault")}</option>
              <option value="rarity_rare_first">{t("achievements.sortRarestFirst")}</option>
              <option value="rarity_common_first">{t("achievements.sortCommonFirst")}</option>
              <option value="unlockDate">{t("achievements.sortUnlockDate")}</option>
              <option value="name">{t("achievements.sortName")}</option>
            </select>
          </div>

          {/* Reveal Secret Achievements Toggle */}
          {secretCount > 0 && (
            <label className="ach-reveal-toggle-label">
              <input
                type="checkbox"
                checked={showSecretAchievements}
                onChange={(e) => setShowSecretAchievements(e.target.checked)}
              />
              <span>{t("achievements.revealAllSecrets")}</span>
            </label>
          )}

          {/* View Mode Toggle: Grid, Compact List, Timeline */}
          <div className="ach-view-mode-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`ach-view-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title={t("achievementsPage.viewGrid")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              type="button"
              className={`ach-view-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
              title={t("achievementsPage.viewList")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            <button
              type="button"
              className={`ach-view-btn ${viewMode === "timeline" ? "active" : ""}`}
              onClick={() => setViewMode("timeline")}
              title={t("achievementsPage.viewTimeline")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Tab Body: Achievements view + Rarity Sidebar ──────────── */}
      <div className="ach-tab-body">
        <div className="ach-tab-main">
          {/* Grid View */}
          {viewMode === "grid" && (
            <div className="achievements-grid">
              {displayAchievements.map((a) => (
                <AchievementItemCard
                  key={a.apiName}
                  achievement={a}
                  globalRevealSecret={showSecretAchievements}
                />
              ))}
            </div>
          )}

          {/* Compact List View */}
          {viewMode === "list" && (
            <div className="ach-compact-list">
              {displayAchievements.map((a) => (
                <AchievementItemRow
                  key={a.apiName}
                  achievement={a}
                  globalRevealSecret={showSecretAchievements}
                />
              ))}
            </div>
          )}

          {/* Timeline / Journey View */}
          {viewMode === "timeline" && (
            <div className="ach-journey-timeline-wrap">
              {timelineGroups.map((group) => (
                <AchievementTimelineGroup
                  key={group.dateKey}
                  group={group}
                  globalRevealSecret={showSecretAchievements}
                />
              ))}
              {timelineGroups.length === 0 && (
                <div className="achievements-no-results">
                  {t("achievements.noUnlockedForTimeline")}
                </div>
              )}
            </div>
          )}

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

        {/* ── Rarity & Stats Sidebar ─────────────────────────────── */}
        <aside className="ach-rarity-side">
          <div className="ach-rarity-side-stats">
            <div className="achievements-stat-card" title={`${t("achievements.unlocked")}: ${unlocked}`}>
              <span className="achievements-stat-value">{unlocked}</span>
              <span className="achievements-stat-label">{t("achievements.unlocked")}</span>
            </div>
            <div className="achievements-stat-card" title={`${t("achievements.locked")}: ${total - unlocked}`}>
              <span className="achievements-stat-value achievements-stat-locked">{total - unlocked}</span>
              <span className="achievements-stat-label">{t("achievements.locked")}</span>
            </div>
            <div className="achievements-stat-card" title={`${t("achievements.total")}: ${total}`}>
              <span className="achievements-stat-value">{total}</span>
              <span className="achievements-stat-label">{t("achievements.total")}</span>
            </div>
          </div>

          <h4 className="ach-rarity-side-title">
            {t("achievementsPage.rarityDistribution")}
          </h4>

          {/* Rarity distribution stacked bar */}
          {total > 0 && (
            <div className="achievements-rarity-bar-wrap">
              <div className="achievements-rarity-bar">
                {RARITY_TIERS.map((tier) => {
                  const count = rarityBreakdown.total[tier];
                  if (count === 0) return null;
                  const pct = (count / total) * 100;
                  return (
                    <div
                      key={tier}
                      className="achievements-rarity-segment"
                      data-tier={tier}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: RARITY_COLORS[tier],
                      }}
                      title={`${t(`achievementsPage.rarity.${tier}`)}: ${count} (${Math.round(pct)}%)`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {RARITY_TIERS.map((tier) => {
            const tierTotal = rarityBreakdown.total[tier];
            if (tierTotal === 0) return null;
            const tierUnlocked = rarityBreakdown.unlocked[tier];
            const tierPct = Math.round((tierUnlocked / tierTotal) * 100);
            return (
              <div className="ach-rarity-row" key={tier}>
                <div className="ach-rarity-row-head">
                  <span className="ach-rarity-row-label" style={{ color: RARITY_COLORS[tier] }}>
                    {TIER_ICONS[tier]} {t(`achievementsPage.rarity.${tier}`)}
                  </span>
                  <span className="ach-rarity-row-counts">
                    {tierUnlocked}/{tierTotal} ({tierPct}%)
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

          {/* Remaining completion note */}
          {total > unlocked && (
            <div className="ach-sidebar-remaining-box">
              <span className="ach-sidebar-remaining-title">
                {t("achievements.remainingToPerfect")}
              </span>
              <span className="ach-sidebar-remaining-count">
                {total - unlocked} {t("achievements.remainingAchievements")}
              </span>
            </div>
          )}
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
