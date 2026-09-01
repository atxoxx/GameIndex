// Dual-pane mod manager, shared by the game page "Mods" tab and the main Mods page.
// Cleanly decomposed into modular components: ModsHeroStats, ModsToolbar, ModList, ModDetailPane, NexusDrawer, ModPresetsModal, ModExportModal, ModInstallModal.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Game } from "../../types/game";
import type { GameMod, ModConflict } from "../../types/mods";
import { useGameMods } from "../../hooks/useGameMods";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { ConfirmModal } from "../ui";
import ModsHeroStats, { type FilterTab } from "./ModsHeroStats";
import ModsToolbar, { type ModSortOption } from "./ModsToolbar";
import ModList from "./ModList";
import ModDetailPane from "./ModDetailPane";
import NexusDrawer from "./NexusDrawer";
import ModPresetsModal, { type ModPreset } from "./ModPresetsModal";
import ModExportModal from "./ModExportModal";
import ModInstallModal from "./ModInstallModal";
import "../../styles/page-mods.css";

interface ModManagerProps {
  game: Game;
  /** Fired after any mutation so parent overview rails can refresh counts. */
  onChanged?: () => void;
  /** Fired whenever the total on-disk mods footprint changes. */
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
}

export default function ModManager({
  game,
  onChanged,
  onModsSized,
}: ModManagerProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const {
    payload,
    conflicts,
    loading,
    scanning,
    checkingUpdates,
    error,
    scanProgress,
    scan,
    cancelScan,
    undoLast,
    setEnabled,
    reorder,
    remove,
    checkUpdates,
    setCustomRoot,
    setNexusDomain,
  } = useGameMods(game);

  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [selectedEngine, setSelectedEngine] = useState<string | null>(null);
  const [modSort, setModSort] = useState<ModSortOption>("order");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // Modals & Drawers state
  const [deleteTarget, setDeleteTarget] = useState<GameMod | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [showPresetsModal, setShowPresetsModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [nexusOpen, setNexusOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const mods = payload?.mods ?? [];
  const engines = payload?.engines ?? [];
  const supportsReorder = payload?.supportsReorder ?? false;
  const canScan = !!game.path;

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

  // Conflict indexing
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

  const enabledCount = mods.filter((m) => m.enabled).length;
  const disabledCount = mods.length - enabledCount;
  const updateCount = mods.filter((m) => m.updateAvailable).length;

  // Filter pipeline
  const filtered = useMemo(() => {
    let result = mods;

    // Filter by status tab
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

    // Filter by engine
    if (selectedEngine) {
      result = result.filter((m) => m.engine === selectedEngine);
    }

    // Search query
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
  }, [mods, filterTab, selectedEngine, search, conflictsByMod]);

  // Sort pipeline
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

  // Selected item synchronization
  const selected = mods.find((m) => m.id === selectedId) ?? null;

  useEffect(() => {
    if (sortedMods.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !sortedMods.some((m) => m.id === selectedId)) {
      setSelectedId(sortedMods[0]?.id ?? null);
    }
  }, [sortedMods, selectedId]);

  // Handlers
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

  const runBulkToggle = async (targetEnabled: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    const results = await Promise.allSettled(ids.map((id) => setEnabled(id, targetEnabled)));
    const success = results.filter((r) => r.status === "fulfilled").length;
    const firstError =
      (results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      )?.reason as unknown) ?? null;
    setBulkProcessing(false);
    const suffix = firstError !== null ? ` — ${String(firstError)}` : "";
    if (success === 0) {
      showToast(`${t("mods.bulkFailed", { count: String(ids.length) })}${suffix}`, "error");
    } else if (success < ids.length) {
      showToast(
        `${t(targetEnabled ? "mods.bulkEnabledPartial" : "mods.bulkDisabledPartial", {
          success: String(success),
          total: String(ids.length),
        })}${suffix}`,
        "warning"
      );
    } else {
      showToast(
        t(targetEnabled ? "mods.bulkEnabled" : "mods.bulkDisabled", {
          count: String(success),
        }),
        "success"
      );
    }
    onChanged?.();
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    const results = await Promise.allSettled(ids.map((id) => remove(id)));
    const success = results.filter((r) => r.status === "fulfilled").length;
    const firstError =
      (results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      )?.reason as unknown) ?? null;
    setBulkProcessing(false);
    setSelectedIds(new Set());
    setShowBulkDeleteModal(false);
    const suffix = firstError !== null ? ` — ${String(firstError)}` : "";
    if (success === 0) {
      showToast(`${t("mods.bulkDeleteFailed", { count: String(ids.length) })}${suffix}`, "error");
    } else if (success < ids.length) {
      showToast(
        `${t("mods.bulkDeletedPartial", {
          success: String(success),
          total: String(ids.length),
        })}${suffix}`,
        "warning"
      );
    } else {
      showToast(t("mods.bulkDeleted", { count: String(success) }), "success");
    }
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

  const handleApplyPreset = async (preset: ModPreset) => {
    const knownIds = new Set(mods.map((m) => m.id));
    const missingIds = Object.keys(preset.modStates).filter((id) => !knownIds.has(id));
    if (missingIds.length > 0) {
      showToast(t("mods.profileMissingMods", { count: String(missingIds.length) }), "warning");
    }
    for (const [modId, state] of Object.entries(preset.modStates)) {
      const current = mods.find((m) => m.id === modId);
      if (current && current.enabled !== state) {
        await setEnabled(modId, state);
      }
    }
    if (preset.order && supportsReorder) {
      const validOrdered = preset.order.filter((id) => knownIds.has(id));
      const remaining = mods.filter((m) => !validOrdered.includes(m.id)).sort((a, b) => a.loadOrder - b.loadOrder).map((m) => m.id);
      const completeOrder = [...validOrdered, ...remaining];
      if (completeOrder.length === mods.length) {
        await reorder(completeOrder);
      }
    }
    onChanged?.();
  };

  const dragEnabled =
    supportsReorder &&
    search.trim() === "" &&
    filterTab === "all" &&
    selectedEngine === null &&
    modSort === "order";

  // Draggable split resizer — left pane width in px when the user has
  // dragged the handle; `null` falls back to the CSS default ratio.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [leftWidth, setLeftWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const split = splitRef.current;
    const listPane = split?.querySelector<HTMLElement>(".mods-list-pane");
    if (!split || !listPane) return;
    const startX = e.clientX;
    const startW = listPane.getBoundingClientRect().width;
    // Keep the detail pane usable: never squeeze it below ~430px.
    const maxW = Math.max(360, split.getBoundingClientRect().width - 430);
    const minW = 300;

    const onMove = (ev: PointerEvent) => {
      const next = Math.min(maxW, Math.max(minW, startW + (ev.clientX - startX)));
      setLeftWidth(next);
      setResizing(true);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setResizing(true);
  }, []);

  const handleResizerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const split = splitRef.current;
    const listPane = split?.querySelector<HTMLElement>(".mods-list-pane");
    const current =
      leftWidth ?? listPane?.getBoundingClientRect().width ?? 420;
    setLeftWidth(Math.max(300, Math.round(current + (e.key === "ArrowRight" ? 24 : -24))));
  }, [leftWidth]);

  return (
    <div className="mods-manager" ref={rootRef}>
      {/* KPI Hero Stats Bar */}
      <ModsHeroStats
        mods={mods}
        activeFilter={filterTab}
        onFilterChange={setFilterTab}
        conflictCount={conflictCount}
      />

      {/* Toolbar Controls */}
      {!scanning && (
        <div className="mods-undo-bar">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void undoLast()}>
            {t("mods.undoLast")}
          </button>
        </div>
      )}

      {scanning && (
        <div className="mods-scan-progress" role="status" aria-live="polite">
          {scanProgress.phase || t("mods.scanning")} · {scanProgress.filesExamined} files · {scanProgress.modsFound} mods
        </div>
      )}

      <ModsToolbar
        search={search}
        onSearchChange={setSearch}
        filterTab={filterTab}
        onFilterTabChange={setFilterTab}
        selectedEngine={selectedEngine}
        onEngineChange={setSelectedEngine}
        availableEngines={engines}
        modSort={modSort}
        onSortChange={setModSort}
        totalCount={mods.length}
        enabledCount={enabledCount}
        disabledCount={disabledCount}
        updateCount={updateCount}
        conflictCount={conflictCount}
        canScan={canScan}
        scanning={scanning}
        checkingUpdates={checkingUpdates}
        onScan={handleScan}
        onCancelScan={() => void cancelScan()}
        onCheckUpdates={handleCheckUpdates}
        onInstallMod={() => setShowInstallModal(true)}
        onOpenPresets={() => setShowPresetsModal(true)}
        onOpenExport={() => setShowExportModal(true)}
        onOpenFolder={payload?.settings?.modsRoot ? () => handleOpenFolder() : undefined}
        onPickFolder={handlePickFolder}
        hasModsRoot={!!payload?.settings?.modsRoot}
        customRootTitle={payload?.settings?.customRoot ?? undefined}
        nexusOpen={nexusOpen}
        onToggleNexus={() => setNexusOpen((v) => !v)}
      />

      {/* Nexus Integration Drawer */}
      {nexusOpen && (
        <NexusDrawer
          currentDomain={payload?.settings?.nexusDomain}
          onDomainSaved={async (domain) => {
            await setNexusDomain(domain);
          }}
        />
      )}

      {error && (
        <div className="mods-error" role="alert">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* Main Dual-Pane Workspace */}
      {loading && mods.length === 0 ? (
        <div className="mods-loading" role="status" aria-live="polite">
          <div className="mods-loading-stats">
            <span className="mods-loading-block mods-loading-block--stat" aria-hidden />
            <span className="mods-loading-block mods-loading-block--stat" aria-hidden />
            <span className="mods-loading-block mods-loading-block--stat" aria-hidden />
            <span className="mods-loading-block mods-loading-block--stat" aria-hidden />
          </div>
          <div className="mods-loading-split">
            <div className="mods-loading-list">
              {[0, 1, 2, 3, 4].map((i) => (
                <div className="mods-loading-row" key={i}>
                  <span className="mods-loading-block mods-loading-block--checkbox" aria-hidden />
                  <span className="mods-loading-block mods-loading-block--toggle" aria-hidden />
                  <span className="mods-loading-block mods-loading-block--name" aria-hidden />
                  <span className="mods-loading-block mods-loading-block--badge" aria-hidden />
                </div>
              ))}
            </div>
            <div className="mods-loading-detail">
              <span className="mods-loading-block mods-loading-block--title" aria-hidden />
              <span className="mods-loading-block mods-loading-block--line" aria-hidden />
              <span className="mods-loading-block mods-loading-block--line mods-loading-block--line-sm" aria-hidden />
            </div>
          </div>
          <p className="mods-loading-text">{t("common.loading")}</p>
        </div>
      ) : mods.length === 0 ? (
        <div className="mods-empty">
          <div className="mods-empty-glyph">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <h3>{t("mods.emptyTitle")}</h3>
          <p>{t("mods.emptySubtitle")}</p>
          <div className="mods-empty-actions">
            <span className="mods-scan-wrap" title={!canScan ? t("mods.scanDisabledHint") : undefined}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleScan}
                disabled={!canScan || scanning}
              >
                {scanning ? t("mods.scanning") : t("mods.scan")}
              </button>
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={handlePickFolder}
            >
              {t("mods.setFolder")}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`mods-split${resizing ? " is-resizing" : ""}`}
          ref={splitRef}
          style={leftWidth != null ? { "--mods-left": `${leftWidth}px` } as React.CSSProperties : undefined}
        >
          {/* Left: Mod List */}
          <ModList
            mods={mods}
            sortedMods={sortedMods}
            selectedId={selectedId}
            onSelectMod={setSelectedId}
            selectedIds={selectedIds}
            onToggleSelectMod={toggleSelectMod}
            onToggleSelectAll={handleToggleSelectAll}
            allSelected={allSelected}
            onToggleEnabled={handleToggle}
            onReorder={reorder}
            conflictsByMod={conflictsByMod}
            engines={engines}
            supportsReorder={supportsReorder}
            dragEnabled={dragEnabled}
            bulkProcessing={bulkProcessing}
            onBulkEnable={() => void runBulkToggle(true)}
            onBulkDisable={() => void runBulkToggle(false)}
            onBulkDelete={() => setShowBulkDeleteModal(true)}
            onClearSelection={() => setSelectedIds(new Set())}
            onClearFilters={() => {
              setSearch("");
              setFilterTab("all");
              setSelectedEngine(null);
            }}
          />

          {/* Draggable split resizer */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("mods.resizePane")}
            tabIndex={0}
            className="mods-resizer"
            onPointerDown={handleResizeStart}
            onKeyDown={handleResizerKeyDown}
          >
            <span className="mods-resizer__grip" aria-hidden="true">
              <i /><i /><i />
            </span>
          </div>

          {/* Right: Mod Detail Inspector */}
          <ModDetailPane
            selected={selected}
            mods={mods}
            conflicts={conflicts}
            nexusDomain={payload?.settings?.nexusDomain}
            onToggleEnabled={handleToggle}
            onDeleteRequest={setDeleteTarget}
            onOpenFolder={handleOpenFolder}
          />
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={deleteTarget !== null}
        title={t("mods.deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        message={t("mods.deleteConfirmMessage")}
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Bulk Delete Modal */}
      <ConfirmModal
        open={showBulkDeleteModal}
        title={t("mods.bulkDeleteConfirmTitle", { count: String(selectedIds.size) })}
        message={t("mods.bulkDeleteConfirmMessage", { count: String(selectedIds.size) })}
        busy={bulkProcessing}
        onConfirm={() => void handleBulkDelete()}
        onCancel={() => setShowBulkDeleteModal(false)}
      />

      {/* Presets Manager Modal */}
      <ModPresetsModal
        game={game}
        mods={mods}
        isOpen={showPresetsModal}
        onClose={() => setShowPresetsModal(false)}
        onApplyPreset={handleApplyPreset}
      />

      {/* Export Load Order Modal */}
      <ModExportModal
        game={game}
        mods={sortedMods}
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />

      {/* Install Mod Modal */}
      <ModInstallModal
        game={game}
        modsRoot={payload?.settings?.modsRoot ?? payload?.settings?.customRoot ?? undefined}
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
        onScan={scan}
      />
    </div>
  );
}
