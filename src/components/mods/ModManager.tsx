// Dual-pane mod manager (Vortex/MO2-inspired), shared by the game
// page "Mods" tab and the main Mods page.
//
// Modernized UI: Glassmorphism, KPI Hero Stats, Quick Filter Tabs, Custom Toggle Switches,
// Inline SVG icons, Interactive File Inspector & Conflict Visualizer.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Game } from "../../types/game";
import {
  ENGINE_LABELS,
  type GameMod,
  type ModConflict,
  type ModEngine,
  type NexusStatus,
} from "../../types/mods";
import { useGameMods } from "../../hooks/useGameMods";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button, ConfirmModal } from "../ui";
import "../../styles/page-mods.css";

function formatModSize(bytes?: number): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function EngineChip({ engine }: { engine: ModEngine | string }) {
  const label = ENGINE_LABELS[engine as ModEngine] ?? engine;
  return <span className={`mods-engine-chip mods-engine-${engine}`}>{label}</span>;
}

type FilterTab = "all" | "enabled" | "disabled" | "updates" | "conflicts";

export default function ModManager({
  game,
  onChanged,
  onModsSized,
}: {
  game: Game;
  /** Fired after any mutation (scan/toggle/delete/update-check) so
   *  hosts (the Mods page overview rail) can refresh their counts. */
  onChanged?: () => void;
  /** Fired whenever the total on-disk mods footprint changes. Hosts
   *  (the game page) persist this back to the game record so the
   *  Storage tab can read the already-calculated size instead of
   *  re-measuring the mods folder itself. */
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const {
    payload,
    conflicts,
    loading,
    scanning,
    checkingUpdates,
    error,
    scan,
    setEnabled,
    reorder,
    remove,
    checkUpdates,
    setCustomRoot,
    setNexusDomain,
  } = useGameMods(game);

  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [modSort, setModSort] = useState<"order" | "name" | "size:desc" | "size:asc">("order");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GameMod | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [nexusOpen, setNexusOpen] = useState(false);
  const [nexusKey, setNexusKey] = useState("");
  const [nexusStatus, setNexusStatus] = useState<NexusStatus | null>(null);
  const [domainDraft, setDomainDraft] = useState("");
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  const mods = payload?.mods ?? [];
  const enabledCount = mods.filter((m) => m.enabled).length;
  const disabledCount = mods.length - enabledCount;
  const updateCount = mods.filter((m) => m.updateAvailable).length;
  const supportsReorder = payload?.supportsReorder ?? false;
  const totalModsBytes = mods.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0);

  const conflictsByMod = useMemo(() => {
    const map = new Map<string, ModConflict[]>();
    for (const c of conflicts) {
      for (const id of c.modIds) {
        const list = map.get(id) ?? [];
        list.push(c);
        map.set(id, list);
      }
    }
    return map;
  }, [conflicts]);

  const conflictCount = useMemo(() => {
    const conflictingModIds = new Set<string>();
    for (const c of conflicts) {
      for (const id of c.modIds) conflictingModIds.add(id);
    }
    return conflictingModIds.size;
  }, [conflicts]);

  const filtered = useMemo(() => {
    let result = mods;

    // Apply Tab Filter
    switch (filterTab) {
      case "enabled":
        result = result.filter((m) => m.enabled);
        break;
      case "disabled":
        result = result.filter((m) => !m.enabled);
        break;
      case "updates":
        result = result.filter((m) => m.updateAvailable);
        break;
      case "conflicts":
        result = result.filter((m) => conflictsByMod.has(m.id));
        break;
      case "all":
      default:
        break;
    }

    // Apply Search
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.author ?? "").toLowerCase().includes(q) ||
          m.engine.toLowerCase().includes(q)
      );
    }

    return result;
  }, [mods, filterTab, search, conflictsByMod]);

  // Sort the visible list
  const sortedMods = useMemo(() => {
    const list = [...filtered];
    switch (modSort) {
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "size:desc":
        list.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
        break;
      case "size:asc":
        list.sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
        break;
      case "order":
      default:
        break;
    }
    return list;
  }, [filtered, modSort]);

  const selected = mods.find((m) => m.id === selectedId) ?? null;

  // Persist total footprint
  const onModsSizedRef = useRef(onModsSized);
  onModsSizedRef.current = onModsSized;
  useEffect(() => {
    if (!onModsSizedRef.current) return;
    const total = (payload?.mods ?? []).reduce(
      (sum, m) => sum + (m.sizeBytes ?? 0),
      0
    );
    const folder =
      payload?.settings?.modsRoot ?? payload?.settings?.customRoot ?? undefined;
    onModsSizedRef.current({ totalBytes: total, folder });
  }, [payload]);

  // Keep selection sane
  useEffect(() => {
    if (selectedId && !mods.some((m) => m.id === selectedId)) {
      setSelectedId(mods[0]?.id ?? null);
    } else if (!selectedId && mods.length > 0) {
      setSelectedId(mods[0]?.id ?? null);
    }
  }, [mods, selectedId]);

  // Reset file listing when selected changes
  useEffect(() => {
    setFiles(null);
    setFileSearch("");
    setShowFiles(false);
    setCopiedPath(false);
  }, [selectedId]);

  // Sync Nexus-domain draft
  useEffect(() => {
    setDomainDraft(payload?.settings?.nexusDomain ?? "");
  }, [payload?.settings?.nexusDomain]);

  const refreshNexusStatus = useCallback(() => {
    invoke<NexusStatus>("nexus_get_status")
      .then(setNexusStatus)
      .catch(() => setNexusStatus({ connected: false }));
  }, []);

  useEffect(() => {
    if (nexusOpen) refreshNexusStatus();
  }, [nexusOpen, refreshNexusStatus]);

  const handleScan = async () => {
    try {
      const p = await scan();
      if (p) {
        showToast(t("mods.scanComplete", { count: String(p.mods.length) }), "success");
      }
      onChanged?.();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleToggle = async (mod: GameMod) => {
    try {
      await setEnabled(mod.id, !mod.enabled);
      onChanged?.();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleCheckUpdates = async () => {
    try {
      const p = await checkUpdates();
      const n = p?.mods.filter((m) => m.updateAvailable).length ?? 0;
      showToast(
        n > 0 ? t("mods.updatesFound", { count: String(n) }) : t("mods.noUpdates"),
        n > 0 ? "info" : "success"
      );
      onChanged?.();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      showToast(t("mods.deleted", { name: deleteTarget.name }), "success");
      setDeleteTarget(null);
      onChanged?.();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelectMod = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastClickedId && sortedMods.some((m) => m.id === lastClickedId)) {
          const idx1 = sortedMods.findIndex((m) => m.id === lastClickedId);
          const idx2 = sortedMods.findIndex((m) => m.id === id);
          const start = Math.min(idx1, idx2);
          const end = Math.max(idx1, idx2);
          for (let i = start; i <= end; i++) {
            next.add(sortedMods[i].id);
          }
        } else {
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
        }
        return next;
      });
      setLastClickedId(id);
    },
    [lastClickedId, sortedMods]
  );

  const allSelected = useMemo(() => {
    if (sortedMods.length === 0) return false;
    return sortedMods.every((m) => selectedIds.has(m.id));
  }, [sortedMods, selectedIds]);

  const handleToggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedMods.map((m) => m.id)));
    }
  }, [allSelected, sortedMods]);

  const handleBulkEnable = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    let success = 0;
    for (const id of ids) {
      try {
        await setEnabled(id, true);
        success++;
      } catch (e) {
        // continue
      }
    }
    setBulkProcessing(false);
    showToast(t("mods.bulkEnabled", { count: String(success) }), "success");
    onChanged?.();
  };

  const handleBulkDisable = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    let success = 0;
    for (const id of ids) {
      try {
        await setEnabled(id, false);
        success++;
      } catch (e) {
        // continue
      }
    }
    setBulkProcessing(false);
    showToast(t("mods.bulkDisabled", { count: String(success) }), "success");
    onChanged?.();
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    let success = 0;
    for (const id of ids) {
      try {
        await remove(id);
        success++;
      } catch (e) {
        // continue
      }
    }
    setBulkProcessing(false);
    setSelectedIds(new Set());
    setShowBulkDeleteModal(false);
    showToast(t("mods.bulkDeleted", { count: String(success) }), "success");
    onChanged?.();
  };

  const handleOpenFolder = (path?: string) => {
    const target = path ?? payload?.settings?.modsRoot;
    if (!target) return;
    invoke("open_folder", { path: target }).catch((e) => showToast(String(e), "error"));
  };

  const handlePickFolder = async () => {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: t("mods.setFolder"),
        defaultPath:
          payload?.settings?.customRoot ??
          payload?.settings?.modsRoot ??
          game.path?.replace(/[\\/][^\\/]+$/, ""),
      });
      if (typeof picked !== "string" || !picked) return;
      await setCustomRoot(picked);
      showToast(t("mods.folderSaved"), "success");
      await handleScan();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleSaveNexusKey = async () => {
    try {
      await invoke("nexus_set_api_key", { key: nexusKey });
      showToast(
        nexusKey.trim() ? t("mods.nexusKeySaved") : t("mods.nexusKeyCleared"),
        "success"
      );
      setNexusKey("");
      refreshNexusStatus();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleSaveDomain = async () => {
    try {
      await setNexusDomain(domainDraft);
      showToast(t("mods.domainSaved"), "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      setCopiedPath(true);
      showToast(t("mods.pathCopied"), "info");
      setTimeout(() => setCopiedPath(false), 2500);
    }).catch(() => {
      showToast("Failed to copy path", "error");
    });
  };

  const loadFiles = async (mod: GameMod) => {
    if (showFiles) {
      setShowFiles(false);
      return;
    }
    setShowFiles(true);
    if (files === null) {
      try {
        setFiles(await invoke<string[]>("mods_list_files", { modId: mod.id }));
      } catch {
        setFiles([]);
      }
    }
  };

  // Drag & Drop reordering
  const workshopItemId = useMemo(() => {
    if (!selected || selected.engine !== "workshop") return null;
    if (selected.notes) {
      const match = selected.notes.match(/workshop:(\d+)/);
      if (match) return match[1];
    }
    const match = selected.path.match(/(\d+)(?:\.disabled)?$/);
    return match ? match[1] : null;
  }, [selected]);

  const workshopPreviewUrl = useMemo(() => {
    if (!selected?.notes) return null;
    const match = selected.notes.match(/preview:(https?:\/\/[^\s|]+)/);
    return match ? match[1] : null;
  }, [selected]);

  const dragEnabled = supportsReorder && search.trim() === "" && filterTab === "all" && modSort === "order";

  const handleDrop = async (targetId: string) => {
    const sourceId = dragId.current;
    dragId.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = mods.map((m) => m.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    try {
      await reorder(ids);
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const nexusUrlFor = (mod: GameMod): string | null => {
    const domain = mod.nexusDomain ?? payload?.settings?.nexusDomain;
    if (!mod.nexusModId || !domain) return null;
    return `https://www.nexusmods.com/${domain}/mods/${mod.nexusModId}`;
  };

  const selectedConflicts = selected ? conflictsByMod.get(selected.id) ?? [] : [];
  const modNameById = useMemo(
    () => new Map(mods.map((m) => [m.id, m.name])),
    [mods]
  );

  const filteredFiles = useMemo(() => {
    if (!files) return [];
    const q = fileSearch.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, fileSearch]);

  return (
    <div className="mods-manager">
      {/* ── KPI Hero Stats Bar ──────────────────────────────────── */}
      {mods.length > 0 && (
        <div className="mods-stats-bar">
          <div className="mods-stat-card">
            <span className="mods-stat-card-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              {t("mods.stats.total")}
            </span>
            <span className="mods-stat-card-value">{mods.length}</span>
          </div>

          <div className="mods-stat-card accent-active">
            <span className="mods-stat-card-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              {t("mods.stats.active")}
            </span>
            <span className="mods-stat-card-value">
              {enabledCount}
              <span className="mods-stat-card-sub">/ {mods.length}</span>
            </span>
          </div>

          <div className={`mods-stat-card ${updateCount > 0 ? "accent-update" : ""}`}>
            <span className="mods-stat-card-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
              {t("mods.stats.updates")}
            </span>
            <span className="mods-stat-card-value">{updateCount}</span>
          </div>

          <div className="mods-stat-card">
            <span className="mods-stat-card-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              {t("mods.stats.storage")}
            </span>
            <span className="mods-stat-card-value" style={{ fontSize: "16px" }}>
              {formatModSize(totalModsBytes)}
            </span>
          </div>

          {conflictCount > 0 && (
            <div className="mods-stat-card accent-conflict">
              <span className="mods-stat-card-label">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                {t("mods.stats.conflicts")}
              </span>
              <span className="mods-stat-card-value">{conflictCount}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Toolbar Container ───────────────────────────────────── */}
      <div className="mods-toolbar-container">
        <div className="mods-toolbar-top">
          {/* Quick Filter Tabs */}
          <div className="mods-quick-filters">
            <button
              type="button"
              className={`mods-filter-btn ${filterTab === "all" ? "active" : ""}`}
              onClick={() => setFilterTab("all")}
            >
              {t("mods.filter.all")}
              <span className="mods-filter-badge">{mods.length}</span>
            </button>
            <button
              type="button"
              className={`mods-filter-btn ${filterTab === "enabled" ? "active" : ""}`}
              onClick={() => setFilterTab("enabled")}
            >
              {t("mods.filter.enabled")}
              <span className="mods-filter-badge">{enabledCount}</span>
            </button>
            <button
              type="button"
              className={`mods-filter-btn ${filterTab === "disabled" ? "active" : ""}`}
              onClick={() => setFilterTab("disabled")}
            >
              {t("mods.filter.disabled")}
              <span className="mods-filter-badge">{disabledCount}</span>
            </button>
            {updateCount > 0 && (
              <button
                type="button"
                className={`mods-filter-btn ${filterTab === "updates" ? "active" : ""}`}
                onClick={() => setFilterTab("updates")}
              >
                {t("mods.filter.updates")}
                <span className="mods-filter-badge">{updateCount}</span>
              </button>
            )}
            {conflictCount > 0 && (
              <button
                type="button"
                className={`mods-filter-btn ${filterTab === "conflicts" ? "active" : ""}`}
                onClick={() => setFilterTab("conflicts")}
              >
                {t("mods.filter.conflicts")}
                <span className="mods-filter-badge">{conflictCount}</span>
              </button>
            )}
          </div>

          <div className="mods-toolbar-actions">
            {/* Search Input */}
            <div className="mods-search-input-wrapper" style={{ width: "220px" }}>
              <svg className="mods-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder={t("mods.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="mods-search-clear"
                  onClick={() => setSearch("")}
                  title={t("mods.clearSearchTitle")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>

            {/* Sort Select */}
            <select
              className="mods-sort-select"
              value={modSort}
              onChange={(e) => setModSort(e.target.value as typeof modSort)}
              title={t("mods.sortBy")}
            >
              <option value="order">{t("mods.sort.order")}</option>
              <option value="name">{t("mods.sort.name")}</option>
              <option value="size:desc">{t("mods.sort.sizeDesc")}</option>
              <option value="size:asc">{t("mods.sort.sizeAsc")}</option>
            </select>

            {/* Scan Button */}
            <Button variant="secondary" size="sm" onClick={handleScan} isLoading={scanning}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
              {scanning ? t("mods.scanning") : mods.length > 0 ? t("mods.rescan") : t("mods.scan")}
            </Button>

            {/* Check Updates Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCheckUpdates}
              isLoading={checkingUpdates}
              title={t("mods.checkUpdates")}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              {checkingUpdates ? t("mods.checkingUpdates") : t("mods.checkUpdates")}
            </Button>

            {/* Open Folder */}
            {payload?.settings?.modsRoot && (
              <Button variant="ghost" size="sm" onClick={() => handleOpenFolder()}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                {t("mods.openFolder")}
              </Button>
            )}

            {/* Set Custom Folder */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handlePickFolder()}
              title={payload?.settings?.customRoot ?? undefined}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                <line x1="12" y1="11" x2="12" y2="17"></line>
                <line x1="9" y1="14" x2="15" y2="14"></line>
              </svg>
              {t("mods.setFolder")}
            </Button>

            {/* Nexus Integration Drawer Toggle */}
            <Button
              variant="ghost"
              size="sm"
              active={nexusOpen}
              onClick={() => setNexusOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
              {t("mods.nexus")}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Nexus Settings Panel Drawer ─────────────────────────── */}
      {nexusOpen && (
        <div className="mods-nexus-panel">
          <div className="mods-nexus-status">
            {nexusStatus?.connected ? (
              <span className="mods-nexus-connected">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                {t("mods.nexusConnected", { name: nexusStatus.userName ?? "?" })}
                {nexusStatus.isPremium ? ` · ${t("mods.nexusPremium")}` : ""}
              </span>
            ) : (
              <span className="mods-nexus-disconnected">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                {t("mods.nexusNotConnected")}
                {nexusStatus?.error ? ` (${nexusStatus.error})` : ""}
              </span>
            )}
          </div>
          <div className="mods-nexus-row">
            <input
              type="password"
              className="mods-nexus-input"
              placeholder={t("mods.nexusApiKey")}
              value={nexusKey}
              onChange={(e) => setNexusKey(e.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={handleSaveNexusKey}>
              {t("mods.nexusSaveKey")}
            </Button>
          </div>
          <p className="mods-nexus-hint">{t("mods.nexusApiKeyHint")}</p>
          <div className="mods-nexus-row">
            <input
              type="text"
              className="mods-nexus-input"
              placeholder={t("mods.nexusDomain")}
              value={domainDraft}
              onChange={(e) => setDomainDraft(e.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={handleSaveDomain}>
              {t("common.save")}
            </Button>
          </div>
          <p className="mods-nexus-hint">{t("mods.nexusDomainHint")}</p>
        </div>
      )}

      {error && (
        <div className="mods-error">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          {error}
        </div>
      )}

      {/* ── Empty / Loading / Dual-Pane Layout ──────────────────── */}
      {mods.length === 0 ? (
        <div className="mods-empty">
          <div className="mods-empty-glyph">🧩</div>
          <h3>{t("mods.emptyTitle")}</h3>
          <p>{loading ? t("common.loading") : t("mods.emptySubtitle")}</p>
          <div className="mods-empty-actions">
            <Button variant="primary" size="sm" onClick={handleScan} isLoading={scanning}>
              {scanning ? t("mods.scanning") : t("mods.scan")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handlePickFolder()}>
              {t("mods.setFolder")}
            </Button>
          </div>
        </div>
      ) : sortedMods.length === 0 ? (
        <div className="mods-empty" style={{ padding: "48px 24px" }}>
          <div className="mods-empty-glyph">🔍</div>
          <h3>{t("mods.noModsMatch")}</h3>
          <p>{t("mods.searchPlaceholder")}</p>
          <div className="mods-empty-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearch("");
                setFilterTab("all");
              }}
            >
              {t("mods.clearFilter")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mods-split">
          {/* ── Left Pane: Load Order List ─────────────────────── */}
          <div className="mods-list-pane">
            <div className="mods-list-header">
              <div className="mods-list-header-title">
                <input
                  type="checkbox"
                  className="mods-header-checkbox"
                  checked={allSelected}
                  onChange={handleToggleSelectAll}
                  title={allSelected ? t("mods.deselectAll") : t("mods.selectAll")}
                />
                <span>{t("mods.loadOrder")}</span>
                {(payload?.engines ?? []).map((e) => (
                  <EngineChip key={e} engine={e} />
                ))}
              </div>
              <span className="mods-list-header-hint">
                {selectedIds.size > 0
                  ? t("mods.selectedCount", { count: String(selectedIds.size) })
                  : supportsReorder
                  ? t("mods.loadOrderHint")
                  : t("mods.loadOrderReadOnly")}
              </span>
            </div>

            {selectedIds.size > 0 && (
              <div className="mods-bulk-toolbar">
                <span className="mods-bulk-count">
                  {t("mods.selectedCount", { count: String(selectedIds.size) })}
                </span>
                <div className="mods-bulk-actions">
                  <Button variant="secondary" size="sm" onClick={handleBulkEnable} isLoading={bulkProcessing}>
                    {t("mods.enable")}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleBulkDisable} isLoading={bulkProcessing}>
                    {t("mods.disable")}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setShowBulkDeleteModal(true)} isLoading={bulkProcessing}>
                    {t("mods.delete")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                    {t("mods.clearSelection")}
                  </Button>
                </div>
              </div>
            )}

            <div className="mods-list">
              {sortedMods.map((mod) => {
                const hasConflict = conflictsByMod.has(mod.id);
                const orderIndex = mods.indexOf(mod);
                const isMultiSelected = selectedIds.has(mod.id);
                return (
                  <div
                    key={mod.id}
                    className={[
                      "mods-row",
                      mod.id === selectedId ? "selected" : "",
                      isMultiSelected ? "multi-selected" : "",
                      mod.enabled ? "" : "disabled",
                      dragOverId === mod.id ? "drag-over" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setSelectedId(mod.id)}
                    draggable={dragEnabled}
                    onDragStart={() => {
                      dragId.current = mod.id;
                    }}
                    onDragOver={(e) => {
                      if (!dragEnabled) return;
                      e.preventDefault();
                      setDragOverId(mod.id);
                    }}
                    onDragLeave={() => setDragOverId((v) => (v === mod.id ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault();
                      void handleDrop(mod.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      className="mods-row-checkbox"
                      checked={isMultiSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        toggleSelectMod(mod.id, (e.nativeEvent as MouseEvent).shiftKey)
                      }
                      title={t("mods.selectModTitle")}
                    />

                    {dragEnabled && (
                      <span className="mods-drag-handle" aria-hidden title={t("mods.dragToReorder")}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="5" r="1"></circle>
                          <circle cx="9" cy="12" r="1"></circle>
                          <circle cx="9" cy="19" r="1"></circle>
                          <circle cx="15" cy="5" r="1"></circle>
                          <circle cx="15" cy="12" r="1"></circle>
                          <circle cx="15" cy="19" r="1"></circle>
                        </svg>
                      </span>
                    )}

                    <span className="mods-order-num">#{orderIndex + 1}</span>

                    {/* Cyber Switch Toggle */}
                    <label
                      className="mods-toggle-switch"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={mod.enabled}
                        onChange={() => void handleToggle(mod)}
                      />
                      <span className="mods-toggle-slider" />
                    </label>

                    <div className="mods-row-main">
                      <span className="mods-row-name" title={mod.name}>{mod.name}</span>
                      {mod.version && (
                        <span className="mods-row-version">v{mod.version}</span>
                      )}
                    </div>

                    <div className="mods-row-badges">
                      {mod.updateAvailable && (
                        <span
                          className="mods-badge mods-badge-update"
                          title={t("mods.updateAvailable")}
                        >
                          ↑ Update
                        </span>
                      )}
                      {hasConflict && (
                        <span
                          className="mods-badge mods-badge-conflict"
                          title={t("mods.conflicts")}
                        >
                          ⚠ Conflict
                        </span>
                      )}
                      <EngineChip engine={mod.engine} />
                      <span className="mods-row-size">
                        {formatModSize(mod.sizeBytes)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Right Pane: Mod Inspector Detail ───────────────── */}
          <div className="mods-detail-pane">
            {selected ? (
              <>
                {/* Header & Quick Actions */}
                <div className="mods-detail-header">
                  <div className="mods-detail-title">
                    <h3>{selected.name}</h3>
                    <span
                      className={`mods-state-pill ${selected.enabled ? "on" : "off"}`}
                    >
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor" }} />
                      {selected.enabled ? t("mods.enabled") : t("mods.disabled")}
                    </span>
                  </div>

                  <div className="mods-detail-actions">
                    <Button
                      variant={selected.enabled ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => void handleToggle(selected)}
                    >
                      {selected.enabled ? t("mods.disable") : t("mods.enable")}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setDeleteTarget(selected)}
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                      {t("mods.delete")}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleOpenFolder(
                          selected.kind === "folder"
                            ? selected.path
                            : selected.path.replace(/[\\/][^\\/]+$/, "")
                        )
                      }
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                      {t("mods.openLocation")}
                    </Button>
                  </div>
                </div>

                {workshopPreviewUrl && (
                  <div className="mods-workshop-preview" style={{ marginBottom: "12px", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255, 255, 255, 0.1)", maxHeight: "180px", background: "rgba(0, 0, 0, 0.2)" }}>
                    <img src={workshopPreviewUrl} alt={selected.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                )}

                {selected.engine === "workshop" && (
                  <div className="mods-nexus-hint" style={{ background: "rgba(102, 192, 244, 0.1)", padding: "8px 12px", borderRadius: "8px", color: "#66c0f4", marginBottom: "12px" }}>
                    ℹ {t("mods.workshopManaged")}
                  </div>
                )}

                {/* Grid KPI Stat Cards */}
                <div className="mods-detail-grid">
                  <div className="mods-detail-stat-card">
                    <span className="mods-detail-stat-label">{t("mods.version")}</span>
                    <span className="mods-detail-stat-val">{selected.version ?? "—"}</span>
                  </div>

                  <div className="mods-detail-stat-card">
                    <span className="mods-detail-stat-label">{t("mods.latestVersion")}</span>
                    <span className={`mods-detail-stat-val ${selected.updateAvailable ? "mods-text-update" : ""}`}>
                      {selected.latestVersion ?? "—"}
                    </span>
                  </div>

                  <div className="mods-detail-stat-card">
                    <span className="mods-detail-stat-label">{t("mods.author")}</span>
                    <span className="mods-detail-stat-val">{selected.author ?? "—"}</span>
                  </div>

                  <div className="mods-detail-stat-card">
                    <span className="mods-detail-stat-label">{t("mods.engine")}</span>
                    <EngineChip engine={selected.engine} />
                  </div>

                  <div className="mods-detail-stat-card">
                    <span className="mods-detail-stat-label">{t("mods.kind")}</span>
                    <span className="mods-detail-stat-val">{selected.kind}</span>
                  </div>

                  <div className="mods-detail-stat-card">
                    <span className="mods-detail-stat-label">{t("mods.order")}</span>
                    <span className="mods-detail-stat-val">#{mods.indexOf(selected) + 1}</span>
                  </div>

                  <div className="mods-detail-stat-card">
                    <span className="mods-detail-stat-label">{t("mods.size")}</span>
                    <span className="mods-detail-stat-val">{formatModSize(selected.sizeBytes)}</span>
                  </div>

                  <div className="mods-detail-stat-card">
                    <span className="mods-detail-stat-label">{t("mods.files")}</span>
                    <span className="mods-detail-stat-val">{selected.fileCount ?? "—"}</span>
                  </div>
                </div>

                {/* Path Bar with Copy Button */}
                <div className="mods-detail-path-box">
                  <div className="mods-detail-path-info">
                    <span className="mods-detail-stat-label">{t("mods.path")}</span>
                    <code>{selected.path}</code>
                  </div>
                  <button
                    type="button"
                    className={`mods-copy-btn ${copiedPath ? "copied" : ""}`}
                    onClick={() => handleCopyPath(selected.path)}
                    title={t("mods.copyPath")}
                  >
                    {copiedPath ? (
                      <>
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        {t("mods.pathCopied")}
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        {t("mods.copyPath")}
                      </>
                    )}
                  </button>
                </div>

                {/* Steam Workshop Direct Web Link Button */}
                {workshopItemId && (
                  <button
                    type="button"
                    className="mods-nexus-link"
                    style={{ background: "rgba(102, 192, 244, 0.15)", color: "#66c0f4", borderColor: "rgba(102, 192, 244, 0.3)" }}
                    onClick={() => void openUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopItemId}`)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                      <path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5l2.67-3.7a3.48 3.48 0 0 1-.51-1.8c0-1.93 1.57-3.5 3.5-3.5s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5c-.32 0-.63-.04-.93-.13l-2.6 3.6a10 10 0 0 0 11.03-9.47A10 10 0 0 0 12 2z"/>
                    </svg>
                    {t("mods.viewOnWorkshop")} (Item #{workshopItemId})
                  </button>
                )}

                {/* Nexus Direct Web Link Button */}
                {nexusUrlFor(selected) && (
                  <button
                    type="button"
                    className="mods-nexus-link"
                    onClick={() => void openUrl(nexusUrlFor(selected)!)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="2" y1="12" x2="22" y2="12"></line>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                    </svg>
                    {t("mods.viewOnNexus")}
                    {selected.updateAvailable ? ` · ${t("mods.updateAvailable")}` : ""}
                  </button>
                )}

                {/* Conflict Visualizer Section */}
                <div className="mods-detail-section">
                  <div className="mods-detail-section-title">
                    <span>{t("mods.conflicts")}</span>
                    {selectedConflicts.length > 0 && (
                      <span className="mods-badge mods-badge-conflict">
                        {selectedConflicts.length}
                      </span>
                    )}
                  </div>
                  {selectedConflicts.length === 0 ? (
                    <p className="mods-nexus-hint" style={{ margin: 0 }}>{t("mods.noConflicts")}</p>
                  ) : (
                    <div className="mods-conflict-panel">
                      <ul className="mods-conflict-list">
                        {selectedConflicts.slice(0, 30).map((c) => (
                          <li key={c.relativePath} className="mods-conflict-item">
                            <code>{c.relativePath}</code>
                            <span>
                              {c.modIds
                                .filter((id) => id !== selected.id)
                                .map((id) => modNameById.get(id) ?? id)
                                .join(", ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Interactive File Inspector Section */}
                <div className="mods-detail-section">
                  <div className="mods-detail-section-title">
                    <span>{t("mods.files")}</span>
                    <button
                      type="button"
                      className={`mods-files-toggle ${showFiles ? "active" : ""}`}
                      onClick={() => void loadFiles(selected)}
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {showFiles ? (
                          <>
                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"></path>
                            <line x1="18" y1="13" x2="6" y2="13"></line>
                          </>
                        ) : (
                          <>
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            <line x1="12" y1="11" x2="12" y2="17"></line>
                            <line x1="9" y1="14" x2="15" y2="14"></line>
                          </>
                        )}
                      </svg>
                      {showFiles ? t("mods.hideFiles") : t("mods.showFiles")}
                    </button>
                  </div>

                  {showFiles && (
                    <div className="mods-file-explorer">
                      <input
                        type="text"
                        className="mods-file-search"
                        placeholder={t("mods.searchFiles")}
                        value={fileSearch}
                        onChange={(e) => setFileSearch(e.target.value)}
                      />
                      <ul className="mods-file-list">
                        {files === null ? (
                          <li className="mods-file-item">{t("common.loading")}</li>
                        ) : filteredFiles.length === 0 ? (
                          <li className="mods-file-item" style={{ color: "var(--color-text-muted)" }}>
                            No matching files found.
                          </li>
                        ) : (
                          filteredFiles.map((f) => (
                            <li key={f} className="mods-file-item">
                              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-text-muted)" }}>
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                              </svg>
                              <code>{f}</code>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="mods-detail-empty">{t("mods.selectMod")}</div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("mods.deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        message={t("mods.deleteConfirmMessage")}
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        open={showBulkDeleteModal}
        title={t("mods.bulkDeleteConfirmTitle", { count: String(selectedIds.size) })}
        message={t("mods.bulkDeleteConfirmMessage", { count: String(selectedIds.size) })}
        busy={bulkProcessing}
        onConfirm={() => void handleBulkDelete()}
        onCancel={() => setShowBulkDeleteModal(false)}
      />
    </div>
  );
}
