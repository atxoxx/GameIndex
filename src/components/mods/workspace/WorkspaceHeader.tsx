// WorkspaceHeader — the single, slim game identity bar shared by the main
// Mods page and the game-detail Mods subtab. Replaces the old double banner
// (page banner + workspace banner) with one row: cover, title, live status,
// the Installed/Discover switch, and icon actions.

import { Boxes, Compass, ExternalLink, FolderOpen, Maximize2 } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Tooltip, Button } from "../../ui";
import { gameDisplayName, type Game } from "../../../types/game";
import type { ModWorkspaceStats } from "../../../types/mods";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export type WorkspaceTab = "installed" | "discover";

interface WorkspaceHeaderProps {
  game: Game;
  variant: "page" | "subtab";
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  stats?: ModWorkspaceStats | null;
  presetCount: number;
  onOpenFolder?: () => void;
  onViewGamePage?: () => void;
  onOpenDiscoverFull?: () => void;
}

export default function WorkspaceHeader({
  game,
  variant,
  tab,
  onTabChange,
  stats,
  presetCount,
  onOpenFolder,
  onViewGamePage,
  onOpenDiscoverFull,
}: WorkspaceHeaderProps) {
  const { t } = useLanguage();
  const name = gameDisplayName(game);
  const initials = name.slice(0, 2).toUpperCase();

  const hasMods = (stats?.total ?? 0) > 0;
  const enabled = stats?.enabled ?? 0;
  const total = stats?.total ?? 0;
  const updates = stats?.updates ?? 0;
  const sizeBytes = stats?.sizeBytes ?? 0;

  return (
    <header className="mods-ws-header">
      <div className="mods-ws-identity">
        <div className="mods-ws-cover" aria-hidden>
          {game.coverArtUrl ? (
            <img src={game.coverArtUrl} alt="" loading="lazy" />
          ) : (
            <span>{initials}</span>
          )}
        </div>

        <div className="mods-ws-meta">
          <div className="mods-ws-title-row">
            <h2 className="mods-ws-title" title={name}>
              {name}
            </h2>
            <span className="mods-ws-platform">{game.platform}</span>
          </div>

          <div className="mods-ws-status">
            {stats ? (
              hasMods ? (
                <>
                  <span className="mods-ws-stat">
                    {t("mods.enabledCount", {
                      enabled: String(enabled),
                      total: String(total),
                    })}
                  </span>
                  {updates > 0 && (
                    <span className="mods-ws-stat mods-ws-stat--updates">
                      {t("mods.updatesAvailable", { count: String(updates) })}
                    </span>
                  )}
                  {sizeBytes > 0 && (
                    <span className="mods-ws-stat mods-ws-stat--muted">
                      {formatBytes(sizeBytes)}
                    </span>
                  )}
                </>
              ) : (
                <span className="mods-ws-stat mods-ws-stat--muted">
                  {t("mods.noModsYet")}
                </span>
              )
            ) : null}

            {presetCount > 0 && (
              <span className="mods-ws-chip">
                {presetCount} {t("mods.presets")}
              </span>
            )}

            {game.modsFolder && onOpenFolder && (
              <button
                type="button"
                className="mods-ws-folder"
                onClick={onOpenFolder}
                title={`${t("mods.openLocation")}: ${game.modsFolder}`}
              >
                <FolderOpen size={12} />
                <span className="mods-ws-folder-text">{game.modsFolder}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mods-ws-controls">
        <div className="mods-ws-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "installed"}
            className={`mods-ws-tab${tab === "installed" ? " is-active" : ""}`}
            onClick={() => onTabChange("installed")}
          >
            <Boxes size={14} />
            <span>{t("mods.tab.installedMods")}</span>
            {total > 0 && <span className="mods-ws-tab-count">{total}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "discover"}
            className={`mods-ws-tab${tab === "discover" ? " is-active" : ""}`}
            onClick={() => onTabChange("discover")}
          >
            <Compass size={14} />
            <span>{t("mods.discover.cta")}</span>
          </button>
        </div>

        <div className="mods-ws-actions">
          {onViewGamePage && (
            <Tooltip content={t("mods.viewGamePage")}>
              <Button variant="secondary" size="md" iconOnly leftIcon={<ExternalLink size={15} />}
                type="button"
                
                onClick={onViewGamePage}
                aria-label={t("mods.viewGamePage")}
              ></Button>
            </Tooltip>
          )}
          {variant === "subtab" && onOpenDiscoverFull && (
            <Tooltip content={t("mods.discover.openFullScreen")}>
              <Button variant="secondary" size="md" iconOnly leftIcon={<Maximize2 size={15} />}
                type="button"
                
                onClick={onOpenDiscoverFull}
                aria-label={t("mods.discover.openFullScreen")}
              ></Button>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  );
}
