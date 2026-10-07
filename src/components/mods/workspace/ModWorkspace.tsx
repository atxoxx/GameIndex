// ModWorkspace — the shared shell behind both the main Mods page and the
// game-detail Mods subtab. Owns the workspace header, the Installed/Discover
// switch and the active body, so the two surfaces can never drift apart.

import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { Game } from "../../../types/game";
import type { ModWorkspaceStats } from "../../../types/mods";
import ModManager from "../ModManager";
import ModsDiscoverView from "../discover/ModsDiscoverView";
import { getGamePresets } from "../ModPresetsModal";
import WorkspaceHeader, { type WorkspaceTab } from "./WorkspaceHeader";
import "./mods-workspace.css";

interface ModWorkspaceProps {
  game: Game;
  variant: "page" | "subtab";
  onChanged?: () => void;
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
  initialTab?: WorkspaceTab;
}

export default function ModWorkspace({
  game,
  variant,
  onChanged,
  onModsSized,
  initialTab = "installed",
}: ModWorkspaceProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [stats, setStats] = useState<ModWorkspaceStats | null>(null);

  const presetCount = useMemo(() => getGamePresets(game.id).length, [game.id]);

  const handleOpenFolder = () => {
    if (!game.modsFolder) return;
    invoke("open_folder", { path: game.modsFolder })
      .then(() => showToast(t("mods.openFolder"), "info"))
      .catch((e) => showToast(String(e), "error"));
  };

  return (
    <div className={`mods-workspace mods-workspace--${variant}`}>
      <WorkspaceHeader
        game={game}
        variant={variant}
        tab={tab}
        onTabChange={setTab}
        stats={stats}
        presetCount={presetCount}
        onOpenFolder={game.modsFolder ? handleOpenFolder : undefined}
        onViewGamePage={variant === "page" ? () => navigate(`/library/${game.id}`) : undefined}
        onOpenDiscoverFull={
          variant === "subtab"
            ? () => navigate(`/mods/discover?gameId=${game.id}`)
            : undefined
        }
      />

      <div className="mods-workspace__body" key={tab}>
        {tab === "installed" ? (
          <ModManager
            key={game.id}
            game={game}
            onChanged={onChanged}
            onModsSized={onModsSized}
            onStats={setStats}
          />
        ) : (
          <ModsDiscoverView key={game.id} game={game} variant="subtab" />
        )}
      </div>
    </div>
  );
}
