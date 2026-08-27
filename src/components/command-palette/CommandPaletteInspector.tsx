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
} from "lucide-react";
import type { PaletteItem } from "./commandPaletteTypes";
import { formatBytes, formatRelativeTime } from "./commandPaletteUtils";

interface CommandPaletteInspectorProps {
  item: PaletteItem | null;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function CommandPaletteInspector({ item, t }: CommandPaletteInspectorProps) {
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

  const { gameData, storeData, swatchColors } = item;

  const handleCopyPath = (textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 1. GAME DETAIL INSPECTOR
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
            <img
              src={heroImage}
              alt=""
              className="cmd-inspector-hero-img"
              loading="lazy"
            />
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
            </div>
            <h3 className="cmd-inspector-title" title={gameData.name}>
              {gameData.name}
            </h3>
          </div>
        </div>

        {/* Info Grid */}
        <div className="cmd-inspector-body">
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
                {gameData.genres.slice(0, 5).map((genre) => (
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
                  onClick={() => handleCopyPath(gameData.path)}
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
        </div>

        {/* Shortcuts contextual footer */}
        <div className="cmd-inspector-footer">
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">↵</kbd>
            <span>{isRunning ? t("commandPalette.launch") : t("commandPalette.launch")}</span>
          </div>
          <div className="cmd-shortcut-hint">
            <kbd className="cmd-key">Ctrl+↵</kbd>
            <span>{t("commandPalette.open")}</span>
          </div>
          {gameData.path && (
            <div className="cmd-shortcut-hint">
              <kbd className="cmd-key">Ctrl+O</kbd>
              <span>{t("commandPalette.openFolder")}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. STORE / IGDB DETAIL INSPECTOR
  if (storeData) {
    const year = storeData.firstReleaseDate
      ? new Date(storeData.firstReleaseDate).getFullYear()
      : null;
    const rating = storeData.rating ? `${Math.round(storeData.rating)}%` : null;

    return (
      <div className="cmd-inspector">
        <div className="cmd-inspector-hero">
          {storeData.coverUrl ? (
            <img
              src={storeData.coverUrl}
              alt=""
              className="cmd-inspector-hero-img"
              loading="lazy"
            />
          ) : (
            <div className="cmd-inspector-hero-placeholder">
              <ExternalLink size={36} />
            </div>
          )}
          <div className="cmd-inspector-hero-overlay" />
          <div className="cmd-inspector-hero-content">
            <div className="cmd-inspector-hero-badges">
              <span className="cmd-badge cmd-badge--accent">IGDB</span>
              {year && <span className="cmd-badge">{year}</span>}
              {rating && (
                <span className="cmd-badge cmd-badge--success">★ {rating}</span>
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

  // 3. THEME DETAIL INSPECTOR
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

  // 4. ACTION / NAVIGATION DETAIL INSPECTOR
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
