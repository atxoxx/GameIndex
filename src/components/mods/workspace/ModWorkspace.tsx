// ModWorkspace — the shared shell behind both the main Mods page and the
// game-detail Mods subtab. Owns the workspace header, the tab strip and the
// active body, so the two surfaces can never drift apart.

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { Game } from "../../../types/game";
import type { ModConflict, ModHealthReport, ModWorkspaceStats } from "../../../types/mods";
import ModManager from "../ModManager";
import Mo2Manager from "../Mo2Manager";
import ModsDiscoverView from "../discover/ModsDiscoverView";
import ModIssuesTab from "./ModIssuesTab";
import ModProfilesTab from "./ModProfilesTab";
import ModUpdatesTab from "./ModUpdatesTab";
import { getGamePresets } from "../ModPresetsModal";
import WorkspaceHeader, { type WorkspaceTab } from "./WorkspaceHeader";
import "./mods-workspace.css";

interface ModWorkspaceProps {
  game: Game;
  variant: "page" | "subtab";
  onChanged?: () => void;
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
  initialTab?: WorkspaceTab;
  /** Controlled tab, used by the page so the URL stays shareable. */
  tab?: WorkspaceTab;
  onTabChange?: (tab: WorkspaceTab) => void;
}

export default function ModWorkspace({
  game,
  variant,
  onChanged,
  onModsSized,
  initialTab = "installed",
  tab: controlledTab,
  onTabChange,
}: ModWorkspaceProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [internalTab, setInternalTab] = useState<WorkspaceTab>(initialTab);
  const tab = controlledTab ?? internalTab;
  const [stats, setStats] = useState<ModWorkspaceStats | null>(null);
  const [conflicts, setConflicts] = useState<ModConflict[]>([]);
  const [health, setHealth] = useState<ModHealthReport | null>(null);

  const presetCount = useMemo(() => getGamePresets(game.id).length, [game.id]);

  const setTab = useCallback(
    (next: WorkspaceTab) => {
      if (controlledTab === undefined) setInternalTab(next);
      onTabChange?.(next);
    },
    [controlledTab, onTabChange]
  );

  const refreshDiagnostics = useCallback(async () => {
    try {
      const [conflictList, healthReport] = await Promise.all([
        invoke<ModConflict[]>("mods_conflicts", { gameId: game.id }),
        invoke<ModHealthReport>("mods_health_check", { gameId: game.id }),
      ]);
      setConflicts(conflictList);
      setHealth(healthReport);
    } catch {
      // Diagnostics are decoration; a failure must not break the workspace.
    }
  }, [game.id]);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const handleChanged = useCallback(() => {
    void refreshDiagnostics();
    onChanged?.();
  }, [refreshDiagnostics, onChanged]);

  const handleOpenFolder = () => {
    if (!game.modsFolder) return;
    invoke("open_folder", { path: game.modsFolder })
      .then(() => showToast(t("mods.openFolder"), "info"))
      .catch((e) => showToast(String(e), "error"));
  };

  const healthIssues =
    (health?.findings.filter((f) => f.severity !== "info").length ?? 0);

  return (
    <div className={`mods-workspace mods-workspace--${variant}`}>
      <WorkspaceHeader
        game={game}
        variant={variant}
        tab={tab}
        onTabChange={setTab}
        stats={stats}
        presetCount={presetCount}
        conflictCount={conflicts.length}
        healthCount={healthIssues}
        onOpenFolder={game.modsFolder ? handleOpenFolder : undefined}
        onViewGamePage={variant === "page" ? () => navigate(`/library/${game.id}`) : undefined}
        onOpenDiscoverFull={
          variant === "subtab"
            ? () => navigate(`/mods/discover?gameId=${game.id}`)
            : undefined
        }
      />

      <div className="mods-workspace__body" key={tab}>
        {tab === "installed" && (
          <ModManager
            key={game.id}
            game={game}
            onChanged={handleChanged}
            onModsSized={onModsSized}
            onStats={setStats}
            hideMo2Switcher={variant === "page"}
          />
        )}

        {tab === "discover" && (
          <ModsDiscoverView key={game.id} game={game} variant="subtab" />
        )}

        {tab === "updates" && (
          <ModUpdatesTab
            game={game}
            onChanged={handleChanged}
            onStats={setStats}
          />
        )}

        {tab === "conflicts" && (
          <ModIssuesTab
            game={game}
            conflicts={conflicts}
            health={health}
            onRefresh={handleChanged}
          />
        )}

        {tab === "profiles" && (
          <ModProfilesTab game={game} onChanged={handleChanged} />
        )}

        {tab === "mo2" && (
          <Mo2Manager game={game} onOpenPresets={() => setTab("profiles")} />
        )}
      </div>
    </div>
  );
}
