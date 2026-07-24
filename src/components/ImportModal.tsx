import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { gameNameFromPath } from "../types/game";
import { Button } from "./ui";
import { useLanguage } from "../context/LanguageContext";
import type { GameMetadataResult, StoreGameSummary } from "../types/game";

export interface ExeInfo {
  path: string;
  size: number;
  modifiedAt: number;
}

/**
 * Directory names that are "transparent" helpers (binary/redist/runtime
 * folders). When an executable lives inside one of these, we keep walking up
 * the tree to find the real game folder. Mirrors `get_game_root_dir` in the
 * Rust game_watcher.
 */
const HELPER_DIRS = new Set([
  "bin",
  "binaries",
  "win64",
  "win32",
  "x64",
  "x86",
  "win-x64",
  "win-x86",
  "release",
  "debug",
  "retail",
  "launcher",
  "redist",
  "redistributables",
  "_commonredist",
  "support",
  "directx",
  "dotnet",
  "vcredist",
  "engine",
  "native",
  "plugins",
  "setup",
  "install",
]);

function splitPath(p: string): string[] {
  return p.split(/[\\/]/).filter(Boolean);
}

function dirOf(p: string): string {
  const parts = splitPath(p);
  parts.pop();
  return parts.join("/");
}

function baseOf(p: string): string {
  const parts = splitPath(p);
  return parts[parts.length - 1] || p;
}

/**
 * Determine which "game folder" an executable belongs to by grouping on the
 * immediate subfolder of the scanned root. e.g. choosing `games` groups
 * `games/GameA/...`, `games/GameB/...` into "GameA" / "GameB".
 *
 * If the exe sits directly in the scanned folder (single-game-folder scan), or
 * only inside a helper/binary subfolder (bin, redist, ...), it belongs to the
 * scanned folder itself and is grouped under that folder's name.
 */
function groupKeyForExe(exePath: string, rootPath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]$/, "");
  const rootParts = splitPath(normalizedRoot);
  const rel = splitPath(exePath).slice(rootParts.length);

  if (rel.length <= 1) {
    // exe sits directly in the scanned folder (or is the folder itself)
    return baseOf(normalizedRoot);
  }

  const first = rel[0];
  if (!HELPER_DIRS.has(first.toLowerCase())) {
    // immediate subfolder of the scanned folder = a distinct game
    return first;
  }

  // The immediate child is a helper/binary folder; the exe belongs to the
  // scanned folder itself (a single-game-folder scan).
  return baseOf(normalizedRoot);
}

/** Score an executable as the most likely "main" game exe of a folder. */
function scoreExe(exe: ExeInfo, folderName: string): number {
  let score = 0;
  const fn = folderName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const stem = baseOf(exe.path)
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .replace(/[^a-z0-9]/g, "");

  if (fn && stem.includes(fn)) score += 60;
  if (fn && fn.includes(stem) && stem.length >= 3) score += 30;
  if (fn && stem === fn) score += 40;

  const depth = splitPath(dirOf(exe.path)).length;
  score -= depth * 5;
  score += Math.log10(exe.size + 1) * 3;

  const d = dirOf(exe.path).toLowerCase();
  if (/(^|[\\/])(bin|redist|support|directx|dotnet|vcredist)([\\/]|$)/.test(d)) {
    score -= 25;
  }
  return score;
}

function pickPrimary(exes: ExeInfo[], folderName: string): ExeInfo {
  let best = exes[0];
  let bestScore = -Infinity;
  for (const e of exes) {
    const s = scoreExe(e, folderName);
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  return best;
}

export interface ExeGroup {
  id: string;
  folderName: string;
  exes: ExeInfo[];
  suggestedPrimary: ExeInfo;
  primaryPath: string;
}

function groupExes(infos: ExeInfo[], rootPath: string): ExeGroup[] {
  const map = new Map<string, ExeInfo[]>();
  for (const info of infos) {
    const key = groupKeyForExe(info.path, rootPath);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(info);
  }

  const groups: ExeGroup[] = [];
  let idx = 0;
  for (const [folderName, exes] of map.entries()) {
    const suggested = pickPrimary(exes, folderName);
    groups.push({
      id: `${idx++}-${folderName}`,
      folderName,
      exes,
      suggestedPrimary: suggested,
      primaryPath: suggested.path,
    });
  }
  groups.sort((a, b) => a.folderName.localeCompare(b.folderName));
  return groups;
}

interface ImportModalProps {
  exeInfos: ExeInfo[];
  rootPath: string;
  onConfirm: (imports: { path: string; metadata: GameMetadataResult | null }[]) => void;
  onCancel: () => void;
}

export default function ImportModal({
  exeInfos,
  rootPath,
  onConfirm,
  onCancel,
}: ImportModalProps) {
  const { t } = useLanguage();
  // Group executables by their detected game folder.
  const groups = useMemo(
    () => (rootPath ? groupExes(exeInfos, rootPath) : []),
    [exeInfos, rootPath]
  );

  // Which game groups to import (keyed by group id).
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  // Which executable is the "main" exe for each group.
  const [primaryByGroup, setPrimaryByGroup] = useState<Record<string, string>>({});

  // Extra executables explicitly chosen for individual import.
  const [selectedExtraPaths, setSelectedExtraPaths] = useState<Set<string>>(new Set());

  // Expanded group sections (to reveal extra executables).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Active executable path for the detail/matching panel.
  const [activePath, setActivePath] = useState<string>("");

  // Search query strings per executable path.
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});

  // Matched IGDB game summaries per executable path.
  const [matches, setMatches] = useState<Record<string, StoreGameSummary | null>>({});

  // Cached IGDB full metadata details per game slug (for previews & import).
  const [previews, setPreviews] = useState<Record<string, GameMetadataResult>>({});

  // Cached IGDB suggestions lists per query string.
  const [suggestions, setSuggestions] = useState<Record<string, StoreGameSummary[]>>({});

  // Loading states.
  const [loadingSuggestions, setLoadingSuggestions] = useState<boolean>(false);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<string>("");

  const activeQuery = searchQueries[activePath] || "";

  // Initialize groups, primary selections and queries once the scan resolves.
  useEffect(() => {
    if (exeInfos.length > 0 && groups.length > 0) {
      const initialQueries: Record<string, string> = {};
      const groupIds = new Set<string>();
      const primaries: Record<string, string> = {};

      groups.forEach((g) => {
        groupIds.add(g.id);
        primaries[g.id] = g.suggestedPrimary.path;
        // Seed the main exe search with the folder name for better IGDB matches.
        initialQueries[g.suggestedPrimary.path] = g.folderName;
        g.exes.forEach((e) => {
          if (e.path !== g.suggestedPrimary.path) {
            initialQueries[e.path] = gameNameFromPath(e.path);
          }
        });
      });

      setSearchQueries(initialQueries);
      setSelectedGroupIds(groupIds);
      setPrimaryByGroup(primaries);
      setSelectedExtraPaths(new Set());
      setExpandedGroups(new Set());
      setActivePath(groups[0].primaryPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exeInfos, rootPath]);

  // Debounced search logic for suggestions.
  useEffect(() => {
    if (!activeQuery.trim()) {
      return;
    }

    if (suggestions[activeQuery]) {
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const results = await invoke<StoreGameSummary[]>("search_store_games", {
          query: activeQuery,
          offset: 0,
          limit: 8,
        });
        setSuggestions((prev) => ({ ...prev, [activeQuery]: results }));
      } catch (err) {
        console.error("IGDB suggestions search failed:", err);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [activeQuery, suggestions]);

  // Handle query input change.
  function handleQueryChange(val: string) {
    setSearchQueries((prev) => ({ ...prev, [activePath]: val }));
  }

  // Get suggestions for the active item.
  const activeSuggestions = suggestions[activeQuery] || [];

  // When active item changes, trigger an immediate search if it hasn't been searched yet.
  useEffect(() => {
    if (activePath && activeQuery && !suggestions[activeQuery] && !loadingSuggestions) {
      setLoadingSuggestions(true);
      invoke<StoreGameSummary[]>("search_store_games", {
        query: activeQuery,
        offset: 0,
        limit: 8,
      })
        .then((results) => {
          setSuggestions((prev) => ({ ...prev, [activeQuery]: results }));
        })
        .catch((err) => console.error("Immediate suggestions search failed:", err))
        .finally(() => setLoadingSuggestions(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // Link a suggestion to the active executable and fetch details.
  async function handleLinkGame(game: StoreGameSummary) {
    setMatches((prev) => ({ ...prev, [activePath]: game }));

    if (previews[game.slug]) {
      return;
    }

    setLoadingPreview(true);
    try {
      const detail = await invoke<GameMetadataResult | null>("get_store_game_detail", {
        slug: game.slug,
      });
      if (detail) {
        setPreviews((prev) => ({ ...prev, [game.slug]: detail }));
      }
    } catch (err) {
      console.error("Failed to fetch game details:", err);
    } finally {
      setLoadingPreview(false);
    }
  }

  // Remove the IGDB link for the active executable.
  function handleUnlinkGame() {
    setMatches((prev) => ({ ...prev, [activePath]: null }));
  }

  // ── Group selection helpers ──────────────────────────────────────────────
  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setPrimaryForGroup(id: string, path: string) {
    setPrimaryByGroup((prev) => ({ ...prev, [id]: path }));
    setSelectedExtraPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    setActivePath(path);
  }

  function toggleExtra(path: string) {
    setSelectedExtraPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allGroupsSelected = groups.length > 0 && selectedGroupIds.size === groups.length;
  const someGroupsSelected = selectedGroupIds.size > 0 && selectedGroupIds.size < groups.length;

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someGroupsSelected;
    }
  }, [someGroupsSelected]);

  function toggleSelectAllGroups() {
    if (allGroupsSelected) {
      setSelectedGroupIds(new Set());
    } else {
      setSelectedGroupIds(new Set(groups.map((g) => g.id)));
    }
  }

  const selectionCount = selectedGroupIds.size + selectedExtraPaths.size;

  // Build a single import entry for a path, fetching full metadata if needed.
  async function buildImportForPath(
    path: string
  ): Promise<{ path: string; metadata: GameMetadataResult | null }> {
    const match = matches[path];
    if (match) {
      let details = previews[match.slug];
      if (!details) {
        try {
          const fetched = await invoke<GameMetadataResult | null>("get_store_game_detail", {
            slug: match.slug,
          });
          if (fetched) {
            details = fetched;
            setPreviews((prev) => ({ ...prev, [match.slug]: fetched }));
          }
        } catch (err) {
          console.error(`Failed to fetch details for ${match.slug}:`, err);
        }
      }
      return { path, metadata: details || null };
    }
    return { path, metadata: null };
  }

  // Confirm import and download metadata/images.
  async function handleConfirm() {
    if (selectionCount === 0) return;
    setImporting(true);

    const importResults: { path: string; metadata: GameMetadataResult | null }[] = [];
    const seen = new Set<string>();

    try {
      const selectedGroups = groups.filter((g) => selectedGroupIds.has(g.id));
      let i = 0;
      for (const g of selectedGroups) {
        const path = primaryByGroup[g.id];
        i++;
        const fileName = g.folderName;
        setImportProgress(
          t("import.processing", {
            name: fileName,
            i,
            total: selectedGroups.length,
            extra: selectedExtraPaths.size ? ` + ${selectedExtraPaths.size} extra` : "",
          })
        );
        seen.add(path);
        importResults.push(await buildImportForPath(path));
      }

      const extras = Array.from(selectedExtraPaths).filter((p) => !seen.has(p));
      for (let j = 0; j < extras.length; j++) {
        const path = extras[j];
        setImportProgress(
          `Processing extra executable "${gameNameFromPath(path)}" (${j + 1} of ${extras.length})...`
        );
        importResults.push(await buildImportForPath(path));
      }

      onConfirm(importResults);
    } catch (err) {
      console.error("Import failed:", err);
    } finally {
      setImporting(false);
    }
  }

  // Format utility functions.
  function getDirectory(fullPath: string): string {
    const parts = fullPath.split(/[\\/]/);
    parts.pop();
    return parts.join("\\");
  }

  const activeMatch = matches[activePath] || null;
  const activeDetail = activeMatch ? previews[activeMatch.slug] : null;
  const showGroups = exeInfos.length > 1 && groups.length > 0;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className={`modal import-modal${showGroups ? " batch-import-layout" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {importing && (
          <div className="import-progress-overlay">
            <div className="import-progress-card">
              <div className="import-spinner" />
              <h3>{t("import.importing")}</h3>
              <p className="import-progress-status">{importProgress}</p>
            </div>
          </div>
        )}

        <div className="modal-header">
          <div className="modal-header-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">
              {showGroups
                ? t("import.title.multi", { count: groups.length })
                : exeInfos.length > 1
                ? t("import.title.scan")
                : t("import.title.single")}
            </h2>
            <p className="modal-subtitle">
              {showGroups
                ? t("import.subtitle.multi")
                : exeInfos.length > 1
                ? t("import.subtitle.scan", { count: exeInfos.length })
                : t("import.subtitle.single")}
            </p>
          </div>
        </div>

        {showGroups && (
          <div className="import-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>{t("import.banner")}</span>
          </div>
        )}

        <div className="modal-body-container">
          {/* Side panel with executables grouped by game folder */}
          {showGroups && (
            <div className="import-sidebar">
              <div className="import-sidebar-header">
                <label className="modal-select-all">
                  <input
                    type="checkbox"
                    checked={allGroupsSelected}
                    ref={selectAllRef}
                    onChange={toggleSelectAllGroups}
                  />
                  <span>
                    {t("import.selectAll", { selected: selectedGroupIds.size, total: groups.length })}
                  </span>
                </label>
              </div>
              <div className="import-sidebar-list">
                {groups.map((g) => {
                  const groupSelected = selectedGroupIds.has(g.id);
                  const primaryPath = primaryByGroup[g.id] ?? g.suggestedPrimary.path;
                  const isExpanded = expandedGroups.has(g.id);
                  const extras = g.exes.filter((e) => e.path !== primaryPath);
                  const primMatch = matches[primaryPath];

                  return (
                    <div
                      className={`import-group${groupSelected ? " selected" : ""}`}
                      key={g.id}
                    >
                      <div className="import-group-header">
                        <input
                          type="checkbox"
                          checked={groupSelected}
                          onChange={() => toggleGroup(g.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          className={`import-group-toggle${isExpanded ? " expanded" : ""}`}
                          onClick={() => toggleExpand(g.id)}
                          aria-label={isExpanded ? "Collapse" : "Expand"}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                        <div
                          className="import-group-info"
                          onClick={() => setActivePath(primaryPath)}
                        >
                          <span className="import-group-name">{g.folderName}</span>
                          {primMatch ? (
                            <span className="import-sidebar-item-match matched">
                              ✓ {primMatch.name}
                            </span>
                          ) : (
                            <span className="import-sidebar-item-match skipped">
                              ⚠ No Metadata Match
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="import-group-body">
                        <div
                          className={`import-sidebar-item primary${
                            activePath === primaryPath ? " active" : ""
                          }`}
                          onClick={() => setActivePath(primaryPath)}
                        >
                          <span className="suggested-badge">{t("import.suggested")}</span>
                          <div className="import-sidebar-item-info">
                            <span className="import-sidebar-item-filename">
                              {gameNameFromPath(primaryPath)}
                            </span>
                            <span className="import-sidebar-item-sub">
                              {t("import.mainExecutable")}
                            </span>
                          </div>
                        </div>

                        {isExpanded &&
                          extras.map((e) => {
                            const extraSelected = selectedExtraPaths.has(e.path);
                            const em = matches[e.path];
                            return (
                              <div
                                className={`import-sidebar-item extra${
                                  activePath === e.path ? " active" : ""
                                }`}
                                key={e.path}
                                onClick={() => setActivePath(e.path)}
                              >
                                <input
                                  type="checkbox"
                                  checked={extraSelected}
                                  onChange={(ev) => {
                                    ev.stopPropagation();
                                    toggleExtra(e.path);
                                  }}
                                  onClick={(ev) => ev.stopPropagation()}
                                />
                                <div className="import-sidebar-item-info">
                                  <span className="import-sidebar-item-filename">
                                    {gameNameFromPath(e.path)}
                                  </span>
                                  {em && (
                                    <span className="import-sidebar-item-match matched">
                                      ✓ {em.name}
                                    </span>
                                  )}
                                </div>
                                <button
                                  className="make-main-btn"
                                  title="Use this as the main game executable"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setPrimaryForGroup(g.id, e.path);
                                  }}
                                >
                                  {t("import.makeMain")}
                                </button>
                              </div>
                            );
                          })}

                        {!isExpanded && extras.length > 0 && (
                          <button
                            className="import-group-more"
                            onClick={() => toggleExpand(g.id)}
                          >
                            {t("import.showMore", { count: extras.length })}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Main workspace: matching interface */}
          <div className="import-workspace">
            {activePath ? (
              <div className="import-matching-area">
                {/* Path info header */}
                <div className="import-active-file-info">
                  <div className="file-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                  </div>
                  <div className="file-details">
                    <span className="file-label">{t("import.executableFile")}</span>
                    <span className="file-name">{gameNameFromPath(activePath)}</span>
                    <span className="file-path" title={activePath}>
                      {getDirectory(activePath)}
                    </span>
                  </div>
                </div>

                {/* IGDB search and recommendations */}
                <div className="import-search-row">
                  <div className="search-input-wrapper">
                    <svg
                      className="search-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      className="import-search-input"
                      placeholder="Search game on IGDB..."
                      value={activeQuery}
                      onChange={(e) => handleQueryChange(e.target.value)}
                    />
                    {activeQuery && (
                      <button className="clear-btn" onClick={() => handleQueryChange("")}>
                        ✖
                      </button>
                    )}
                  </div>
                </div>

                {/* Suggestions and Preview split */}
                <div className="import-matching-columns">
                  {/* Left: Suggestions list */}
                  <div className="import-suggestions-panel">
                    <h4 className="section-title">{t("import.igdbSuggestions")}</h4>
                    {loadingSuggestions ? (
                      <div className="suggestions-loader">
                        <div className="spinner-small" />
                        <span>{t("import.searchingIgdb")}</span>
                      </div>
                    ) : activeSuggestions.length > 0 ? (
                      <div className="suggestions-list">
                        {activeSuggestions.map((game) => {
                          const isLinked = activeMatch?.id === game.id;
                          const releaseYear = game.firstReleaseDate
                            ? new Date(game.firstReleaseDate).getFullYear()
                            : null;

                          return (
                            <button
                              key={game.id}
                              className={`suggestion-item${isLinked ? " linked" : ""}`}
                              onClick={() => handleLinkGame(game)}
                            >
                              <div className="suggestion-cover">
                                {game.coverUrl ? (
                                  <img src={game.coverUrl} alt={game.name} />
                                ) : (
                                  <div className="suggestion-cover-placeholder">?</div>
                                )}
                              </div>
                              <div className="suggestion-info">
                                <span className="suggestion-name">{game.name}</span>
                                <span className="suggestion-meta">
                                  {releaseYear ? `${releaseYear}` : "Unknown Year"}
                                  {game.platforms.length > 0 && ` · ${game.platforms[0]}`}
                                </span>
                              </div>
                              {isLinked && <span className="linked-badge">Linked</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="suggestions-empty">
                        <p>{t("import.noSuggestions")}</p>
                        <p className="subtext">{t("import.noSuggestionsHint")}</p>
                      </div>
                    )}
                  </div>

                  {/* Right: Detailed Preview */}
                  <div className="import-preview-panel">
                    <h4 className="section-title">{t("import.matchPreview")}</h4>
                    {loadingPreview ? (
                      <div className="preview-skeleton-loader">
                        <div className="skeleton-hero" />
                        <div className="skeleton-content">
                          <div className="skeleton-line title" />
                          <div className="skeleton-line text" />
                          <div className="skeleton-line text" />
                          <div className="skeleton-line text" />
                        </div>
                      </div>
                    ) : activeMatch ? (
                      <div className="game-preview-card">
                        {activeDetail ? (
                          <>
                            {activeDetail.images.hero && (
                              <div
                                className="preview-hero-banner"
                                style={{ backgroundImage: `url(${activeDetail.images.hero})` }}
                              />
                            )}
                            <div className="preview-main-info">
                              <div className="preview-cover">
                                {activeDetail.images.cover ? (
                                  <img
                                    src={activeDetail.images.cover}
                                    alt={activeDetail.title}
                                  />
                                ) : (
                                  <div className="preview-cover-placeholder">?</div>
                                )}
                              </div>
                              <div className="preview-metadata">
                                <h3 className="preview-title">{activeDetail.title}</h3>
                                <div className="preview-meta-row">
                                  {activeDetail.releaseDate && (
                                    <span className="meta-badge">
                                      {new Date(activeDetail.releaseDate).getFullYear()}
                                    </span>
                                  )}
                                  {activeDetail.igdbRating && (
                                    <span className="meta-badge rating">
                                      ★ {Math.round(activeDetail.igdbRating)}%
                                    </span>
                                  )}
                                </div>
                                <p className="preview-meta-label">
                                  <strong>Developer:</strong> {activeDetail.developer || "Unknown"}
                                </p>
                                <p className="preview-meta-label">
                                  <strong>Publisher:</strong> {activeDetail.publisher || "Unknown"}
                                </p>
                                <div className="preview-genres">
                                  {activeDetail.genres.slice(0, 3).map((g) => (
                                    <span key={g} className="genre-tag">
                                      {g}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="preview-summary-scroll">
                              {activeDetail.description && (
                                <div className="preview-summary">
                                  <p>{activeDetail.description}</p>
                                </div>
                              )}
                              {activeDetail.storyline && (
                                <div className="preview-storyline">
                                  <h5>Storyline</h5>
                                  <p>{activeDetail.storyline}</p>
                                </div>
                              )}
                              {activeDetail.timeToBeat && (activeDetail.timeToBeat.normally || activeDetail.timeToBeat.completely || activeDetail.timeToBeat.hastily) && (
                                <div className="preview-hltb" style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                                  <h5 style={{ margin: '0 0 var(--space-xs) 0', fontSize: 'var(--font-size-sm)', fontWeight: '600' }}>Time to Beat</h5>
                                  <div style={{ display: 'flex', gap: 'var(--space-md)', fontSize: 'var(--font-size-xs)' }}>
                                    {activeDetail.timeToBeat.normally && <div>Main Story: <strong>{Math.round(activeDetail.timeToBeat.normally / 3600)}h</strong></div>}
                                  {activeDetail.timeToBeat.hastily && <div>Rushed: <strong>{Math.round(activeDetail.timeToBeat.hastily / 3600)}h</strong></div>}
                                    {activeDetail.timeToBeat.completely && <div>Completionist: <strong>{Math.round(activeDetail.timeToBeat.completely / 3600)}h</strong></div>}
                                  </div>
                                </div>
                              )}
                              {activeDetail.igdbReviews && activeDetail.igdbReviews.length > 0 && (
                                <div className="preview-reviews-section" style={{ marginTop: 'var(--space-md)' }}>
                                  <h5 style={{ margin: '0 0 var(--space-xs) 0', fontSize: 'var(--font-size-sm)', fontWeight: '600' }}>Community Reviews ({activeDetail.igdbReviews.length})</h5>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', maxHeight: '180px', overflowY: 'auto' }}>
                                    {activeDetail.igdbReviews.slice(0, 3).map((rev, idx) => (
                                      <div key={idx} style={{ padding: 'var(--space-sm)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                                          <strong>{rev.username || 'Anonymous'}</strong>
                                          {rev.rating && <span style={{ color: 'var(--color-accent)' }}>{rev.rating}/100</span>}
                                        </div>
                                        {rev.title && <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: '600', marginBottom: '2px' }}>{rev.title}</div>}
                                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{rev.content}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            <button
                              className="preview-unlink-btn"
                              onClick={handleUnlinkGame}
                            >
                              {t("import.skipMetadata")}
                            </button>
                          </>
                        ) : (
                          // Fallback to summary fields if full details haven't finished loading yet
                          <>
                            <div className="preview-main-info">
                              <div className="preview-cover">
                                {activeMatch.coverUrl ? (
                                  <img src={activeMatch.coverUrl} alt={activeMatch.name} />
                                ) : (
                                  <div className="preview-cover-placeholder">?</div>
                                )}
                              </div>
                              <div className="preview-metadata">
                                <h3 className="preview-title">{activeMatch.name}</h3>
                                <div className="preview-meta-row">
                                  {activeMatch.firstReleaseDate && (
                                    <span className="meta-badge">
                                      {new Date(activeMatch.firstReleaseDate).getFullYear()}
                                    </span>
                                  )}
                                  {activeMatch.rating && (
                                    <span className="meta-badge rating">
                                      ★ {Math.round(activeMatch.rating)}%
                                    </span>
                                  )}
                                </div>
                                <div className="preview-genres">
                                  {activeMatch.genres.slice(0, 3).map((g) => (
                                    <span key={g} className="genre-tag">
                                      {g}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                            {activeMatch.summary && (
                              <div className="preview-summary-scroll">
                                <div className="preview-summary">
                                  <p>{activeMatch.summary}</p>
                                </div>
                              </div>
                            )}
                            <button
                              className="preview-unlink-btn"
                              onClick={handleUnlinkGame}
                            >
                              {t("import.skipMetadataShort")}
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="preview-empty">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                          <rect x="2" y="2" width="20" height="20" rx="2.5" />
                          <circle cx="12" cy="12" r="4" />
                          <line x1="12" y1="8" x2="12" y2="16" />
                          <line x1="8" y1="12" x2="16" y2="12" />
                        </svg>
                        <p>{t("import.noGameLinked")}</p>
                        <p className="subtext">
                          {t("import.noGameLinkedDesc", { name: gameNameFromPath(activePath) })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="import-workspace-empty">
                <p>{t("import.selectExecutable")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {t("import.selectedCount", { count: selectionCount })}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={selectionCount === 0}
              onClick={handleConfirm}
              leftIcon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              }
            >
              {t("import.importSelected")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
