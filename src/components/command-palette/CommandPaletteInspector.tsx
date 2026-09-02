import { useState } from "react";
import {
  ExternalLink,
  Gamepad2,
  HardDrive,
  Clock,
  Calendar,
  Copy,
  Check,
  Sparkles,
  Trophy,
  Download,
  Globe,
  Calculator,
  Heart,
  BarChart3,
  Dices,
  Play,
  Timer,
  Maximize,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { PaletteItem } from "./commandPaletteTypes";
import { formatBytes, formatRelativeTime } from "./commandPaletteUtils";

interface CommandPaletteInspectorProps {
  item: PaletteItem | null;
  t: (key: string, vars?: Record<string, unknown>) => string;
  onOpenActionDrawer?: () => void;
  onOpenDownloadModal?: (target: { name: string; id?: string; poster?: string }) => void;
  isWishlisted?: (slug: string) => boolean;
  toggleWishlist?: (game: any) => void;
  onLaunchGame?: (game: any) => void;
}

export default function CommandPaletteInspector({
  item,
  t,
  onOpenActionDrawer,
  onOpenDownloadModal,
  isWishlisted,
  toggleWishlist,
  onLaunchGame,
}: CommandPaletteInspectorProps) {
  const [copied, setCopied] = useState(false);

  if (!item) {
    return (
      <div className="cmd-inspector cmd-inspector--empty">
        <div className="cmd-inspector-empty-inner">
          <Sparkles className="cmd-inspector-empty-icon" />
          <p className="cmd-inspector-empty-text">{t("commandPalette.inspectorEmpty")}</p>
          <span className="cmd-inspector-empty-hint">{t("commandPalette.inspectorEmptyHint")}</span>
        </div>
      </div>
    );
  }

  const {
    gameData,
    storeData,
    swatchColors,
    calcData,
    downloadData,
    achievementStats,
    statsData,
    randomGameData,
  } = item;

  const handleCopy = (textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openExternalUrl = (url: string) => {
    invoke("open_url", { url }).catch(() => {
      window.open(url, "_blank");
    });
  };

  // 1. CALCULATOR / MATH / CONVERSION / ESTIMATOR INSPECTOR
  if (calcData) {
    const isDownload = calcData.calcType === "download";
    const isResolution = calcData.calcType === "resolution";

    return (
      <div className="cmd-inspector">
        <div className="cmd-inspector-calc-hero">
          {isDownload ? (
            <Timer className="cmd-inspector-calc-icon" size={36} />
          ) : isResolution ? (
            <Maximize className="cmd-inspector-calc-icon" size={36} />
          ) : (
            <Calculator className="cmd-inspector-calc-icon" size={36} />
          )}
          <div className="cmd-inspector-calc-result">{calcData.result}</div>
          <div className="cmd-inspector-calc-expr">{calcData.expression}</div>
        </div>

        <div className="cmd-inspector-body">
          {calcData.details && (
            <div className="cmd-inspector-section">
              <span className="cmd-inspector-label">{t("commandPalette.calcDetails")}</span>
              <p className="cmd-inspector-desc">{calcData.details}</p>
            </div>
          )}

          <div className="cmd-inspector-calc-actions">
            <button
              type="button"
              className="cmd-inspector-btn cmd-inspector-btn--primary"
              onClick={() => handleCopy(calcData.result)}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? t("commandPalette.copied") : t("commandPalette.copyResult")}</span>
            </button>
          </div>
        </div>

        <div className="cmd-inspector-footer">
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">↵</kbd>
            <span>{t("commandPalette.copyResult")}</span>
          </div>
        </div>
      </div>
    );
  }

  // 2. RANDOM GAME PICKER / SURPRISE ME INSPECTOR
  if (randomGameData) {
    const game = randomGameData.game;
    const heroImage = game.bannerUrl || game.coverArtUrl;

    return (
      <div className="cmd-inspector">
        <div className="cmd-inspector-hero">
          {heroImage ? (
            <img src={heroImage} alt="" className="cmd-inspector-hero-img" loading="lazy" />
          ) : (
            <div className="cmd-inspector-hero-placeholder">
              <Dices size={40} />
            </div>
          )}
          <div className="cmd-inspector-hero-overlay" />
          <div className="cmd-inspector-hero-content">
            <div className="cmd-inspector-hero-badges">
              <span className="cmd-badge cmd-badge--accent">
                <Dices size={9} />
                SURPRISE ME
              </span>
              {game.installed && (
                <span className="cmd-badge cmd-badge--installed">
                  {t("commandPalette.badgeInstalled")}
                </span>
              )}
              <span className="cmd-badge cmd-badge--platform">{game.platform || "PC"}</span>
            </div>
            <h3 className="cmd-inspector-title">{game.name}</h3>
          </div>
        </div>

        <div className="cmd-inspector-body">
          <div className="cmd-inspector-grid">
            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">
                <Clock size={12} />
                {t("commandPalette.inspectorPlaytime")}
              </span>
              <span className="cmd-inspector-stat-val">{game.playTime || "0h"}</span>
            </div>
            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">
                <Calendar size={12} />
                {t("commandPalette.inspectorLastPlayed")}
              </span>
              <span className="cmd-inspector-stat-val">
                {formatRelativeTime(game.lastPlayed) || t("commandPalette.neverPlayed")}
              </span>
            </div>
          </div>

          <div className="cmd-inspector-quick-action-row" style={{ marginTop: "12px" }}>
            <button
              type="button"
              className="cmd-inspector-btn cmd-inspector-btn--accent"
              onClick={() => {
                if (game.installed && onLaunchGame) {
                  onLaunchGame(game);
                } else if (item.onSelect) {
                  item.onSelect();
                }
              }}
            >
              <Play size={13} fill="currentColor" />
              <span>{game.installed ? t("commandPalette.launch") : t("commandPalette.open")}</span>
            </button>
            <button
              type="button"
              className="cmd-inspector-btn"
              onClick={randomGameData.onReroll}
            >
              <Dices size={13} />
              <span>{t("commandPalette.reroll")}</span>
            </button>
          </div>
        </div>

        <div className="cmd-inspector-footer">
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">↵</kbd>
            <span>{game.installed ? t("commandPalette.launch") : t("commandPalette.open")}</span>
          </div>
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">Ctrl+R</kbd>
            <span>{t("commandPalette.reroll")}</span>
          </div>
        </div>
      </div>
    );
  }

  // 3. LIBRARY STATISTICS KPI INSPECTOR
  if (statsData) {
    return (
      <div className="cmd-inspector">
        <div className="cmd-inspector-action-hero">
          <div className="cmd-inspector-action-icon">
            <BarChart3 size={28} />
          </div>
          <h3 className="cmd-inspector-title" style={{ marginTop: "12px" }}>
            {t("commandPalette.libraryStats")}
          </h3>
          <span className="cmd-badge cmd-badge--accent" style={{ marginTop: "6px" }}>
            {statsData.totalGames} {t("commandPalette.scopeGames")}
          </span>
        </div>

        <div className="cmd-inspector-body">
          <div className="cmd-inspector-grid">
            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">
                <Gamepad2 size={12} />
                {t("commandPalette.installedGames")}
              </span>
              <span className="cmd-inspector-stat-val">{statsData.installedGames}</span>
            </div>

            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">
                <HardDrive size={12} />
                {t("commandPalette.totalDiskSpace")}
              </span>
              <span className="cmd-inspector-stat-val">
                {formatBytes(statsData.totalSizeBytes) || "0 GB"}
              </span>
            </div>

            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">
                <Clock size={12} />
                {t("commandPalette.totalPlaytime")}
              </span>
              <span className="cmd-inspector-stat-val">{statsData.totalPlaytimeHours}h</span>
            </div>

            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">
                <Heart size={12} />
                {t("commandPalette.favoriteGames")}
              </span>
              <span className="cmd-inspector-stat-val">{statsData.favoriteCount}</span>
            </div>
          </div>

          {statsData.topPlayedGame && (
            <div className="cmd-inspector-section" style={{ marginTop: "12px" }}>
              <span className="cmd-inspector-label">{t("commandPalette.mostPlayedTitle")}</span>
              <div className="cmd-stats-highlight-card">
                {statsData.topPlayedGame.coverArtUrl && (
                  <img
                    src={statsData.topPlayedGame.coverArtUrl}
                    alt=""
                    className="cmd-stats-highlight-thumb"
                  />
                )}
                <div>
                  <div className="cmd-stats-highlight-name">{statsData.topPlayedGame.name}</div>
                  <div className="cmd-stats-highlight-time">{statsData.topPlayedGame.playTime}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="cmd-inspector-footer">
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">↵</kbd>
            <span>{t("commandPalette.viewLibraryPage")}</span>
          </div>
        </div>
      </div>
    );
  }

  // 4. GAME DETAIL INSPECTOR
  if (gameData) {
    const isRunning = item.badgeType === "success";
    const heroImage = gameData.bannerUrl || gameData.coverArtUrl;
    const lastPlayedStr = formatRelativeTime(gameData.lastPlayed);
    const sizeStr = formatBytes(gameData.sizeBytes);

    return (
      <div className="cmd-inspector">
        {/* Hero Banner Header */}
        <div className="cmd-inspector-hero">
          {heroImage ? (
            <img src={heroImage} alt="" className="cmd-inspector-hero-img" loading="lazy" />
          ) : (
            <div className="cmd-inspector-hero-placeholder">
              <Gamepad2 size={40} />
            </div>
          )}
          <div className="cmd-inspector-hero-overlay" />
          <div className="cmd-inspector-hero-content">
            <div className="cmd-inspector-hero-badges">
              {isRunning && (
                <span className="cmd-badge cmd-badge--running">
                  <span className="cmd-pulse-dot" />
                  {t("commandPalette.badgeRunning")}
                </span>
              )}
              {gameData.installed ? (
                <span className="cmd-badge cmd-badge--installed">
                  {t("commandPalette.badgeInstalled")}
                </span>
              ) : (
                <span className="cmd-badge cmd-badge--cloud">
                  {t("commandPalette.badgeNotInstalled")}
                </span>
              )}
              <span className="cmd-badge cmd-badge--platform">
                {gameData.platform || "PC"}
              </span>
              {gameData.favorite && (
                <span className="cmd-badge cmd-badge--accent">
                  <Heart size={9} fill="currentColor" />
                  FAV
                </span>
              )}
              {gameData.rating && (
                <span className="cmd-badge cmd-badge--rating">
                  ★ {gameData.rating}/5
                </span>
              )}
            </div>
            <h3 className="cmd-inspector-title" title={gameData.name}>
              {gameData.name}
            </h3>
          </div>
        </div>

        {/* Info Grid */}
        <div className="cmd-inspector-body">
          {/* Achievement Progress Bar if available */}
          {achievementStats && achievementStats.total > 0 && (
            <div className="cmd-inspector-achievement-box">
              <div className="cmd-inspector-achievement-header">
                <span className="cmd-inspector-achievement-title">
                  <Trophy size={13} style={{ color: "#f59e0b" }} />
                  <span>{t("nav.achievements")}</span>
                </span>
                <span className="cmd-inspector-achievement-count">
                  {achievementStats.unlocked} / {achievementStats.total} ({achievementStats.percentage}%)
                </span>
              </div>
              <div className="cmd-inspector-progress-track">
                <div
                  className="cmd-inspector-progress-fill"
                  style={{ width: `${achievementStats.percentage}%` }}
                />
              </div>
            </div>
          )}

          <div className="cmd-inspector-grid">
            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">
                <Clock size={12} />
                {t("commandPalette.inspectorPlaytime")}
              </span>
              <span className="cmd-inspector-stat-val">
                {gameData.playTime || "0h"}
              </span>
            </div>

            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">
                <Calendar size={12} />
                {t("commandPalette.inspectorLastPlayed")}
              </span>
              <span className="cmd-inspector-stat-val">
                {lastPlayedStr || t("commandPalette.neverPlayed")}
              </span>
            </div>

            {sizeStr && (
              <div className="cmd-inspector-stat">
                <span className="cmd-inspector-stat-label">
                  <HardDrive size={12} />
                  {t("commandPalette.inspectorSize")}
                </span>
                <span className="cmd-inspector-stat-val">{sizeStr}</span>
              </div>
            )}

            {gameData.releaseDate && (
              <div className="cmd-inspector-stat">
                <span className="cmd-inspector-stat-label">
                  <Calendar size={12} />
                  {t("commandPalette.inspectorRelease")}
                </span>
                <span className="cmd-inspector-stat-val">{gameData.releaseDate}</span>
              </div>
            )}
          </div>

          {/* Developer / Publisher */}
          {(gameData.developer || gameData.publisher) && (
            <div className="cmd-inspector-section">
              <span className="cmd-inspector-label">{t("commandPalette.inspectorDeveloper")}</span>
              <p className="cmd-inspector-desc">
                {[gameData.developer, gameData.publisher].filter(Boolean).join(" · ")}
              </p>
            </div>
          )}

          {/* Genres */}
          {gameData.genres && gameData.genres.length > 0 && (
            <div className="cmd-inspector-section">
              <span className="cmd-inspector-label">{t("commandPalette.inspectorGenres")}</span>
              <div className="cmd-inspector-tags">
                {gameData.genres.slice(0, 6).map((genre) => (
                  <span key={genre} className="cmd-tag">
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Path info */}
          {gameData.path && (
            <div className="cmd-inspector-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="cmd-inspector-label">{t("commandPalette.inspectorPath")}</span>
                <button
                  type="button"
                  className="cmd-copy-btn"
                  onClick={() => handleCopy(gameData.path)}
                  title={t("commandPalette.copyPath")}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copied ? t("commandPalette.copied") : t("commandPalette.copy")}</span>
                </button>
              </div>
              <div className="cmd-inspector-code" title={gameData.path}>
                {gameData.path}
              </div>
            </div>
          )}

          {/* Web Links / Wiki shortcuts */}
          <div className="cmd-inspector-section">
            <span className="cmd-inspector-label">{t("commandPalette.externalGuides")}</span>
            <div className="cmd-inspector-web-links">
              {gameData.steamAppId && (
                <>
                  <button
                    type="button"
                    className="cmd-web-link-btn"
                    onClick={() => openExternalUrl(`https://store.steampowered.com/app/${gameData.steamAppId}`)}
                  >
                    <Globe size={11} />
                    <span>Steam Store</span>
                  </button>
                  <button
                    type="button"
                    className="cmd-web-link-btn"
                    onClick={() => openExternalUrl(`https://steamdb.info/app/${gameData.steamAppId}`)}
                  >
                    <ExternalLink size={11} />
                    <span>SteamDB</span>
                  </button>
                  <button
                    type="button"
                    className="cmd-web-link-btn"
                    onClick={() => openExternalUrl(`https://www.protondb.com/app/${gameData.steamAppId}`)}
                  >
                    <ExternalLink size={11} />
                    <span>ProtonDB</span>
                  </button>
                </>
              )}
              <button
                type="button"
                className="cmd-web-link-btn"
                onClick={() =>
                  openExternalUrl(
                    `https://www.pcgamingwiki.com/w/index.php?search=${encodeURIComponent(gameData.name)}`
                  )
                }
              >
                <ExternalLink size={11} />
                <span>PCGamingWiki</span>
              </button>
              <button
                type="button"
                className="cmd-web-link-btn"
                onClick={() =>
                  openExternalUrl(
                    `https://howlongtobeat.com/?q=${encodeURIComponent(gameData.name)}`
                  )
                }
              >
                <Clock size={11} />
                <span>HowLongToBeat</span>
              </button>
            </div>
          </div>
        </div>

        {/* Shortcuts contextual footer */}
        <div className="cmd-inspector-footer">
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">↵</kbd>
            <span>{gameData.installed ? t("commandPalette.launch") : t("commandPalette.open")}</span>
          </div>
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">Ctrl+↵</kbd>
            <span>{t("commandPalette.open")}</span>
          </div>
          {onOpenActionDrawer && (
            <button
              type="button"
              className="cmd-inspector-more-actions-btn"
              onClick={onOpenActionDrawer}
              title={t("commandPalette.contextActions")}
            >
              <kbd className="cmd-key">Ctrl+K</kbd>
              <span>{t("commandPalette.actionsMenu")}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // 5. STORE / IGDB DETAIL INSPECTOR
  if (storeData) {
    const year = storeData.firstReleaseDate
      ? new Date(storeData.firstReleaseDate).getFullYear()
      : null;
    const rating = storeData.rating ? `${Math.round(storeData.rating)}%` : null;
    const wishlisted = isWishlisted ? isWishlisted(storeData.slug || String(storeData.id)) : false;

    return (
      <div className="cmd-inspector">
        <div className="cmd-inspector-hero">
          {storeData.coverUrl ? (
            <img src={storeData.coverUrl} alt="" className="cmd-inspector-hero-img" loading="lazy" />
          ) : (
            <div className="cmd-inspector-hero-placeholder">
              <ExternalLink size={36} />
            </div>
          )}
          <div className="cmd-inspector-hero-overlay" />
          <div className="cmd-inspector-hero-content">
            <div className="cmd-inspector-hero-badges">
              <span className="cmd-badge cmd-badge--accent">STORE</span>
              {year && <span className="cmd-badge">{year}</span>}
              {rating && <span className="cmd-badge cmd-badge--success">★ {rating}</span>}
              {wishlisted && (
                <span className="cmd-badge cmd-badge--accent">
                  <Heart size={9} fill="currentColor" />
                  {t("store.inWishlist")}
                </span>
              )}
            </div>
            <h3 className="cmd-inspector-title">{storeData.name}</h3>
          </div>
        </div>

        <div className="cmd-inspector-body">
          {storeData.summary && (
            <div className="cmd-inspector-section">
              <span className="cmd-inspector-label">{t("commandPalette.inspectorSummary")}</span>
              <p className="cmd-inspector-summary">{storeData.summary}</p>
            </div>
          )}

          {storeData.genres && storeData.genres.length > 0 && (
            <div className="cmd-inspector-section">
              <span className="cmd-inspector-label">{t("commandPalette.inspectorGenres")}</span>
              <div className="cmd-inspector-tags">
                {storeData.genres.map((g) => (
                  <span key={g} className="cmd-tag">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quick Trigger Buttons */}
          <div className="cmd-inspector-quick-action-row">
            {toggleWishlist && (
              <button
                type="button"
                className={`cmd-inspector-btn${wishlisted ? " cmd-inspector-btn--active" : ""}`}
                onClick={() => toggleWishlist(storeData)}
              >
                <Heart size={13} fill={wishlisted ? "currentColor" : "none"} />
                <span>{wishlisted ? t("store.inWishlist") : t("store.addToWishlist")}</span>
              </button>
            )}
            {onOpenDownloadModal && (
              <button
                type="button"
                className="cmd-inspector-btn cmd-inspector-btn--accent"
                onClick={() =>
                  onOpenDownloadModal({
                    name: storeData.name,
                    id: String(storeData.id),
                    poster: storeData.coverUrl ?? undefined,
                  })
                }
              >
                <Download size={13} />
                <span>{t("commandPalette.quickActionDownload")}</span>
              </button>
            )}
          </div>
        </div>

        <div className="cmd-inspector-footer">
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">↵</kbd>
            <span>{t("commandPalette.quickActionPage")}</span>
          </div>
        </div>
      </div>
    );
  }

  // 6. DOWNLOAD TASK DETAIL INSPECTOR
  if (downloadData) {
    const percent = Math.round((downloadData.progress ?? 0) * 100);

    return (
      <div className="cmd-inspector">
        <div className="cmd-inspector-action-hero">
          <div className="cmd-inspector-action-icon">
            <Download size={28} />
          </div>
          <h3 className="cmd-inspector-title" style={{ marginTop: "12px" }}>
            {downloadData.name || t("nav.downloads")}
          </h3>
          <span className="cmd-badge cmd-badge--accent" style={{ marginTop: "6px" }}>
            {downloadData.status.kind.toUpperCase()}
          </span>
        </div>

        <div className="cmd-inspector-body">
          <div className="cmd-inspector-achievement-box">
            <div className="cmd-inspector-achievement-header">
              <span className="cmd-inspector-achievement-title">{t("commandPalette.downloadProgress")}</span>
              <span className="cmd-inspector-achievement-count">{percent}%</span>
            </div>
            <div className="cmd-inspector-progress-track">
              <div className="cmd-inspector-progress-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div className="cmd-inspector-grid">
            <div className="cmd-inspector-stat">
              <span className="cmd-inspector-stat-label">{t("commandPalette.downloadStatus")}</span>
              <span className="cmd-inspector-stat-val">{downloadData.status.kind}</span>
            </div>
            {downloadData.totalSize && (
              <div className="cmd-inspector-stat">
                <span className="cmd-inspector-stat-label">{t("commandPalette.downloadTotalSize")}</span>
                <span className="cmd-inspector-stat-val">{formatBytes(downloadData.totalSize)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="cmd-inspector-footer">
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">↵</kbd>
            <span>{t("commandPalette.navTo")} {t("nav.downloads")}</span>
          </div>
        </div>
      </div>
    );
  }

  // 7. THEME DETAIL INSPECTOR
  if (swatchColors) {
    return (
      <div className="cmd-inspector">
        <div className="cmd-inspector-theme-preview">
          <div
            className="cmd-theme-mockup"
            style={
              {
                "--mockup-bg": swatchColors.bg,
                "--mockup-text": swatchColors.text,
                "--mockup-accent": swatchColors.accent,
              } as React.CSSProperties
            }
          >
            <div className="cmd-mockup-header">
              <span className="cmd-mockup-dot red" />
              <span className="cmd-mockup-dot yellow" />
              <span className="cmd-mockup-dot green" />
              <div className="cmd-mockup-titlebar">{item.title}</div>
            </div>
            <div className="cmd-mockup-content">
              <div className="cmd-mockup-sidebar">
                <div className="cmd-mockup-nav-item active" />
                <div className="cmd-mockup-nav-item" />
                <div className="cmd-mockup-nav-item" />
              </div>
              <div className="cmd-mockup-main">
                <div className="cmd-mockup-banner" />
                <div className="cmd-mockup-cards">
                  <div className="cmd-mockup-card active" />
                  <div className="cmd-mockup-card" />
                  <div className="cmd-mockup-card" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="cmd-inspector-body">
          <div className="cmd-inspector-hero-content" style={{ padding: 0 }}>
            <h3 className="cmd-inspector-title">{item.title}</h3>
            {item.subtitle && <p className="cmd-inspector-desc">{item.subtitle}</p>}
          </div>

          <div className="cmd-inspector-section" style={{ marginTop: "16px" }}>
            <span className="cmd-inspector-label">{t("commandPalette.inspectorPalette")}</span>
            <div className="cmd-palette-swatches">
              <div className="cmd-palette-swatch-item">
                <span
                  className="cmd-palette-swatch-color"
                  style={{ backgroundColor: swatchColors.bg }}
                />
                <span className="cmd-palette-swatch-name">Background</span>
                <span className="cmd-palette-swatch-hex">{swatchColors.bg}</span>
              </div>
              <div className="cmd-palette-swatch-item">
                <span
                  className="cmd-palette-swatch-color"
                  style={{ backgroundColor: swatchColors.text }}
                />
                <span className="cmd-palette-swatch-name">Text</span>
                <span className="cmd-palette-swatch-hex">{swatchColors.text}</span>
              </div>
              <div className="cmd-palette-swatch-item">
                <span
                  className="cmd-palette-swatch-color"
                  style={{ backgroundColor: swatchColors.accent }}
                />
                <span className="cmd-palette-swatch-name">Accent</span>
                <span className="cmd-palette-swatch-hex">{swatchColors.accent}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="cmd-inspector-footer">
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">↵</kbd>
            <span>{t("commandPalette.applyTheme")}</span>
          </div>
        </div>
      </div>
    );
  }

  // 8. ACTION / NAVIGATION DETAIL INSPECTOR
  return (
    <div className="cmd-inspector">
      <div className="cmd-inspector-action-hero">
        <div className="cmd-inspector-action-icon">{item.icon || <Sparkles size={24} />}</div>
        <h3 className="cmd-inspector-title" style={{ marginTop: "12px" }}>
          {item.title}
        </h3>
        {item.subtitle && <p className="cmd-inspector-desc">{item.subtitle}</p>}
        {item.badge && (
          <span className="cmd-badge cmd-badge--accent" style={{ marginTop: "8px" }}>
            {item.badge}
          </span>
        )}
      </div>

      {item.description && (
        <div className="cmd-inspector-body">
          <div className="cmd-inspector-section">
            <span className="cmd-inspector-label">{t("commandPalette.inspectorActionDesc")}</span>
            <p className="cmd-inspector-summary">{item.description}</p>
          </div>
        </div>
      )}

      <div className="cmd-inspector-footer">
        <div className="cmd-shortcut-hint">
          <kbd className="cmd-key">↵</kbd>
          <span>{t("commandPalette.executeAction")}</span>
        </div>
      </div>
    </div>
  );
}
