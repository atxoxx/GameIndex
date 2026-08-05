// Main "Mods" page — dual-pane: a moddable-games rail on the left
// (installed games + per-game mod counts from mods.db), the shared
// ModManager on the right for the selected game.
// Remade modern UI styling on the token design system (flat surfaces,
// page-scoped engine brand accents, token-driven motion).

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { usePresence } from "../../context/PresenceContext";
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
  const { setModsGameName } = usePresence();

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

  useEffect(() => {
    setModsGameName(selectedGame?.name ?? null);
  }, [selectedGame, setModsGameName]);

  return (
    <div className="mods-page">
      <PageHeader
        eyebrow={t("mods.eyebrow")}
        title={t("mods.title")}
        description={t("mods.subtitle")}
      />

      {candidates.length === 0 ? (
        <div className="mods-empty">
          <div className="mods-empty-glyph">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2"></rect>
              <path d="M6 12h4m-2-2v4"></path>
              <circle cx="17" cy="10" r="1" fill="currentColor"></circle>
              <circle cx="15" cy="13" r="1" fill="currentColor"></circle>
            </svg>
          </div>
          <h3>{t("mods.noGames")}</h3>
          <p>{t("mods.noGamesHint")}</p>
        </div>
      ) : (
        <div className="mods-page-split">
          {/* ── Games rail ─────────────────────────────────────── */}
          <div className="mods-games-pane">
            <div className="mods-games-pane-header">
              <span className="mods-games-pane-title">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                  <path d="M6 12h4m-2-2v4"></path>
                  <circle cx="17" cy="10" r="1" fill="currentColor"></circle>
                  <circle cx="15" cy="13" r="1" fill="currentColor"></circle>
                </svg>
                {t("mods.gamesLibrary")}
              </span>
              <span className="mods-games-pane-count">{candidates.length}</span>
            </div>

            <div className="mods-search-input-wrapper">
              <svg className="mods-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder={t("mods.searchPlaceholder")}
                aria-label={t("mods.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="mods-search-clear"
                  onClick={() => setSearch("")}
                  title={t("common.clearSearch")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>

            {ordered.length === 0 && (
              <div className="mods-games-empty">{t("mods.noGamesMatch")}</div>
            )}

            <div className="mods-games-list">
              {ordered.map((g) => {
                const entry = overview.get(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`mods-game-row ${g.id === selectedGameId ? "selected" : ""} ${
                      entry && entry.total > 0 ? "has-mods" : ""
                    }`}
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
                      <span className="mods-game-name" title={g.name}>{g.name}</span>
                      <div className="mods-game-meta">
                        {entry ? (
                          <>
                            <span
                              className="mods-game-count"
                              title={t("mods.modsCount", { count: String(entry.total) })}
                            >
                              {t("mods.modsCount", { count: String(entry.total) })}
                            </span>
                            {entry.enabled > 0 && (
                              <span className="mods-game-count-sub">
                                {t("mods.enabledCount", {
                                  enabled: String(entry.enabled),
                                  total: String(entry.total),
                                })}
                              </span>
                            )}
                            <span className="mods-game-platform">{g.platform}</span>
                          </>
                        ) : (
                          <>
                            <span className="mods-game-platform">{g.platform}</span>
                            <span className="mods-game-nomod">{t("mods.noModsYet")}</span>
                          </>
                        )}
                      </div>
                      {entry && entry.engines.length > 0 && (
                        <div className="mods-game-engines-list">
                          {entry.engines.slice(0, 2).map((e) => (
                            <span key={e} className={`mods-engine-chip mods-engine-${e}`}>
                              {ENGINE_LABELS[e as ModEngine] ?? e}
                            </span>
                          ))}
                          {entry.engines.length > 2 && (
                            <span className="mods-game-engines">
                              +{entry.engines.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {entry && entry.updates > 0 && (
                      <span className="mods-badge mods-badge-update" title={t("mods.updatesAvailable", { count: String(entry.updates) })}>
                        ↑ {entry.updates}
                      </span>
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
