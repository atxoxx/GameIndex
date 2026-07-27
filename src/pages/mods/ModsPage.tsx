// Main "Mods" page — dual-pane: a moddable-games rail on the left
// (installed games + per-game mod counts from mods.db), the shared
// ModManager on the right for the selected game.

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { PageHeader } from "../../components/ui";
import ModManager from "../../components/mods/ModManager";
import { ENGINE_LABELS, type ModEngine, type ModsOverviewEntry } from "../../types/mods";
import type { Game } from "../../types/game";
import "../../styles/page-mods.css";

export default function ModsPage() {
  const { games, updateGame } = useGames();
  const { t } = useLanguage();
  const [overview, setOverview] = useState<Map<string, ModsOverviewEntry>>(new Map());
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Installed games with a real on-disk path are moddable candidates.
  const candidates = useMemo(
    () =>
      games
        .filter((g) => g.installed !== false && !!g.path)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [games]
  );

  const refreshOverview = () => {
    invoke<ModsOverviewEntry[]>("mods_overview")
      .then((rows) => setOverview(new Map(rows.map((r) => [r.gameId, r]))))
      .catch(() => setOverview(new Map()));
  };

  useEffect(refreshOverview, []);

  // Games with known mods float to the top of the rail.
  const ordered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? candidates.filter((g) => g.name.toLowerCase().includes(q))
      : candidates;
    return [...list].sort((a, b) => {
      const am = overview.get(a.id)?.total ?? 0;
      const bm = overview.get(b.id)?.total ?? 0;
      if ((am > 0) !== (bm > 0)) return am > 0 ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [candidates, overview, search]);

  // Default selection: first game that already has mods, else first.
  useEffect(() => {
    if (selectedGameId && candidates.some((g) => g.id === selectedGameId)) return;
    const withMods = candidates.find((g) => (overview.get(g.id)?.total ?? 0) > 0);
    setSelectedGameId((withMods ?? candidates[0])?.id ?? null);
  }, [candidates, overview, selectedGameId]);

  const selectedGame: Game | null =
    candidates.find((g) => g.id === selectedGameId) ?? null;

  return (
    <div className="mods-page">
      <PageHeader
        eyebrow={t("mods.eyebrow")}
        title={t("mods.title")}
        description={t("mods.subtitle")}
      />

      {candidates.length === 0 ? (
        <div className="mods-empty">
          <div className="mods-empty-glyph">🧩</div>
          <h3>{t("mods.noGames")}</h3>
          <p>{t("mods.noGamesHint")}</p>
        </div>
      ) : (
        <div className="mods-page-split">
          {/* ── Games rail ─────────────────────────────────────── */}
          <div className="mods-games-pane">
            <input
              type="text"
              className="mods-search mods-games-search"
              placeholder={t("mods.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mods-games-list">
              {ordered.map((g) => {
                const entry = overview.get(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`mods-game-row ${g.id === selectedGameId ? "selected" : ""}`}
                    onClick={() => setSelectedGameId(g.id)}
                  >
                    <div className="mods-game-cover">
                      {g.coverArtUrl ? (
                        <img src={g.coverArtUrl} alt="" loading="lazy" />
                      ) : (
                        <span>{g.name.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="mods-game-info">
                      <span className="mods-game-name">{g.name}</span>
                      <span className="mods-game-meta">
                        {entry
                          ? `${t("mods.modsCount", { count: String(entry.total) })} · ${t(
                              "mods.enabledCount",
                              {
                                enabled: String(entry.enabled),
                                total: String(entry.total),
                              }
                            )}`
                          : g.platform}
                      </span>
                      {entry && entry.engines.length > 0 && (
                        <span className="mods-game-engines">
                          {entry.engines
                            .map((e) => ENGINE_LABELS[e as ModEngine] ?? e)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                    {entry && entry.updates > 0 && (
                      <span className="mods-update-pill">↑ {entry.updates}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Manager pane ───────────────────────────────────── */}
          <div className="mods-page-manager">
            {selectedGame ? (
              <ModManager
                key={selectedGame.id}
                game={selectedGame}
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
        </div>
      )}
    </div>
  );
}
