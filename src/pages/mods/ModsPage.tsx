// Main "Mods" page — a games rail on the left and the shared ModWorkspace on
// the right, with a quiet stat band that doubles as navigation. The selected
// game and workspace tab live in the URL so a view can be shared or refreshed.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { usePresence } from "../../context/PresenceContext";
import {
  Boxes,
  Compass,
  Settings2,
} from "lucide-react";
import { Button, PageHeader } from "../../components/ui";
import PageWidget from "../../components/PageWidget";
import ModsCockpit from "../../components/mods/ModsCockpit";
import GameRail, { type RailFilter, type RailSort } from "../../components/mods/GameRail";
import ModWorkspace from "../../components/mods/workspace/ModWorkspace";
import type { WorkspaceTab } from "../../components/mods/workspace/WorkspaceHeader";
import type { ModsOverviewEntry } from "../../types/mods";
import { gameDisplayName, type Game } from "../../types/game";
import "../../styles/page-mods.css";
import "../../styles/page-mods-workspace-v2.css";
import "../../components/mods/discover/mods-discover.css";

const TABS: WorkspaceTab[] = [
  "installed",
  "discover",
  "updates",
  "conflicts",
  "profiles",
  "mo2",
];

function formatStorage(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function ModsPage() {
  const { games, updateGame } = useGames();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState<Map<string, ModsOverviewEntry>>(new Map());
  const [overviewReady, setOverviewReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [railFilter, setRailFilter] = useState<RailFilter>("all");
  const [railSort, setRailSort] = useState<RailSort>("mods");
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const { setModsGameName } = usePresence();

  const gameParam = searchParams.get("game");
  const tabParam = searchParams.get("tab");
  const tab: WorkspaceTab = TABS.includes(tabParam as WorkspaceTab)
    ? (tabParam as WorkspaceTab)
    : "installed";

  const candidates = useMemo(
    () =>
      games
        .filter(
          (g) =>
            (g.installed !== false && (!!g.path || g.steamAppId != null)) ||
            (overview.get(g.id)?.total ?? 0) > 0
        )
        .sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b))),
    [games, overview]
  );

  const refreshOverview = useCallback(() => {
    setRefreshing(true);
    invoke<ModsOverviewEntry[]>("mods_overview")
      .then((rows) => setOverview(new Map(rows.map((r) => [r.gameId, r]))))
      .catch(() => setOverview(new Map()))
      .finally(() => {
        setOverviewReady(true);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    refreshOverview();
  }, [refreshOverview]);

  const globalStats = useMemo(() => {
    let moddedGames = 0;
    let totalMods = 0;
    let enabledMods = 0;
    let totalUpdates = 0;
    let totalStorageBytes = 0;

    for (const g of candidates) {
      const entry = overview.get(g.id);
      if (entry && entry.total > 0) {
        moddedGames++;
        totalMods += entry.total;
        enabledMods += entry.enabled;
        totalUpdates += entry.updates;
      }
      totalStorageBytes += entry?.totalSizeBytes ?? g.modsSizeBytes ?? 0;
    }

    const activeRatio = totalMods > 0 ? Math.round((enabledMods / totalMods) * 100) : 0;

    return { moddedGames, totalMods, enabledMods, activeRatio, totalUpdates, totalStorageBytes };
  }, [candidates, overview]);

  const selectedGame: Game | null = useMemo(() => {
    if (gameParam) {
      const hit = games.find((g) => g.id === gameParam);
      if (hit) return hit;
    }
    const withMods = candidates.find((g) => (overview.get(g.id)?.total ?? 0) > 0);
    return withMods ?? candidates[0] ?? games[0] ?? null;
  }, [gameParam, games, candidates, overview]);

  // Canonicalise the URL once the default game resolves.
  useEffect(() => {
    if (!selectedGame || !overviewReady) return;
    if (gameParam === selectedGame.id) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("game", selectedGame.id);
        return next;
      },
      { replace: true }
    );
  }, [selectedGame, gameParam, overviewReady, setSearchParams]);

  const selectGame = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("game", id);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setTab = useCallback(
    (next: WorkspaceTab) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "installed") params.delete("tab");
          else params.set("tab", next);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Every tab keeps the rail; only search expands the candidate pool when the
  // query is non-empty, so the default list stays "games we can mod".
  const ordered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? games : candidates;

    if (railFilter === "modded") {
      list = list.filter((g) => (overview.get(g.id)?.total ?? 0) > 0);
    } else if (railFilter === "updates") {
      list = list.filter((g) => (overview.get(g.id)?.updates ?? 0) > 0);
    }

    if (q) {
      list = list.filter((g) => {
        if (
          gameDisplayName(g).toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q)
        )
          return true;
        if (g.platform.toLowerCase().includes(q)) return true;
        const engines = overview.get(g.id)?.engines ?? [];
        return engines.some((e) => e.toLowerCase().includes(q));
      });
    }

    return [...list].sort((a, b) => {
      const aEntry = overview.get(a.id);
      const bEntry = overview.get(b.id);
      const aMods = aEntry?.total ?? 0;
      const bMods = bEntry?.total ?? 0;

      if (railSort === "mods") {
        if (aMods !== bMods) return bMods - aMods;
      } else if (railSort === "size") {
        const aSize = aEntry?.totalSizeBytes ?? a.modsSizeBytes ?? 0;
        const bSize = bEntry?.totalSizeBytes ?? b.modsSizeBytes ?? 0;
        if (aSize !== bSize) return bSize - aSize;
      }

      if ((aMods > 0) !== (bMods > 0)) return aMods > 0 ? -1 : 1;
      const ai = a.installed !== false && (!!a.path || a.steamAppId != null);
      const bi = b.installed !== false && (!!b.path || b.steamAppId != null);
      if (ai !== bi) return ai ? -1 : 1;
      return gameDisplayName(a).localeCompare(gameDisplayName(b));
    });
  }, [candidates, games, overview, search, railFilter, railSort]);

  useEffect(() => {
    setModsGameName(selectedGame ? gameDisplayName(selectedGame) : null);
  }, [selectedGame, setModsGameName]);

  return (
    <div className="mods-page mods-page--v2">
      <PageWidget page="mods" widget="modsHeader">
        <div className="ui-item-modsHeader">
          <PageHeader
            eyebrow={t("mods.eyebrow")}
            title={t("mods.title")}
            description={t("mods.subtitle")}
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Compass size={14} />}
                  onClick={() =>
                    navigate(
                      selectedGame
                        ? `/mods/discover?gameId=${selectedGame.id}`
                        : "/mods/discover"
                    )
                  }
                >
                  {t("mods.discover.title")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Settings2 size={14} />}
                  onClick={() => navigate("/settings/integrations?section=section-mods")}
                >
                  {t("mods.openSettings")}
                </Button>
              </>
            }
          />
        </div>
      </PageWidget>

      {candidates.length > 0 && (
        <PageWidget page="mods" widget="modsCockpit">
          <div className="ui-item-modsCockpit mods-v2-cockpit">
            <ModsCockpit
              moddedGames={globalStats.moddedGames}
              totalGames={candidates.length}
              totalMods={globalStats.totalMods}
              enabledMods={globalStats.enabledMods}
              activeRatio={globalStats.activeRatio}
              updates={globalStats.totalUpdates}
              storageLabel={formatStorage(globalStats.totalStorageBytes)}
              onToggleModded={() =>
                setRailFilter((prev) => (prev === "modded" ? "all" : "modded"))
              }
              onOpenUpdates={() => setTab("updates")}
              onFilterAll={() => setRailFilter("all")}
            />
          </div>
        </PageWidget>
      )}

      {candidates.length === 0 ? (
        <div className="mods-empty ui-item-modsWorkspace">
          <div className="mods-empty-glyph">
            <Boxes size={44} strokeWidth={1.5} />
          </div>
          <h3>{t("mods.noGames")}</h3>
          <p>{t("mods.noGamesHint")}</p>
          <Button variant="secondary" size="sm" onClick={() => navigate("/library")}>
            {t("nav.library")}
          </Button>
        </div>
      ) : (
        <div className={`mods-page__split${isRailCollapsed ? " is-rail-collapsed" : ""}`}>
          <PageWidget page="mods" widget="modsRail">
            <div className="ui-item-modsRail">
              <GameRail
                games={ordered}
                totalGames={candidates.length}
                overview={overview}
                selectedGameId={selectedGame?.id ?? null}
                onSelect={selectGame}
                search={search}
                onSearchChange={setSearch}
                filter={railFilter}
                onFilterChange={setRailFilter}
                sort={railSort}
                onSortChange={setRailSort}
                moddedCount={globalStats.moddedGames}
                updatesCount={globalStats.totalUpdates}
                refreshing={refreshing}
                onRefresh={refreshOverview}
                collapsed={isRailCollapsed}
                onToggleCollapsed={() => setIsRailCollapsed((v) => !v)}
              />
            </div>
          </PageWidget>

          <PageWidget page="mods" widget="modsWorkspace">
            <div className="ui-item-modsWorkspace mods-page__workspace">
              {selectedGame ? (
                <ModWorkspace
                  key={selectedGame.id}
                  game={selectedGame}
                  variant="page"
                  tab={tab}
                  onTabChange={setTab}
                  onChanged={refreshOverview}
                  onModsSized={(info) =>
                    updateGame(selectedGame.id, {
                      modsSizeBytes: info.totalBytes > 0 ? info.totalBytes : undefined,
                      modsFolder: info.folder,
                      modsDetectedAt:
                        info.totalBytes > 0 ? new Date().toISOString() : undefined,
                    })
                  }
                />
              ) : (
                <div className="mods-detail-empty">{t("mods.selectGame")}</div>
              )}
            </div>
          </PageWidget>
        </div>
      )}
    </div>
  );
}
