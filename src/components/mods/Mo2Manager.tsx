// Mod Organizer 2 Management Component.
// Embedded inside the Mods page and the Game page "Mods" tab when MO2 is present.
// Provides profile selection, modlist inspection (+/- toggling), priority reordering,
// Bethesda plugins.txt inspection/reordering, and USVFS-hooked game launching.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Game } from "../../types/game";
import type { Mo2Mod, Mo2Plugin } from "../../types/mo2";
import { useMo2 } from "../../hooks/useMo2";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { getGameMo2Config, saveGameMo2Config } from "../../utils/mo2Storage";
import { Button, Card, Badge } from "../ui";
import "../../styles/mo2-manager.css";

interface Mo2ManagerProps {
  game: Game;
  onLaunchSuccess?: () => void;
  onOpenPresets?: () => void;
}

type Mo2Tab = "mods" | "plugins";
type ModFilter = "all" | "enabled" | "disabled" | "separators";

interface Mo2CategoryGroup {
  id: string;
  name: string;
  separatorMod?: Mo2Mod;
  allMods: Mo2Mod[];
  visibleMods: Mo2Mod[];
  activeCount: number;
  totalCount: number;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "--";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

interface Mo2ModRowProps {
  mod: Mo2Mod;
  onToggle: (name: string, enabled: boolean) => void;
  onMove: (mod: Mo2Mod, direction: "up" | "down") => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const Mo2ModRow = memo(function Mo2ModRow({
  mod,
  onToggle,
  onMove,
  t,
}: Mo2ModRowProps) {
  return (
    <div className={`mo2-mod-row ${mod.enabled ? "enabled" : "disabled"}`}>
      {/* Left: Reorder buttons & Priority Badge */}
      <div className="mo2-reorder-group">
        <button
          type="button"
          className="mo2-arrow-btn"
          onClick={() => onMove(mod, "up")}
          title={t("mods.mo2.reorderUp")}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <span className="mo2-priority-badge" title={t("mods.mo2.priority")}>
          {mod.priority}
        </span>
        <button
          type="button"
          className="mo2-arrow-btn"
          onClick={() => onMove(mod, "down")}
          title={t("mods.mo2.reorderDown")}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* Toggle Checkbox */}
      <label className="mo2-toggle-label">
        <input
          type="checkbox"
          checked={mod.enabled}
          disabled={mod.isUnmanaged}
          onChange={(e) => onToggle(mod.name, e.target.checked)}
          className="mo2-toggle-checkbox"
        />
        <span className="mo2-toggle-switch" />
      </label>

      {/* Mod Name & Details */}
      <div className="mo2-mod-info">
        <div className="mo2-mod-title-row">
          <span className="mo2-mod-name" title={mod.name}>
            {mod.name}
          </span>
          {mod.version && <span className="mo2-version-tag">v{mod.version}</span>}
          {mod.isUnmanaged && <span className="mo2-unmanaged-tag">DLC/Core</span>}
        </div>
        {mod.author && <span className="mo2-author-line">by {mod.author}</span>}
      </div>

      {/* Right side: Size & Nexus Link */}
      <div className="mo2-mod-meta-right">
        {mod.sizeBytes ? (
          <span className="mo2-size-text">{formatBytes(mod.sizeBytes)}</span>
        ) : null}
        {mod.nexusModId != null && mod.nexusModId > 0 ? (
          <button
            type="button"
            className="mo2-nexus-btn"
            onClick={() => {
              const domain = mod.nexusDomain || "skyrimspecialedition";
              void openUrl(`https://www.nexusmods.com/${domain}/mods/${mod.nexusModId}`);
            }}
            title={t("mods.viewOnNexus")}
          >
            Nexus #{mod.nexusModId}
          </button>
        ) : null}
      </div>
    </div>
  );
});

export default function Mo2Manager({ game, onLaunchSuccess, onOpenPresets }: Mo2ManagerProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { updateGame, runningGameIds } = useGames();
  const isRunning = runningGameIds.includes(game.id);
  const {
    instances,
    selectedInstance,
    setSelectedInstance,
    selectedProfile,
    details,
    loading,
    launching,
    setModEnabled,
    setModsEnabled,
    reorderMods,
    setPluginEnabled,
    reorderPlugins,
    switchProfile,
    launchViaMo2,
    browseForMo2,
  } = useMo2(game);

  const [activeTab, setActiveTab] = useState<Mo2Tab>("mods");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ModFilter>("all");

  const savedConfig = getGameMo2Config(game.id);
  const [mo2LaunchEnabled, setMo2LaunchEnabled] = useState<boolean>(() => {
    return game.mo2LaunchEnabled ?? savedConfig?.enabled ?? false;
  });
  const [selectedExecutable, setSelectedExecutable] = useState<string>(() => {
    return game.mo2Executable || savedConfig?.executable || "";
  });
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Sync state if game changes from external updates (e.g. EditGameModal)
  useEffect(() => {
    if (game.mo2LaunchEnabled !== undefined) {
      setMo2LaunchEnabled(game.mo2LaunchEnabled);
    }
  }, [game.mo2LaunchEnabled]);

  useEffect(() => {
    if (game.mo2Executable) {
      setSelectedExecutable(game.mo2Executable);
    }
  }, [game.mo2Executable]);

  useEffect(() => {
    if (!selectedExecutable && selectedInstance?.customExecutables && selectedInstance.customExecutables.length > 0) {
      setSelectedExecutable(selectedInstance.customExecutables[0].title);
    }
  }, [selectedExecutable, selectedInstance]);

  const handleToggleMo2Launch = () => {
    const nextVal = !mo2LaunchEnabled;
    setMo2LaunchEnabled(nextVal);
    const instPath = selectedInstance?.instancePath || savedConfig?.instancePath;
    const prof = selectedProfile || selectedInstance?.selectedProfile || "Default";
    const exe = selectedExecutable || selectedInstance?.customExecutables[0]?.title || "";

    saveGameMo2Config(game.id, {
      enabled: nextVal,
      ...(nextVal ? { instancePath: instPath, profile: prof, executable: exe } : {}),
    });
    updateGame(game.id, {
      mo2LaunchEnabled: nextVal,
      ...(nextVal ? { mo2InstancePath: instPath, mo2Profile: prof, mo2Executable: exe } : {}),
    });
    showToast(
      nextVal
        ? t("mods.mo2.launchDefaultEnabled")
        : t("mods.mo2.launchDefaultDisabled"),
      nextVal ? "success" : "info"
    );
  };

  const handleExecutableChange = (exe: string) => {
    setSelectedExecutable(exe);
    const instPath = selectedInstance?.instancePath;
    saveGameMo2Config(game.id, { executable: exe, ...(instPath ? { instancePath: instPath } : {}) });
    updateGame(game.id, { mo2Executable: exe, ...(instPath ? { mo2InstancePath: instPath } : {}) });
  };

  const handleProfileSwitch = async (profileName: string) => {
    await switchProfile(profileName);
    const instPath = selectedInstance?.instancePath;
    saveGameMo2Config(game.id, { profile: profileName, ...(instPath ? { instancePath: instPath } : {}) });
    updateGame(game.id, { mo2Profile: profileName, ...(instPath ? { mo2InstancePath: instPath } : {}) });
  };

  const mods = details?.mods ?? [];
  const plugins = details?.plugins ?? [];

  // Group mods by MO2 separator categories in priority order
  const categoryGroups = useMemo<Mo2CategoryGroup[]>(() => {
    const groups: Mo2CategoryGroup[] = [];
    let currentGroup: Mo2CategoryGroup | null = null;
    const uncategorizedLabel = t("mods.mo2.uncategorized");

    for (const item of mods) {
      if (item.isSeparator) {
        currentGroup = {
          id: `cat-${item.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`,
          name: item.name,
          separatorMod: item,
          allMods: [],
          visibleMods: [],
          activeCount: 0,
          totalCount: 0,
        };
        groups.push(currentGroup);
      } else {
        const catName: string =
          item.category?.trim() ||
          (currentGroup ? currentGroup.name : uncategorizedLabel);

        if (
          currentGroup &&
          (currentGroup.name.toLowerCase() === catName.toLowerCase() ||
            currentGroup.separatorMod?.name.toLowerCase() === catName.toLowerCase())
        ) {
          currentGroup.allMods.push(item);
          currentGroup.totalCount += 1;
          if (item.enabled) currentGroup.activeCount += 1;
        } else {
          let target: Mo2CategoryGroup | undefined = groups.find(
            (g) => g.name.toLowerCase() === catName.toLowerCase()
          );
          if (!target) {
            target = {
              id: `cat-${catName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`,
              name: catName,
              allMods: [],
              visibleMods: [],
              activeCount: 0,
              totalCount: 0,
            };
            groups.push(target);
          }
          target.allMods.push(item);
          target.totalCount += 1;
          if (item.enabled) target.activeCount += 1;
          currentGroup = target;
        }
      }
    }

    // Populate visibleMods for each category based on search and filters
    const q = search.trim().toLowerCase();
    for (const group of groups) {
      group.visibleMods = group.allMods.filter((m) => {
        if (filter === "enabled" && !m.enabled) return false;
        if (filter === "disabled" && m.enabled) return false;
        if (filter === "separators") return false;
        if (q) {
          const matchesName = m.name.toLowerCase().includes(q);
          const matchesCat = m.category?.toLowerCase().includes(q);
          const matchesAuthor = m.author?.toLowerCase().includes(q);
          if (!matchesName && !matchesCat && !matchesAuthor) return false;
        }
        return true;
      });
    }

    return groups;
  }, [mods, search, filter, t]);

  // Categories to render
  const renderedGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return categoryGroups.filter((group) => {
      if (filter === "separators") {
        return !!group.separatorMod;
      }
      if (q) {
        const groupMatches = group.name.toLowerCase().includes(q);
        return groupMatches || group.visibleMods.length > 0;
      }
      if (filter === "enabled") {
        return group.activeCount > 0;
      }
      if (filter === "disabled") {
        return group.totalCount - group.activeCount > 0;
      }
      return true;
    });
  }, [categoryGroups, search, filter]);

  const toggleCategory = useCallback((catName: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catName)) {
        next.delete(catName);
      } else {
        next.add(catName);
      }
      return next;
    });
  }, []);

  const allCollapsed = useMemo(() => {
    if (renderedGroups.length === 0) return false;
    return renderedGroups.every((g) => collapsedCategories.has(g.name));
  }, [renderedGroups, collapsedCategories]);

  const toggleAllCollapse = useCallback(() => {
    if (allCollapsed) {
      setCollapsedCategories(new Set());
    } else {
      setCollapsedCategories(new Set(renderedGroups.map((g) => g.name)));
    }
  }, [allCollapsed, renderedGroups]);

  const isCategoryCollapsed = useCallback(
    (catName: string) => {
      if (search.trim().length > 0) return false;
      return collapsedCategories.has(catName);
    },
    [collapsedCategories, search]
  );

  // Auto-collapse categories on initial mount for large mod lists (>30 mods)
  // to avoid creating 200+ complex DOM subtrees simultaneously.
  const hasAutoCollapsedRef = useRef(false);
  useEffect(() => {
    if (!hasAutoCollapsedRef.current && categoryGroups.length > 0 && mods.length > 30) {
      hasAutoCollapsedRef.current = true;
      setCollapsedCategories(new Set(categoryGroups.map((g) => g.name)));
    }
  }, [categoryGroups, mods.length]);

  const handleModToggle = useCallback(
    (name: string, enabled: boolean) => {
      void setModEnabled(name, enabled);
    },
    [setModEnabled]
  );

  const handleCategoryToggle = useCallback(
    async (group: Mo2CategoryGroup, e: React.MouseEvent) => {
      e.stopPropagation();
      const enableTarget = group.activeCount < group.totalCount;
      const modsToChange = group.allMods.filter(
        (m) => m.enabled !== enableTarget && !m.isUnmanaged
      );
      if (modsToChange.length === 0) return;

      const updates: Record<string, boolean> = {};
      for (const m of modsToChange) {
        updates[m.name] = enableTarget;
      }
      try {
        await setModsEnabled(updates);
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [setModsEnabled, showToast]
  );

  // Filtered plugins
  const filteredPlugins = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plugins.filter((p) => {
      if (!q) return true;
      return p.name.toLowerCase().includes(q);
    });
  }, [plugins, search]);

  const handleOpenFolder = (folderPath: string) => {
    invoke("open_folder", { path: folderPath })
      .then(() => showToast(t("mods.openFolder"), "info"))
      .catch((e) => showToast(String(e), "error"));
  };

  const handleLaunch = async () => {
    if (!selectedInstance) return;
    if (isRunning) {
      showToast(t("gameContext.alreadyRunning", { name: game.name }), "info");
      return;
    }
    const exe =
      selectedExecutable ||
      selectedInstance.customExecutables[0]?.title ||
      selectedInstance.customExecutables[0]?.path ||
      game.path ||
      "";

    try {
      const res = await launchViaMo2(exe);
      showToast(res || t("mods.mo2.launchSuccess"), "success");
      onLaunchSuccess?.();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleModMove = useCallback(
    async (mod: Mo2Mod, direction: "up" | "down") => {
      const currentIdx = mods.findIndex((m) => m.name === mod.name);
      if (currentIdx === -1) return;
      const targetIdx = direction === "up" ? currentIdx + 1 : currentIdx - 1;
      if (targetIdx < 0 || targetIdx >= mods.length) return;

      const newOrder = [...mods];
      const [moved] = newOrder.splice(currentIdx, 1);
      newOrder.splice(targetIdx, 0, moved);

      try {
        await reorderMods(newOrder.map((m) => m.name));
      } catch (e) {
        showToast(String(e), "error");
      }
    },
    [mods, reorderMods, showToast]
  );

  const handlePluginMove = async (plugin: Mo2Plugin, direction: "up" | "down") => {
    const currentIdx = plugins.findIndex((p) => p.name === plugin.name);
    if (currentIdx === -1) return;
    const targetIdx = direction === "up" ? currentIdx - 1 : currentIdx + 1;
    if (targetIdx < 0 || targetIdx >= plugins.length) return;

    const newOrder = [...plugins];
    const [moved] = newOrder.splice(currentIdx, 1);
    newOrder.splice(targetIdx, 0, moved);

    try {
      await reorderPlugins(newOrder.map((p) => p.name));
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  // If no instance detected at all
  if (instances.length === 0 && !loading) {
    return (
      <Card className="mo2-empty-card">
        <div className="mo2-empty-content">
          <div className="mo2-empty-icon-wrap">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
              <polyline points="7.5 19.79 7.5 14.6 3 12" />
              <polyline points="21 12 16.5 14.6 16.5 19.79" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <h3 className="mo2-empty-title">{t("mods.mo2.noInstanceFound")}</h3>
          <p className="mo2-empty-desc">{t("mods.mo2.noInstanceHint")}</p>
          <Button variant="primary" onClick={browseForMo2} className="mo2-browse-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {t("mods.mo2.browse")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="mo2-manager-container">
      {/* Header Cockpit Card */}
      <div className="mo2-header-card">
        <div className="mo2-header-top">
          <div className="mo2-title-block">
            <div className="mo2-logo-badge">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <div className="mo2-title-text">
              <div className="mo2-eyebrow-row">
                <span className="mo2-brand-name">MOD ORGANIZER 2</span>
                <Badge variant={selectedInstance?.isPortable ? "accent" : "default"}>
                  {selectedInstance?.isPortable ? t("mods.mo2.portable") : t("mods.mo2.global")}
                </Badge>
                <Badge variant="accent">USVFS</Badge>
              </div>
              <h3 className="mo2-instance-name">
                {selectedInstance?.name || "Mod Organizer 2"}
              </h3>
            </div>
          </div>

          {/* Quick Actions (Launch via MO2 + Open Folder) */}
          <div className="mo2-launch-group">
            <button
              type="button"
              className={`mo2-default-toggle-btn ${mo2LaunchEnabled ? "active" : ""}`}
              onClick={handleToggleMo2Launch}
              title={mo2LaunchEnabled ? t("mods.mo2.launchDefaultEnabled") : t("mods.mo2.launchDefaultDisabled")}
            >
              <span className="mo2-toggle-dot" />
              <span>{t("mods.mo2.launchDefaultTitle")}</span>
              <span className={`mo2-toggle-state-badge ${mo2LaunchEnabled ? "on" : "off"}`}>
                {mo2LaunchEnabled ? "ON" : "OFF"}
              </span>
            </button>

            {selectedInstance?.customExecutables && selectedInstance.customExecutables.length > 0 && (
              <select
                aria-label={t("mods.mo2.executable")}
                value={selectedExecutable}
                onChange={(e) => handleExecutableChange(e.target.value)}
                className="mo2-exec-select"
              >
                {selectedInstance.customExecutables.map((exe) => (
                  <option key={exe.title} value={exe.title}>
                    {exe.title}
                  </option>
                ))}
              </select>
            )}

            <Button
              variant="primary"
              className="mo2-launch-btn"
              onClick={handleLaunch}
              disabled={launching || isRunning}
              title={isRunning ? t("game.running") : t("mods.mo2.launchTooltip")}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {launching ? "..." : isRunning ? t("game.running") : t("mods.mo2.launchMo2")}
            </Button>

            {selectedInstance && (
              <button
                type="button"
                className="mo2-icon-action-btn"
                onClick={() => handleOpenFolder(selectedInstance.instancePath)}
                title={t("mods.mo2.openFolder")}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Profile Selector & KPI bar */}
        <div className="mo2-header-meta">
          <div className="mo2-profile-picker">
            <span className="mo2-meta-label">{t("mods.mo2.profile")}:</span>
            <select
              aria-label={t("mods.mo2.profile")}
              value={selectedProfile || ""}
              onChange={(e) => void handleProfileSwitch(e.target.value)}
              className="mo2-profile-select"
            >
              {selectedInstance?.profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {onOpenPresets && (
              <button
                type="button"
                className="mo2-manage-profiles-btn"
                onClick={onOpenPresets}
                title={t("mods.presets.title")}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <line x1="7" y1="8" x2="17" y2="8" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                  <line x1="7" y1="16" x2="13" y2="16" />
                </svg>
                <span>{t("mods.presets")}</span>
              </button>
            )}
          </div>

          <div className="mo2-stats-chips">
            <span className="mo2-stat-chip">
              <strong>{details?.activeModCount ?? 0}</strong> / {details?.totalModCount ?? 0} {t("mods.mo2.tabMods")}
            </span>
            {plugins.length > 0 && (
              <span className="mo2-stat-chip">
                <strong>{details?.activePluginCount ?? 0}</strong> / {details?.totalPluginCount ?? 0} {t("mods.mo2.tabPlugins")}
              </span>
            )}
            {instances.length > 1 && (
              <select
                aria-label={t("mods.mo2.instance")}
                value={selectedInstance?.id}
                onChange={(e) => {
                  const target = instances.find((i) => i.id === e.target.value);
                  if (target) {
                    setSelectedInstance(target);
                    const prof = target.selectedProfile || target.profiles[0] || "Default";
                    const exe = target.customExecutables[0]?.title || "";
                    setSelectedExecutable(exe);
                    void switchProfile(prof);
                    saveGameMo2Config(game.id, {
                      instancePath: target.instancePath,
                      profile: prof,
                      executable: exe,
                    });
                    updateGame(game.id, {
                      mo2InstancePath: target.instancePath,
                      mo2Profile: prof,
                      mo2Executable: exe,
                    });
                  }
                }}
                className="mo2-instance-switch"
              >
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name} ({inst.isPortable ? "Portable" : "Global"})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Tabs & Controls */}
      <div className="mo2-controls-bar">
        <div className="mo2-tabs-group" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "mods"}
            className={`mo2-tab-btn ${activeTab === "mods" ? "active" : ""}`}
            onClick={() => setActiveTab("mods")}
          >
            {t("mods.mo2.tabMods")}
            <span className="mo2-tab-count">{mods.length}</span>
          </button>
          {plugins.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "plugins"}
              className={`mo2-tab-btn ${activeTab === "plugins" ? "active" : ""}`}
              onClick={() => setActiveTab("plugins")}
            >
              {t("mods.mo2.tabPlugins")}
              <span className="mo2-tab-count">{plugins.length}</span>
            </button>
          )}
        </div>

        {/* Search & Mod Status Filters */}
        <div className="mo2-search-filters">
          <div className="mo2-search-input-wrap">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={activeTab === "mods" ? t("mods.mo2.searchPlaceholder") : t("mods.mo2.pluginSearchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mo2-search-input"
            />
          </div>

          {activeTab === "mods" && (
            <div className="mo2-filter-pills">
              {(["all", "enabled", "disabled", "separators"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`mo2-pill-btn ${filter === mode ? "active" : ""}`}
                  onClick={() => setFilter(mode)}
                >
                  {mode === "all" && t("mods.mo2.filterAll")}
                  {mode === "enabled" && t("mods.mo2.filterEnabled")}
                  {mode === "disabled" && t("mods.mo2.filterDisabled")}
                  {mode === "separators" && t("mods.mo2.filterSeparators")}
                </button>
              ))}

              {renderedGroups.length > 0 && (
                <button
                  type="button"
                  className="mo2-collapse-all-btn"
                  onClick={toggleAllCollapse}
                  title={allCollapsed ? t("mods.mo2.expandAll") : t("mods.mo2.collapseAll")}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    {allCollapsed ? (
                      <>
                        <polyline points="7 11 12 6 17 11" />
                        <polyline points="7 17 12 12 17 17" />
                      </>
                    ) : (
                      <>
                        <polyline points="7 13 12 18 17 13" />
                        <polyline points="7 7 12 12 17 7" />
                      </>
                    )}
                  </svg>
                  <span>{allCollapsed ? t("mods.mo2.expandAll") : t("mods.mo2.collapseAll")}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Pane */}
      {activeTab === "mods" ? (
        <div className="mo2-list-view">
          {renderedGroups.length === 0 ? (
            <div className="mo2-no-results">
              <p>{t("mods.noModsMatch")}</p>
            </div>
          ) : (
            renderedGroups.map((group) => {
              const isCollapsed = isCategoryCollapsed(group.name);
              return (
                <div
                  key={group.id}
                  className={`mo2-category-section ${isCollapsed ? "collapsed" : "expanded"}`}
                >
                  {/* Category Collapsible Header */}
                  <div
                    className="mo2-category-header"
                    onClick={() => toggleCategory(group.name)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isCollapsed}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleCategory(group.name);
                      }
                    }}
                  >
                    <div className="mo2-category-title-wrap">
                      <span className={`mo2-category-chevron ${isCollapsed ? "collapsed" : ""}`}>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </span>
                      <span className="mo2-category-icon">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 2 7 12 12 22 7 12 2" />
                          <polyline points="2 17 12 22 22 17" />
                          <polyline points="2 12 12 17 22 12" />
                        </svg>
                      </span>
                      <h4 className="mo2-category-name">{group.name}</h4>
                      <span className="mo2-category-count-badge">
                        {group.activeCount} / {group.totalCount}
                      </span>
                    </div>

                    <div className="mo2-category-actions" onClick={(e) => e.stopPropagation()}>
                      {group.totalCount > 0 && (
                        <button
                          type="button"
                          className={`mo2-category-toggle-btn ${group.activeCount === group.totalCount ? "all-active" : group.activeCount > 0 ? "partial" : ""}`}
                          onClick={(e) => void handleCategoryToggle(group, e)}
                          title={group.activeCount === group.totalCount ? t("mods.mo2.disableCategory") : t("mods.mo2.enableCategory")}
                        >
                          <span className="mo2-category-toggle-dot" />
                          <span>
                            {group.activeCount === group.totalCount
                              ? t("mods.mo2.disableAll")
                              : t("mods.mo2.enableAll")}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Category Mods List */}
                  {!isCollapsed && (
                    <div className="mo2-category-body">
                      {group.visibleMods.length === 0 ? (
                        <div className="mo2-category-empty">
                          {group.allMods.length === 0
                            ? t("mods.mo2.emptyCategory")
                            : t("mods.noModsMatch")}
                        </div>
                      ) : (
                        group.visibleMods.map((mod) => (
                          <Mo2ModRow
                            key={mod.id || mod.name}
                            mod={mod}
                            onToggle={handleModToggle}
                            onMove={handleModMove}
                            t={t}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Plugins List (.esp, .esm, .esl) */
        <div className="mo2-list-view">
          {filteredPlugins.length === 0 ? (
            <div className="mo2-no-results">
              <p>{t("mods.noModsMatch")}</p>
            </div>
          ) : (
            filteredPlugins.map((plugin) => (
              <div
                key={plugin.name}
                className={`mo2-plugin-row ${plugin.enabled ? "enabled" : "disabled"}`}
              >
                <div className="mo2-reorder-group">
                  <button
                    type="button"
                    className="mo2-arrow-btn"
                    onClick={() => handlePluginMove(plugin, "up")}
                    title={t("mods.mo2.reorderUp")}
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                  <span className="mo2-priority-badge">
                    {plugin.priority.toString().padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    className="mo2-arrow-btn"
                    onClick={() => handlePluginMove(plugin, "down")}
                    title={t("mods.mo2.reorderDown")}
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>

                <label className="mo2-toggle-label">
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    onChange={(e) => setPluginEnabled(plugin.name, e.target.checked)}
                    className="mo2-toggle-checkbox"
                  />
                  <span className="mo2-toggle-switch" />
                </label>

                <div className="mo2-plugin-info">
                  <span className="mo2-plugin-name">{plugin.name}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
