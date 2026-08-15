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
 */
function groupKeyForExe(exePath: string, rootPath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]$/, "");
  const rootParts = splitPath(normalizedRoot);
  const rel = splitPath(exePath).slice(rootParts.length);

  if (rel.length <= 1) {
    return baseOf(normalizedRoot);
  }

  const first = rel[0];
  if (!HELPER_DIRS.has(first.toLowerCase())) {
    return first;
  }

  return baseOf(normalizedRoot);
}

/** Absolute path of the game folder an executable belongs to. */
function gameFolderForExe(exePath: string, rootPath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]$/, "");
  const rootParts = splitPath(normalizedRoot);
  const rel = splitPath(exePath).slice(rootParts.length);

  if (rel.length <= 1) return normalizedRoot;
  const first = rel[0];
  if (!HELPER_DIRS.has(first.toLowerCase())) {
    return [...rootParts, first].join("\\");
  }
  return normalizedRoot;
}

/** Directory of an exe relative to its game folder (empty when at the root). */
function relDirOf(exePath: string, groupRoot: string): string {
  if (!groupRoot) return "";
  const rootParts = splitPath(groupRoot.replace(/[\\/]$/, ""));
  const parts = splitPath(exePath);
  parts.pop();
  return parts.slice(rootParts.length).join("\\");
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
  /** Absolute path of the game folder this group was detected under. */
  rootDir: string;
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
      rootDir: gameFolderForExe(suggested.path, rootPath),
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
  /** Lowercased paths already present in the library (for "already in library" badges). */
  existingPaths?: string[];
  onConfirm: (
    imports: { path: string; metadata: GameMetadataResult | null }[],
    errors?: { name: string; message: string }[]
  ) => void;
  onCancel: () => void;
}

type Step = "review" | "link" | "confirm";

/** One entry the user will import — either a game folder's main exe or an extra. */
interface LinkItem {
  path: string;
  name: string;
  kind: "game" | "extra";
}

const STEP_LABEL_KEYS: Record<Step, string> = {
  review: "import.step.review",
  link: "import.step.link",
  confirm: "import.step.confirm",
};

// ── Review step ──────────────────────────────────────────────────────────────

interface ReviewStepProps {
  groups: ExeGroup[];
  selectedGroupIds: Set<string>;
  primaryByGroup: Record<string, string>;
  selectedExtraPaths: Set<string>;
  existingSet: Set<string>;
  onToggleGroup: (id: string) => void;
  onSelectAll: (ids?: string[]) => void;
  onDeselectAll: (ids?: string[]) => void;
  onSetPrimary: (id: string, path: string) => void;
  onToggleExtra: (path: string) => void;
}

function ReviewStep({
  groups,
  selectedGroupIds,
  primaryByGroup,
  selectedExtraPaths,
  existingSet,
  onToggleGroup,
  onSelectAll,
  onDeselectAll,
  onSetPrimary,
  onToggleExtra,
}: ReviewStepProps) {
  const { t } = useLanguage();
  const [filterQuery, setFilterQuery] = useState("");

  const filteredGroups = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      if (g.folderName.toLowerCase().includes(q)) return true;
      return g.exes.some((e) => gameNameFromPath(e.path).toLowerCase().includes(q));
    });
  }, [groups, filterQuery]);

  const visibleIds = useMemo(() => filteredGroups.map((g) => g.id), [filteredGroups]);
  const visibleSelectedCount = useMemo(
    () => filteredGroups.filter((g) => selectedGroupIds.has(g.id)).length,
    [filteredGroups, selectedGroupIds]
  );
  const totalSelectedCount = selectedGroupIds.size;
  const isAllVisibleSelected =
    filteredGroups.length > 0 && visibleSelectedCount === filteredGroups.length;
  const isSomeVisibleSelected = visibleSelectedCount > 0 && !isAllVisibleSelected;

  const masterCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isSomeVisibleSelected;
    }
  }, [isSomeVisibleSelected]);

  const handleMasterToggle = () => {
    if (isAllVisibleSelected) {
      onDeselectAll(visibleIds);
    } else {
      onSelectAll(visibleIds);
    }
  };

  return (
    <div className="import-review-container">
      <div className="import-review-toolbar">
        <div className="import-review-toolbar-left">
          <label
            className="import-review-master-toggle"
            title={isAllVisibleSelected ? t("import.review.deselectAll") : t("import.review.selectAll")}
          >
            <input
              ref={masterCheckboxRef}
              type="checkbox"
              checked={isAllVisibleSelected}
              onChange={handleMasterToggle}
            />
            <span className="import-review-master-label">
              {isAllVisibleSelected
                ? t("import.review.deselectAll")
                : t("import.review.selectAll")}
            </span>
          </label>
          <div className="import-review-actions-btn-group">
            <button
              type="button"
              className="import-mini-btn"
              onClick={() => onSelectAll(visibleIds)}
              disabled={isAllVisibleSelected}
            >
              {t("import.review.selectAll")}
            </button>
            <button
              type="button"
              className="import-mini-btn"
              onClick={() => onDeselectAll(visibleIds)}
              disabled={visibleSelectedCount === 0}
            >
              {t("import.review.deselectAll")}
            </button>
          </div>
        </div>

        <div className="import-review-toolbar-right">
          {groups.length > 3 && (
            <div className="import-review-filter-wrapper">
              <svg
                className="import-filter-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="import-review-filter-input"
                placeholder={t("import.review.filterPlaceholder")}
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
              />
              {filterQuery && (
                <button
                  type="button"
                  className="clear-btn"
                  onClick={() => setFilterQuery("")}
                >
                  ✖
                </button>
              )}
            </div>
          )}
          <span className="import-review-selected-badge">
            {t("import.review.selectedRatio", {
              selected: totalSelectedCount,
              total: groups.length,
            })}
          </span>
        </div>
      </div>

      <div className="import-review">
        {filteredGroups.length === 0 ? (
          <div className="import-review-empty">
            <p>{t("import.review.noFilterResults", { query: filterQuery })}</p>
          </div>
        ) : (
          filteredGroups.map((g) => {
            const selected = selectedGroupIds.has(g.id);
            const primaryPath = primaryByGroup[g.id] ?? g.suggestedPrimary.path;
            const others = g.exes.filter((e) => e.path !== primaryPath);
            const inLibrary = existingSet.has(primaryPath.toLowerCase());

            return (
              <div className={`import-review-card${selected ? "" : " excluded"}`} key={g.id}>
                <div className="import-review-card-head">
                  <label className="import-review-toggle">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleGroup(g.id)}
                    />
                    <span className="import-review-name">{g.folderName}</span>
                  </label>
                  {inLibrary ? (
                    <span className="import-review-badge library">
                      ♻ {t("import.alreadyInLibrary")}
                    </span>
                  ) : (
                    <span className="import-review-count">
                      {g.exes.length === 1
                        ? t("import.review.oneExe")
                        : t("import.review.exeCount", { count: g.exes.length })}
                    </span>
                  )}
                </div>

                {selected && (
                  <div className="import-review-card-body">
                    {g.exes.length > 1 ? (
                      <label className="import-review-field">
                        <span className="import-review-field-label">
                          {t("import.mainExecutable")}
                          {g.suggestedPrimary.path === primaryPath && (
                            <span className="suggested-badge">{t("import.suggested")}</span>
                          )}
                        </span>
                        <select
                          className="import-review-select"
                          value={primaryPath}
                          onChange={(e) => onSetPrimary(g.id, e.target.value)}
                        >
                          {g.exes.map((e) => {
                            const rel = relDirOf(e.path, g.rootDir);
                            return (
                              <option key={e.path} value={e.path}>
                                {gameNameFromPath(e.path)}
                                {rel ? ` — ${rel}` : ""}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    ) : (
                      <div className="import-review-field">
                        <span className="import-review-field-label">{t("import.mainExecutable")}</span>
                        <span className="import-review-single-exe">
                          {gameNameFromPath(primaryPath)}
                        </span>
                      </div>
                    )}

                    {others.length > 0 && (
                      <div className="import-review-extras">
                        <span className="import-review-field-label">
                          {t("import.review.otherExes")}
                        </span>
                        {others.map((e) => {
                          const checked = selectedExtraPaths.has(e.path);
                          const rel = relDirOf(e.path, g.rootDir);
                          return (
                            <label className="import-review-extra" key={e.path} title={e.path}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggleExtra(e.path)}
                              />
                              <span className="import-review-extra-detail">
                                <span className="import-review-extra-name">
                                  {gameNameFromPath(e.path)}
                                </span>
                                {rel && <span className="import-review-extra-path">{rel}</span>}
                              </span>
                              <span className="import-review-extra-hint">
                                {t("import.review.importAsExtra")}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Link step ────────────────────────────────────────────────────────────────

interface LinkStepProps {
  items: LinkItem[];
  activePath: string;
  existingSet: Set<string>;
  matches: Record<string, StoreGameSummary | null>;
  previews: Record<string, GameMetadataResult>;
  suggestions: Record<string, StoreGameSummary[]>;
  searchQueries: Record<string, string>;
  loadingSuggestions: boolean;
  loadingPreview: boolean;
  searchError: boolean;
  detailError: boolean;
  onSelect: (path: string) => void;
  onQueryChange: (val: string) => void;
  onLinkGame: (game: StoreGameSummary) => void;
  onUnlink: () => void;
  onRetrySearch: () => void;
  onRetryDetail: () => void;
  onSkipAll: () => void;
}

function LinkStep({
  items,
  activePath,
  existingSet,
  matches,
  previews,
  suggestions,
  searchQueries,
  loadingSuggestions,
  loadingPreview,
  searchError,
  detailError,
  onSelect,
  onQueryChange,
  onLinkGame,
  onUnlink,
  onRetrySearch,
  onRetryDetail,
  onSkipAll,
}: LinkStepProps) {
  const { t } = useLanguage();

  const activeMatch = matches[activePath] ?? null;
  const activeDetail = activeMatch ? previews[activeMatch.slug] : null;
  const activeQuery = searchQueries[activePath] || "";
  const activeSuggestions = suggestions[activeQuery] || [];
  const matchedCount = items.filter((i) => matches[i.path]).length;

  return (
    <div className="import-link-layout">
      {items.length > 1 && (
        <div className="import-link-list">
          <div className="import-link-list-header">
            <span className="import-link-list-count">
              {t("import.link.items", { matched: matchedCount, total: items.length })}
            </span>
            <button
              type="button"
              className="import-mini-btn"
              onClick={onSkipAll}
              disabled={matchedCount === 0}
            >
              {t("import.link.skipAll")}
            </button>
          </div>
          <div className="import-link-items">
            {items.map((item) => {
              const m = matches[item.path];
              const isActive = item.path === activePath;
              const inLibrary = existingSet.has(item.path.toLowerCase());
              return (
                <button
                  type="button"
                  className={`import-link-item${isActive ? " active" : ""}`}
                  key={item.path}
                  onClick={() => onSelect(item.path)}
                >
                  <span className="import-link-item-name">{item.name}</span>
                  {item.kind === "extra" && (
                    <span className="import-link-item-kind">{t("import.extra")}</span>
                  )}
                  {inLibrary ? (
                    <span className="import-link-item-status library">
                      ♻ {t("import.alreadyInLibrary")}
                    </span>
                  ) : m ? (
                    <span className="import-link-item-status matched">✓ {m.name}</span>
                  ) : (
                    <span className="import-link-item-status unmatched">
                      ⚠ {t("import.link.unmatched")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="import-workspace">
        {activePath ? (
          <div className="import-matching-area">
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
                  placeholder={t("import.searchIgdb")}
                  value={activeQuery}
                  onChange={(e) => onQueryChange(e.target.value)}
                />
                {activeQuery && (
                  <button className="clear-btn" onClick={() => onQueryChange("")}>
                    ✖
                  </button>
                )}
              </div>
            </div>

            <div className="import-matching-columns">
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
                          onClick={() => onLinkGame(game)}
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
                              {releaseYear ? `${releaseYear}` : t("import.unknownYear")}
                              {game.platforms.length > 0 && ` · ${game.platforms[0]}`}
                            </span>
                          </div>
                          {isLinked && <span className="linked-badge">{t("import.linked")}</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : searchError ? (
                  <div className="suggestions-empty error">
                    <p>{t("import.searchFailed")}</p>
                    <button type="button" className="import-retry-btn" onClick={onRetrySearch}>
                      {t("import.retry")}
                    </button>
                  </div>
                ) : (
                  <div className="suggestions-empty">
                    <p>{t("import.noSuggestions")}</p>
                    <p className="subtext">{t("import.noSuggestionsHint")}</p>
                  </div>
                )}
              </div>

              <div className="import-preview-panel">
                <h4 className="section-title">{t("import.matchPreview")}</h4>
                {detailError && (
                  <div className="import-detail-error">
                    <span>{t("import.detailLoadFailed")}</span>
                    <button
                      type="button"
                      className="import-retry-btn"
                      onClick={onRetryDetail}
                    >
                      {t("import.retry")}
                    </button>
                  </div>
                )}
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
                              <img src={activeDetail.images.cover} alt={activeDetail.title} />
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
                              <strong>{t("edit.label.developer")}:</strong>{" "}
                              {activeDetail.developer || t("splash.unknown")}
                            </p>
                            <p className="preview-meta-label">
                              <strong>{t("edit.label.publisher")}:</strong>{" "}
                              {activeDetail.publisher || t("splash.unknown")}
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
                              <h5>{t("edit.label.storyline")}</h5>
                              <p>{activeDetail.storyline}</p>
                            </div>
                          )}
                        </div>
                        <button className="preview-unlink-btn" onClick={onUnlink}>
                          {t("import.skipMetadata")}
                        </button>
                      </>
                    ) : (
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
                        <button className="preview-unlink-btn" onClick={onUnlink}>
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
            <p>{t("import.link.nothingToLink")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Confirm step ─────────────────────────────────────────────────────────────

interface ConfirmStepProps {
  items: LinkItem[];
  matches: Record<string, StoreGameSummary | null>;
}

function ConfirmStep({ items, matches }: ConfirmStepProps) {
  const { t } = useLanguage();
  const withMeta = items.filter((i) => matches[i.path]).length;
  const without = items.length - withMeta;

  return (
    <div className="import-confirm">
      <div className="import-confirm-summary">
        <div className="import-confirm-total">
          {t("import.confirm.total", { count: items.length })}
        </div>
        <div className="import-confirm-breakdown">
          <span className="import-confirm-chip meta">
            ✓ {t("import.confirm.withMeta", { count: withMeta })}
          </span>
          <span className="import-confirm-chip plain">
            {t("import.confirm.withoutMeta", { count: without })}
          </span>
        </div>
      </div>

      <div className="import-confirm-list">
        {items.map((item) => {
          const m = matches[item.path];
          return (
            <div className="import-confirm-item" key={item.path}>
              <div className="import-confirm-item-info">
                <span className="import-confirm-item-name">{m ? m.name : gameNameFromPath(item.path)}</span>
                <span className="import-confirm-item-path" title={item.path}>
                  {item.path}
                </span>
              </div>
              <span className={`import-confirm-item-status${m ? " matched" : ""}`}>
                {m ? t("import.confirm.metadata") : t("import.confirm.nameOnly")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main modal ───────────────────────────────────────────────────────────────

export default function ImportModal({
  exeInfos,
  rootPath,
  existingPaths,
  onConfirm,
  onCancel,
}: ImportModalProps) {
  const { t } = useLanguage();

  const existingSet = useMemo(
    () => new Set((existingPaths ?? []).map((p) => p.toLowerCase())),
    [existingPaths]
  );

  const groups = useMemo(() => {
    if (rootPath) return groupExes(exeInfos, rootPath);
    return exeInfos.map((info, idx) => ({
      id: `${idx}-${baseOf(info.path)}`,
      folderName: baseOf(info.path),
      rootDir: dirOf(info.path),
      exes: [info],
      suggestedPrimary: info,
      primaryPath: info.path,
    }));
  }, [exeInfos, rootPath]);

  // The review step is only useful when there's something to disambiguate:
  // multiple game folders, or multiple executables inside a single folder.
  const steps: Step[] = useMemo(() => {
    const needsReview = groups.length > 1 || groups.some((g) => g.exes.length > 1);
    return needsReview ? ["review", "link", "confirm"] : ["link", "confirm"];
  }, [groups]);

  const [step, setStep] = useState<Step>(() =>
    groups.length > 1 || groups.some((g) => g.exes.length > 1) ? "review" : "link"
  );

  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [primaryByGroup, setPrimaryByGroup] = useState<Record<string, string>>({});
  const [selectedExtraPaths, setSelectedExtraPaths] = useState<Set<string>>(new Set());

  const [activePath, setActivePath] = useState<string>("");
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<Record<string, StoreGameSummary | null>>({});
  const [previews, setPreviews] = useState<Record<string, GameMetadataResult>>({});
  const [suggestions, setSuggestions] = useState<Record<string, StoreGameSummary[]>>({});
  const [loadingSuggestions, setLoadingSuggestions] = useState<boolean>(false);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<boolean>(false);
  const searchToken = useRef(0);

  const [importing, setImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<string>("");

  const activeQuery = searchQueries[activePath] || "";

  // Initialize groups, selections and queries once the scan resolves.
  useEffect(() => {
    if (exeInfos.length > 0 && groups.length > 0) {
      const initialQueries: Record<string, string> = {};
      const groupIds = new Set<string>();
      const primaries: Record<string, string> = {};

      groups.forEach((g) => {
        groupIds.add(g.id);
        primaries[g.id] = g.suggestedPrimary.path;
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
      setActivePath(groups[0].primaryPath);
      setStep(groups.length > 1 || groups.some((g) => g.exes.length > 1) ? "review" : "link");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exeInfos, rootPath]);

  // Guarded, debounced IGDB suggestion search for the active executable.
  useEffect(() => {
    const q = searchQueries[activePath] || "";
    setSearchError(false);
    if (!q.trim() || suggestions[q]) {
      return;
    }

    const token = ++searchToken.current;
    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const results = await invoke<StoreGameSummary[]>("search_store_games", {
          query: q,
          offset: 0,
          limit: 8,
        });
        if (token === searchToken.current) {
          setSuggestions((prev) => ({ ...prev, [q]: results }));
        }
      } catch (err) {
        console.error("IGDB suggestions search failed:", err);
        if (token === searchToken.current) setSearchError(true);
      } finally {
        if (token === searchToken.current) setLoadingSuggestions(false);
      }
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, activeQuery]);

  // The flat list of items that will be imported (selected games + extras).
  const importItems: LinkItem[] = useMemo(() => {
    const items: LinkItem[] = [];
    for (const g of groups) {
      if (!selectedGroupIds.has(g.id)) continue;
      const path = primaryByGroup[g.id] ?? g.suggestedPrimary.path;
      items.push({ path, name: g.folderName, kind: "game" });
    }

    const groupIdByPath = new Map<string, string>();
    for (const g of groups) {
      for (const e of g.exes) groupIdByPath.set(e.path, g.id);
    }

    for (const p of selectedExtraPaths) {
      const gid = groupIdByPath.get(p);
      if (!gid || !selectedGroupIds.has(gid)) continue;
      const primary = primaryByGroup[gid];
      if (p === primary) continue;
      items.push({ path: p, name: gameNameFromPath(p), kind: "extra" });
    }
    return items;
  }, [groups, selectedGroupIds, primaryByGroup, selectedExtraPaths]);

  const gamesCount = selectedGroupIds.size;
  const extrasCount = importItems.filter((i) => i.kind === "extra").length;
  const selectionCount = importItems.length;

  function toggleGroup(id: string) {
    const group = groups.find((g) => g.id === id);
    const willSelect = !selectedGroupIds.has(id);
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (willSelect) next.add(id);
      else next.delete(id);
      return next;
    });

    // Clearing a group also clears its individually-checked extras.
    if (!willSelect && group) {
      setSelectedExtraPaths((prev) => {
        const next = new Set(prev);
        group.exes.forEach((e) => next.delete(e.path));
        return next;
      });
    }
  }

  function handleSelectAll(ids?: string[]) {
    if (ids && ids.length > 0) {
      setSelectedGroupIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    } else {
      setSelectedGroupIds(new Set(groups.map((g) => g.id)));
    }
  }

  function handleDeselectAll(ids?: string[]) {
    if (ids && ids.length > 0) {
      const idsSet = new Set(ids);
      setSelectedGroupIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setSelectedExtraPaths((prev) => {
        const next = new Set(prev);
        for (const g of groups) {
          if (idsSet.has(g.id)) {
            g.exes.forEach((e) => next.delete(e.path));
          }
        }
        return next;
      });
    } else {
      setSelectedGroupIds(new Set());
      setSelectedExtraPaths(new Set());
    }
  }

  function setPrimaryForGroup(id: string, path: string) {
    setPrimaryByGroup((prev) => ({ ...prev, [id]: path }));
    // The new main is no longer an "extra" of this group.
    setSelectedExtraPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }

  function toggleExtra(path: string) {
    setSelectedExtraPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleQueryChange(val: string) {
    setSearchQueries((prev) => ({ ...prev, [activePath]: val }));
  }

  function retrySearch() {
    if (!activeQuery.trim()) return;
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[activeQuery];
      return next;
    });
    setSearchError(false);
  }

  async function handleLinkGame(game: StoreGameSummary) {
    setMatches((prev) => ({ ...prev, [activePath]: game }));
    setDetailError(false);

    if (previews[game.slug]) return;

    setLoadingPreview(true);
    try {
      const detail = await invoke<GameMetadataResult | null>("get_store_game_detail", {
        slug: game.slug,
      });
      if (detail) {
        setPreviews((prev) => ({ ...prev, [game.slug]: detail }));
      } else {
        setDetailError(true);
      }
    } catch (err) {
      console.error("Failed to fetch game details:", err);
      setDetailError(true);
    } finally {
      setLoadingPreview(false);
    }
  }

  function handleUnlinkGame() {
    setMatches((prev) => ({ ...prev, [activePath]: null }));
  }

  function retryDetail() {
    const match = matches[activePath];
    if (match) void handleLinkGame(match);
  }

  function skipAllMatches() {
    setMatches({});
    setDetailError(false);
  }

  function goNext() {
    const idx = steps.indexOf(step);
    if (idx < 0 || idx >= steps.length - 1) return;
    const nextStep = steps[idx + 1];
    if (nextStep === "link" && importItems.length > 0) {
      const stillListed = importItems.some((i) => i.path === activePath);
      if (!stillListed) setActivePath(importItems[0].path);
    }
    setStep(nextStep);
  }

  function goBack() {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  }

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

  async function handleConfirm() {
    if (selectionCount === 0) return;
    setImporting(true);
    setImportProgress(t("import.importing"));

    const importResults: { path: string; metadata: GameMetadataResult | null }[] = [];
    const importErrors: { name: string; message: string }[] = [];

    try {
      const games = importItems.filter((i) => i.kind === "game");
      const extras = importItems.filter((i) => i.kind === "extra");

      for (let i = 0; i < games.length; i++) {
        const item = games[i];
        setImportProgress(
          t("import.processing", {
            name: item.name,
            i: i + 1,
            total: games.length,
            extra: extras.length ? t("import.extraSuffix", { count: extras.length }) : "",
          })
        );
        try {
          importResults.push(await buildImportForPath(item.path));
        } catch (err) {
          console.error(`Import failed for ${item.path}:`, err);
          importErrors.push({ name: item.name, message: String(err) });
        }
      }

      for (let j = 0; j < extras.length; j++) {
        const item = extras[j];
        setImportProgress(
          t("import.processingExtra", { name: item.name, i: j + 1, total: extras.length })
        );
        try {
          importResults.push(await buildImportForPath(item.path));
        } catch (err) {
          console.error(`Import failed for ${item.path}:`, err);
          importErrors.push({ name: item.name, message: String(err) });
        }
      }
    } finally {
      setImporting(false);
    }

    onConfirm(importResults, importErrors);
  }

  const headerTitle =
    step === "review"
      ? t("import.review.title")
      : step === "link"
      ? t("import.link.title")
      : t("import.confirm.title");
  const headerSubtitle =
    step === "review"
      ? t("import.review.subtitle", { count: groups.length })
      : step === "link"
      ? t("import.link.subtitle")
      : t("import.confirm.subtitle");

  const footerCount =
    selectionCount === 1
      ? t("import.selectedCountOne")
      : extrasCount === 0
      ? t("import.selectedCount", { count: gamesCount })
      : t("import.selectionSummary", { games: gamesCount, extras: extrasCount });

  const stepIndex = steps.indexOf(step);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className={`modal import-modal import-wizard${steps.length > 2 ? " batch-import-layout" : ""}`}
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
            <h2 className="modal-title">{headerTitle}</h2>
            <p className="modal-subtitle">{headerSubtitle}</p>
          </div>
        </div>

        <div className="import-stepper">
          {steps.map((s, i) => {
            const isActive = step === s;
            const isDone = stepIndex > i;
            return (
              <div
                key={s}
                aria-current={isActive ? "step" : undefined}
                className={`import-step${isActive ? " active" : ""}${isDone ? " done" : ""}`}
              >
                <span className="import-step-dot">{isDone ? "✓" : i + 1}</span>
                <span className="import-step-label">{t(STEP_LABEL_KEYS[s])}</span>
              </div>
            );
          })}
        </div>

        <div className="modal-body-container import-wizard-body">
          {step === "review" && (
            <ReviewStep
              groups={groups}
              selectedGroupIds={selectedGroupIds}
              primaryByGroup={primaryByGroup}
              selectedExtraPaths={selectedExtraPaths}
              existingSet={existingSet}
              onToggleGroup={toggleGroup}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onSetPrimary={setPrimaryForGroup}
              onToggleExtra={toggleExtra}
            />
          )}
          {step === "link" && (
            <LinkStep
              items={importItems}
              activePath={activePath}
              existingSet={existingSet}
              matches={matches}
              previews={previews}
              suggestions={suggestions}
              searchQueries={searchQueries}
              loadingSuggestions={loadingSuggestions}
              loadingPreview={loadingPreview}
              searchError={searchError}
              detailError={detailError}
              onSelect={setActivePath}
              onQueryChange={handleQueryChange}
              onLinkGame={handleLinkGame}
              onUnlink={handleUnlinkGame}
              onRetrySearch={retrySearch}
              onRetryDetail={retryDetail}
              onSkipAll={skipAllMatches}
            />
          )}
          {step === "confirm" && <ConfirmStep items={importItems} matches={matches} />}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">{footerCount}</span>
          <div className="modal-footer-actions">
            {stepIndex > 0 && (
              <Button variant="ghost" onClick={goBack}>
                {t("common.back")}
              </Button>
            )}
            {step !== "confirm" ? (
              <Button
                variant="primary"
                disabled={step === "review" && selectionCount === 0}
                onClick={goNext}
              >
                {t("common.next")}
              </Button>
            ) : (
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
                {t("import.confirm.importButton", { count: selectionCount })}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function getDirectory(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/);
  parts.pop();
  return parts.join("\\");
}
