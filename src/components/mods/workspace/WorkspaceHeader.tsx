// WorkspaceHeader — game identity plus the workspace tab strip. One slim row,
// then the shared SubTabs so the Mods page reads like the rest of the app.

import {
  AlertTriangle,
  ArrowUpCircle,
  Boxes,
  Compass,
  ExternalLink,
  FolderOpen,
  Layers,
  Maximize2,
  Wrench,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Button, SubTabs, Tooltip } from "../../ui";
import { gameDisplayName, type Game } from "../../../types/game";
import type { ModWorkspaceStats } from "../../../types/mods";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export type WorkspaceTab =
  | "installed"
  | "discover"
  | "updates"
  | "conflicts"
  | "profiles"
  | "mo2";

interface WorkspaceHeaderProps {
  game: Game;
  variant: "page" | "subtab";
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  stats?: ModWorkspaceStats | null;
  presetCount: number;
  conflictCount?: number;
  healthCount?: number;
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
  conflictCount = 0,
  healthCount = 0,
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

  const pageTabs = [
    { id: "installed" as const, label: t("mods.tab.installedMods"), icon: Boxes, count: total },
    { id: "discover" as const, label: t("mods.discover.cta"), icon: Compass },
    { id: "updates" as const, label: t("mods.tab.updates"), icon: ArrowUpCircle, count: updates },
    {
      id: "conflicts" as const,
      label: t("mods.tab.conflicts"),
      icon: AlertTriangle,
      count: conflictCount + healthCount,
    },
    { id: "profiles" as const, label: t("mods.tab.profiles"), icon: Layers, count: presetCount },
    { id: "mo2" as const, label: t("mods.tab.mo2"), icon: Wrench },
  ];

  const tabs = variant === "subtab" ? pageTabs.slice(0, 2) : pageTabs;

  return (
    <header className="mods-ws-header">
      <div className="mods-ws-top">
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

        <div className="mods-ws-actions">
          {onViewGamePage && (
            <Tooltip content={t("mods.viewGamePage")}>
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                leftIcon={<ExternalLink size={15} />}
                type="button"
                onClick={onViewGamePage}
                aria-label={t("mods.viewGamePage")}
              />
            </Tooltip>
          )}
          {variant === "subtab" && onOpenDiscoverFull && (
            <Tooltip content={t("mods.discover.openFullScreen")}>
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                leftIcon={<Maximize2 size={15} />}
                type="button"
                onClick={onOpenDiscoverFull}
                aria-label={t("mods.discover.openFullScreen")}
              />
            </Tooltip>
          )}
        </div>
      </div>

      <SubTabs
        items={tabs}
        value={tab}
        onChange={onTabChange}
        ariaLabel={t("mods.tabsAria")}
        className="mods-ws-tabs"
      />
    </header>
  );
}
