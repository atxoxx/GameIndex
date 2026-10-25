import { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trophy } from "lucide-react";
import { useAchievements } from "../context/AchievementContext";
import { useGames } from "../context/GameContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useFocusable } from "../hooks/useFocusable";
import {
  type Game,
  type AchievementSource,
  type AchievementRarity,
  gameDisplayName,
} from "../types/game";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { ConfirmModal } from "./ui";
import { GameTabShell, useGameTabState } from "./game/tabs";
import ManualLinkModal from "./achievements/ManualLinkModal";
import ManualUnlockEditorModal from "./achievements/ManualUnlockEditorModal";
import RetroLinkModal from "./achievements/RetroLinkModal";

import {
  calculateGameGamerscore,
  groupAchievementsByDate,
} from "./achievements/achievementUtils";
import AchievementItemCard from "./achievements/AchievementItemCard";
import AchievementItemRow from "./achievements/AchievementItemRow";
import AchievementTimelineGroup from "./achievements/AchievementTimelineGroup";
import AchievementTabHero from "./achievements/tab/AchievementTabHero";
import AchievementTabToolbar from "./achievements/tab/AchievementTabToolbar";
import AchievementAlmostDoneShelf from "./achievements/tab/AchievementAlmostDoneShelf";
import AchievementRarityPanel from "./achievements/tab/AchievementRarityPanel";
import {
  computeRarityBreakdown,
  countSecrets,
  filterAchievementsForTab,
  pickAlmostDone,
  type AchievementFilter,
  type AchievementSort,
  type AchievementView,
} from "./achievements/tab/achievementTabData";

type SortKey = AchievementSort;
type FilterKey = AchievementFilter;
type ViewMode = AchievementView;

interface AchievementTabState {
  view: ViewMode;
  filter: FilterKey;
  sort: SortKey;
  rarity: "all" | AchievementRarity;
}

const ACHIEVEMENT_TAB_DEFAULTS: AchievementTabState = {
  view: "grid",
  filter: "all",
  sort: "default",
  rarity: "all",
};


/** `useFocusable` without the ARIA role hint, so native controls keep their own role. */
function useFocusProps(onActivate: () => void) {
  const { ref, tabIndex, onClick } = useFocusable(onActivate);
  return { ref, tabIndex, onClick };
}

export default function AchievementsTab({ game }: { game: Game }) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const {
    getGameAchievements,
    loadGameAchievements,
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

  const [tabState, setTabState] = useGameTabState<AchievementTabState>({
    prefix: "ach",
    defaults: ACHIEVEMENT_TAB_DEFAULTS,
    allowed: {
      view: ["grid", "list", "timeline"],
      filter: ["all", "unlocked", "locked", "secret"],
      sort: [
        "default",
        "rarity_rare_first",
        "rarity_common_first",
        "unlockDate",
        "name",
      ],
      rarity: ["all", "common", "uncommon", "rare", "ultra_rare"],
    },
  });
  const filter = tabState.filter;
  const rarityFilter = tabState.rarity;
  const sort = tabState.sort;
  const viewMode = tabState.view;
  const setFilter = (next: FilterKey) => setTabState({ filter: next });
  const setRarityFilter = (next: "all" | AchievementRarity) =>
    setTabState({ rarity: next });
  const setSort = (next: SortKey) => setTabState({ sort: next });
  const setViewMode = (next: ViewMode) => setTabState({ view: next });
  const [searchQuery, setSearchQuery] = useState("");
  const [showSecretAchievements, setShowSecretAchievements] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Auto-load state
  const [autoState, setAutoState] = useState<"idle" | "loading" | "noappid" | "done">("idle");
  const autoTriedRef = useRef<string | null>(null);
  const linkedSyncRef = useRef<string | null>(null);
  // Whether the on-disk payload has been checked for this game. Gates the
  // network auto-sync so a cached payload is preferred over re-syncing.
  const [cacheChecked, setCacheChecked] = useState(false);

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
  const displayAchievements = useMemo(
    () =>
      filterAchievementsForTab(achievements, {
        filter,
        rarityFilter,
        searchQuery,
        sort,
      }),
    [achievements, filter, rarityFilter, sort, searchQuery],
  );

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
  const rarityBreakdown = useMemo(
    () => computeRarityBreakdown(achievements),
    [achievements],
  );

  // Count secret achievements
  const secretCount = useMemo(() => countSecrets(achievements), [achievements]);

  // The next-unlock shelf: finish line when ≤3 remain, easiest next otherwise.
  // Secret achievements stay hidden unless the reader has revealed them.
  const almostDone = useMemo(() => {
    const visible = showSecretAchievements
      ? achievements
      : achievements.filter(
          (achievement) =>
            achievement.achieved ||
            !achievement.description.toLowerCase().includes("hidden"),
        );
    return pickAlmostDone(visible);
  }, [achievements, showSecretAchievements]);
  const [rarityPanelOpen, setRarityPanelOpen] = useState(true);

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
        const [result] = await syncGogAchievements([
          { gameId: game.id, storeId: game.gogGameId ?? null },
        ]);
        if (!result?.data) throw new Error(result?.error ?? "GOG sync failed");
        return;
      }
      case "epic": {
        const [result] = await syncEpicAchievements([
          {
            gameId: game.id,
            namespace: game.epicNamespace ?? null,
          },
        ]);
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

  // Load the cached per-game payload on demand (the context no longer
  // holds every game's full achievement list in memory).
  useEffect(() => {
    let cancelled = false;
    setCacheChecked(false);
    (async () => {
      await loadGameAchievements(game.id);
      if (!cancelled) setCacheChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [game.id, loadGameAchievements]);

  // The context detail cache is bounded, so this game's payload can be
  // evicted while the tab stays mounted (e.g. a bulk sync busy-evicts older
  // games). Re-read it from the local DB when that happens instead of
  // leaving the panel empty — a cache reload, not another network sync.
  const hadPayloadRef = useRef(false);
  useEffect(() => {
    hadPayloadRef.current = false;
  }, [game.id]);
  useEffect(() => {
    if (achievementData) {
      hadPayloadRef.current = true;
      return;
    }
    if (!hadPayloadRef.current) return;
    hadPayloadRef.current = false;
    let cancelled = false;
    (async () => {
      await loadGameAchievements(game.id);
      if (!cancelled) setCacheChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [achievementData, game.id, loadGameAchievements]);

  // Auto-load achievements
  useEffect(() => {
    if (!cacheChecked) return;
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
  }, [game.id, achievementData, manualLink, cacheChecked]);

  const emptySyncFocus = useFocusable(handleSync);
  const emptyManualEditorFocus = useFocusProps(() => setShowManualEditor(true));
  const unlinkFocus = useFocusProps(() => setConfirmUnlink(true));

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
              ref={emptyManualEditorFocus.ref}
              tabIndex={emptyManualEditorFocus.tabIndex}
              className="achievements-btn"
              onClick={emptyManualEditorFocus.onClick}
            >
              {t("achievements.editManualUnlocks")}
            </button>
            <button
              ref={unlinkFocus.ref}
              tabIndex={unlinkFocus.tabIndex}
              className="achievements-btn achievements-btn--secondary"
              onClick={unlinkFocus.onClick}
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
    <GameTabShell
      eyebrow={t("achievements.eyebrow")}
      title={t("game.tab.achievements")}
      description={t("achievements.tabSummary", {
        unlocked,
        total,
        pct,
      })}
      icon={<Trophy size={20} />}
      className="achievements-tab"
    >
      <AchievementTabHero
        game={game}
        source={source}
        pct={pct}
        unlocked={unlocked}
        total={total}
        gamerscore={gamerscore}
        firstUnlock={firstUnlock}
        lastUnlock={lastUnlock}
        isPerfect={isPerfect}
        syncing={syncing || isSyncing}
        onRefresh={() => void handleRefresh()}
        onEditManual={
          source === "manual" && manualLink
            ? () => setShowManualEditor(true)
            : undefined
        }
        sourcePicker={
          availableSources.size > 1 ? (
            <div
              className="ach-source-picker"
              role="radiogroup"
              aria-label={t("achievements.sourceLabel")}
            >
              {[...availableSources].map((src) => (
                <SourcePickerButton
                  key={src}
                  source={src}
                  active={src === source}
                  label={t(`achievements.source.${src}`)}
                  disabled={syncing || isSyncing}
                  onSelect={() => void switchSource(src)}
                />
              ))}
            </div>
          ) : undefined
        }
      />

      <AchievementAlmostDoneShelf items={almostDone.items} mode={almostDone.mode} />

      <AchievementTabToolbar
        filter={filter}
        onFilterChange={setFilter}
        counts={{
          all: total,
          unlocked,
          locked: total - unlocked,
          secret: secretCount,
        }}
        rarityFilter={rarityFilter}
        onRarityFilterChange={setRarityFilter}
        breakdown={rarityBreakdown}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sort={sort}
        onSortChange={setSort}
        view={viewMode}
        onViewChange={setViewMode}
        showSecret={showSecretAchievements}
        onShowSecretChange={setShowSecretAchievements}
        rarityOpen={rarityPanelOpen}
        onToggleRarity={() => setRarityPanelOpen((open) => !open)}
      />

      <div className={`ach-tab-body${rarityPanelOpen ? " has-rarity" : ""}`}>
        <div className="ach-tab-main">
          {viewMode === "grid" && (
            <div className="achievements-grid">
              {displayAchievements.map((achievement) => (
                <AchievementItemCard
                  key={achievement.apiName}
                  achievement={achievement}
                  globalRevealSecret={showSecretAchievements}
                />
              ))}
            </div>
          )}

          {viewMode === "list" && (
            <div className="ach-compact-list">
              {displayAchievements.map((achievement) => (
                <AchievementItemRow
                  key={achievement.apiName}
                  achievement={achievement}
                  globalRevealSecret={showSecretAchievements}
                />
              ))}
            </div>
          )}

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

        <AchievementRarityPanel
          breakdown={rarityBreakdown}
          total={total}
          unlocked={unlocked}
          open={rarityPanelOpen}
          onToggle={() => setRarityPanelOpen((open) => !open)}
        />
      </div>

      {achievementData.lastSynced && (
        <div className="achievements-last-synced">
          {t("achievements.lastSynced", {
            date: new Date(achievementData.lastSynced).toLocaleString(),
          })}
        </div>
      )}

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
        message={t("achievements.unlinkConfirm", { name: gameDisplayName(game) })}
        confirmLabel="achievements.unlink"
        cancelLabel="common.cancel"
        busy={syncing}
        onConfirm={handleUnlink}
        onCancel={() => setConfirmUnlink(false)}
      />
    </GameTabShell>
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
  const linkSteamFocus = useFocusProps(onLinkSteam);
  const linkRetroFocus = useFocusProps(onLinkRetro);
  const detectRomFocus = useFocusProps(onDetectRom);
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
        <button
          ref={linkSteamFocus.ref}
          tabIndex={linkSteamFocus.tabIndex}
          className="achievements-btn"
          onClick={linkSteamFocus.onClick}
          disabled={syncing}
        >
          {t("achievements.linkSteamGame")}
        </button>
        <button
          ref={linkRetroFocus.ref}
          tabIndex={linkRetroFocus.tabIndex}
          className="achievements-btn achievements-btn--secondary"
          onClick={linkRetroFocus.onClick}
          disabled={syncing}
        >
          {t("achievements.retroAchievements")}
        </button>
        {hasRom && retroConsoleMapped && (
          <button
            ref={detectRomFocus.ref}
            tabIndex={detectRomFocus.tabIndex}
            className="achievements-btn achievements-btn--secondary"
            onClick={detectRomFocus.onClick}
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

// ─── Focus-registered controls ─────────────────────────────────────────
// Each control owns its own `useFocusable` call so the registry gets one
// stable entry per rendered element (the per-card pattern).

function SourcePickerButton({
  source,
  active,
  label,
  disabled,
  onSelect,
}: {
  source: AchievementSource;
  active: boolean;
  label: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const focus = useFocusProps(onSelect);
  return (
    <button
      ref={focus.ref}
      tabIndex={focus.tabIndex}
      type="button"
      role="radio"
      aria-checked={active}
      className={`ach-source-picker-btn${active ? " active" : ""}`}
      data-source={source}
      onClick={focus.onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
