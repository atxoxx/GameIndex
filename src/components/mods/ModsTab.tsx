// "Mods" tab on the game detail page.
// Provides a rich contextual header with directory path, active preset status,
// and embeds both the modular ModManager (installed) and the embedded ModsDiscoverView (discover new).

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Boxes, Compass, FolderOpen } from "lucide-react";
import type { Game } from "../../types/game";
import { gameDisplayName } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import ModManager from "./ModManager";
import ModsDiscoverView from "./discover/ModsDiscoverView";
import { getGamePresets } from "./ModPresetsModal";
import "../../styles/page-mods.css";
import "./discover/mods-discover.css";

interface ModsTabProps {
  game: Game;
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
  defaultSubtab?: "installed" | "discover";
}

export default function ModsTab({
  game,
  onModsSized,
  defaultSubtab = "installed",
}: ModsTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [tab, setTab] = useState<"installed" | "discover">(defaultSubtab);
  const presets = getGamePresets(game.id);

  const handleOpenFolder = () => {
    if (!game.modsFolder) return;
    invoke("open_folder", { path: game.modsFolder })
      .then(() => showToast(t("mods.openFolder"), "info"))
      .catch((e) => showToast(String(e), "error"));
  };

  return (
    <div className="mods-tab" role="region" aria-label={t("mods.eyebrow")}>
      {/* Game Context Header Card */}
      <div className="mods-workspace-banner">
        <div className="mods-workspace-banner-main">
          <div className="mods-workspace-cover">
            {game.coverArtUrl ? (
              <img src={game.coverArtUrl} alt="" loading="lazy" />
            ) : (
              <span>{gameDisplayName(game).slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="mods-workspace-meta">
            <div className="mods-workspace-tagline">
              <span className="mods-workspace-platform">{game.platform}</span>
              {presets.length > 0 && (
                <span className="mods-tab-preset-pill">
                  {presets.length} {t("mods.presets")}
                </span>
              )}
              {game.modsFolder && (
                <button
                  type="button"
                  className="mods-workspace-folder-chip"
                  onClick={handleOpenFolder}
                  title={`${t("mods.openLocation")}: ${game.modsFolder}`}
                >
                  <FolderOpen size={12} />
                  <span className="mods-workspace-folder-text">{game.modsFolder}</span>
                </button>
              )}
            </div>
            <h2 className="mods-workspace-title">{gameDisplayName(game)}</h2>
            <p className="mods-workspace-subtitle">{t("mods.tab.bannerSubtitle")}</p>
          </div>
        </div>

        <div className="mods-workspace-controls">
          {/* Subtab Toggle Buttons */}
          <div className="mods-tab-nav-switcher" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "installed"}
              className={`mods-tab-nav-btn${tab === "installed" ? " active" : ""}`}
              onClick={() => setTab("installed")}
            >
              <Boxes size={14} />
              <span>{t("mods.tab.installedMods")}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={tab === "discover"}
              className={`mods-tab-nav-btn${tab === "discover" ? " active" : ""}`}
              onClick={() => setTab("discover")}
            >
              <Compass size={14} />
              <span>{t("mods.discover.cta")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content: Installed ModManager or Embedded Discover */}
      <div className="mods-workspace-view-wrap" key={tab}>
        {tab === "installed" ? (
          <ModManager game={game} onModsSized={onModsSized} />
        ) : (
          <ModsDiscoverView game={game} variant="subtab" />
        )}
      </div>
    </div>
  );
}
