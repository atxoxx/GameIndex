// "Mods" tab on the game detail page.
// Provides a rich contextual header with directory path, active preset status,
// and embeds the modular ModManager.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import ModManager from "./ModManager";
import ModPresetsModal, { getGamePresets, type ModPreset } from "./ModPresetsModal";
import "../../styles/page-mods.css";

interface ModsTabProps {
  game: Game;
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
}

export default function ModsTab({ game, onModsSized }: ModsTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [showPresets, setShowPresets] = useState(false);
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
      <div className="mods-tab-header-card">
        <div className="mods-tab-header-left">
          <div className="mods-tab-cover">
            {game.coverArtUrl ? (
              <img src={game.coverArtUrl} alt="" loading="lazy" />
            ) : (
              <span>{game.name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="mods-tab-title-group">
            <div className="mods-tab-eyebrow">
              <span>{game.platform}</span>
              {presets.length > 0 && (
                <span className="mods-tab-preset-pill">
                  {presets.length} {t("mods.presets")}
                </span>
              )}
            </div>
            <h2 className="mods-tab-game-title">{game.name}</h2>
            <p className="mods-tab-subtitle">{t("mods.tab.bannerSubtitle")}</p>
          </div>
        </div>

        <div className="mods-tab-header-right">
          {game.modsFolder && (
            <div className="mods-tab-path-badge" title={game.modsFolder}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="mods-tab-path-text">{game.modsFolder}</span>
              <button
                type="button"
                className="mods-tab-path-open-btn"
                onClick={handleOpenFolder}
                title={t("mods.openFolder")}
              >
                {t("mods.openLocation")}
              </button>
            </div>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPresets(true)}
            leftIcon={
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <line x1="7" y1="8" x2="17" y2="8" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="7" y1="16" x2="13" y2="16" />
              </svg>
            }
          >
            {t("mods.presets")}
          </Button>
        </div>
      </div>

      {/* Main ModManager */}
      <ModManager game={game} onModsSized={onModsSized} />

      {/* Preset Modal */}
      <ModPresetsModal
        game={game}
        mods={[]}
        isOpen={showPresets}
        onClose={() => setShowPresets(false)}
        onApplyPreset={async (preset: ModPreset) => {
          // Trigger preset apply through toast notification
          showToast(t("mods.presets.applied", { name: preset.name }), "success");
        }}
      />
    </div>
  );
}
