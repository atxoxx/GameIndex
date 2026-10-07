// Main "Mods" page — a games rail on the left and the shared ModWorkspace on
// the right, with a compact global stats strip that doubles as quick filters.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { usePresence } from "../../context/PresenceContext";
import {
  ArrowUpCircle,
  Boxes,
  CheckCircle2,
  Compass,
  Gamepad2,
  HardDrive,
  Layers,
  Settings2,
} from "lucide-react";
import { Button, KpiTile, PageHeader } from "../../components/ui";
import PageWidget from "../../components/PageWidget";
import GameRail, { type RailFilter, type RailSort } from "../../components/mods/GameRail";
import ModWorkspace from "../../components/mods/workspace/ModWorkspace";
import type { ModsOverviewEntry } from "../../types/mods";
import { gameDisplayName, type Game } from "../../types/game";
import "../../styles/page-mods.css";
import "../../components/mods/discover/mods-discover.css";

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
  const [overview, setOverview] = useState<Map<string, ModsOverviewEntry>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [railFilter, setRailFilter] = useState<RailFilter>("all");
  const [railSort, setRailSort] = useState<RailSort>("mods");
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const { setModsGameName } = usePresence();

  // Installed games we can scan or that already have mods. Steam titles are
  // included via `steamAppId` even when `path` is empty.
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

  const refreshOverview = () => {
    setRefreshing(true);
    invoke<ModsOverviewEntry[]>("mods_overview")
      .then((rows) => setOverview(new Map(rows.map((r) => [r.gameId, r]))))
      .catch(() => setOverview(new Map()))
      .finally(() => setRefreshing(false));
  };

  useEffect(refreshOverview, []);

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
    if (selectedGameId && games.some((g) => g.id === selectedGameId)) return;
    const withMods = candidates.find((g) => (overview.get(g.id)?.total ?? 0) > 0);
    setSelectedGameId((withMods ?? candidates[0] ?? games[0])?.id ?? null);
  }, [candidates, games, overview, selectedGameId]);

  const selectedGame: Game | null = games.find((g) => g.id === selectedGameId) ?? null;

  useEffect(() => {
    setModsGameName(selectedGame ? gameDisplayName(selectedGame) : null);
  }, [selectedGame, setModsGameName]);

  return (
    <div className="mods-page">
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
                  onClick={() => navigate("/mods/discover")}
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
          <div className="mods-global-stats ui-item-modsCockpit" role="region" aria-label={t("mods.eyebrow")}>
            <KpiTile
              size="sm"
              className={`mods-stat-tile${railFilter === "modded" ? " is-active" : ""}`}
              label={t("mods.global.moddedGames")}
              value={globalStats.moddedGames}
              subtext={`/ ${candidates.length}`}
              icon={<Gamepad2 size={16} />}
              role="button"
              tabIndex={0}
              onClick={() => setRailFilter((prev) => (prev === "modded" ? "all" : "modded"))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  setRailFilter((prev) => (prev === "modded" ? "all" : "modded"));
              }}
            />
            <KpiTile
              size="sm"
              className="mods-stat-tile"
              label={t("mods.global.totalMods")}
              value={globalStats.totalMods}
              icon={<Layers size={16} />}
              role="button"
              tabIndex={0}
              onClick={() => setRailFilter("all")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setRailFilter("all");
              }}
            />
            <KpiTile
              size="sm"
              className="mods-stat-tile"
              intent="success"
              label={t("mods.global.activeRate")}
              value={`${globalStats.activeRatio}%`}
              subtext={`${globalStats.enabledMods}/${globalStats.totalMods}`}
              icon={<CheckCircle2 size={16} />}
            />
            {globalStats.totalUpdates > 0 && (
              <KpiTile
                size="sm"
                className={`mods-stat-tile${railFilter === "updates" ? " is-active" : ""}`}
                intent="warning"
                label={t("mods.global.pendingUpdates")}
                value={globalStats.totalUpdates}
                icon={<ArrowUpCircle size={16} />}
                role="button"
                tabIndex={0}
                onClick={() => setRailFilter((prev) => (prev === "updates" ? "all" : "updates"))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    setRailFilter((prev) => (prev === "updates" ? "all" : "updates"));
                }}
              />
            )}
            <KpiTile
              size="sm"
              className="mods-stat-tile"
              label={t("mods.global.totalStorage")}
              value={formatStorage(globalStats.totalStorageBytes)}
              icon={<HardDrive size={16} />}
            />
          </div>
        </PageWidget>
      )}

      {candidates.length === 0 ? (
        <div className="mods-empty">
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
                selectedGameId={selectedGameId}
                onSelect={setSelectedGameId}
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
