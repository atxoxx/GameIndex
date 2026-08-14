import { useCallback, useEffect, useMemo, useState } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { useGames } from "../context/GameContext";
import type { Game } from "../types/game";
import {
  accentForPlatform,
  KNOWN_EMULATORS,
  type Emulator,
  type KnownEmulator,
  type EmuRow,
  type PlatformCategory,
} from "../types/emulator";
import { Button, ConfirmModal, PageHeader } from "../components/ui";
import "../styles/page-emulators.css";

import EmulatorStatsHeader, { type EmuFilter } from "../components/emulators/EmulatorStatsHeader";
import EmulatorSidebarList, { type SortKey, type SortDir } from "../components/emulators/EmulatorSidebarList";
import EmulatorDetailHero from "../components/emulators/EmulatorDetailHero";
import EmulatorRomManager from "../components/emulators/EmulatorRomManager";
import EmulatorRomDetailModal from "../components/emulators/EmulatorRomDetailModal";
import EmulatorEditorModal from "./EmulatorEditorModal";
import DownloadEmulatorModal from "../components/emulators/DownloadEmulatorModal";

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export default function EmulatorsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { games, addGame, updateGame, removeGames, launchGame, runningGameIds } = useGames();

  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [editing, setEditing] = useState<Emulator | null>(null);
  const [presetKnown, setPresetKnown] = useState<KnownEmulator | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<Record<string, number>>({});
  const [confirmDelete, setConfirmDelete] = useState<Emulator | null>(null);
  const [renameGame, setRenameGame] = useState<Game | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteRom, setConfirmDeleteRom] = useState<Game | null>(null);
  const [recalcId, setRecalcId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [inspectRom, setInspectRom] = useState<Game | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<PlatformCategory>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<EmuFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await invoke<Emulator[]>("list_emulators");
      setEmulators(list);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // ROM count & size per emulator derived from library
  const romStats = useMemo(() => {
    const counts: Record<string, number> = {};
    const sizes: Record<string, number> = {};
    for (const g of games) {
      if (g.emulatorId) {
        counts[g.emulatorId] = (counts[g.emulatorId] ?? 0) + 1;
        sizes[g.emulatorId] = (sizes[g.emulatorId] ?? 0) + (g.sizeBytes ?? 0);
      }
    }
    return { counts, sizes };
  }, [games]);

  // Merge catalog with configured emulators
  const rows = useMemo<EmuRow[]>(() => {
    const result: EmuRow[] = [];
    const used = new Set<string>();

    for (const k of KNOWN_EMULATORS) {
      const emu =
        emulators.find((e) => e.name === k.name) ??
        emulators.find((e) => e.platform === k.platform);
      if (emu) used.add(emu.id);
      result.push({
        id: emu ? emu.id : `known:${k.key}`,
        known: k,
        emulator: emu,
        name: emu?.name ?? k.name,
        platform: k.platform,
        accent: k.accent,
        glyph: k.glyph,
        logo: emu?.iconUrl ?? k.logo,
        added: !!emu,
        configured: !!emu?.executablePath,
        gameCount: emu ? (romStats.counts[emu.id] ?? 0) : 0,
        totalSizeBytes: emu ? (romStats.sizes[emu.id] ?? 0) : 0,
        createdAt: emu?.createdAt,
        scannedAt: emu ? lastScanned[emu.id] : undefined,
      });
    }

    for (const e of emulators) {
      if (used.has(e.id)) continue;
      const accent = accentForPlatform(e.platform);
      result.push({
        id: e.id,
        emulator: e,
        name: e.name,
        platform: e.platform,
        accent,
        glyph: "🎮",
        logo: e.iconUrl,
        added: true,
        configured: !!e.executablePath,
        gameCount: romStats.counts[e.id] ?? 0,
        totalSizeBytes: romStats.sizes[e.id] ?? 0,
        createdAt: e.createdAt,
        scannedAt: lastScanned[e.id],
      });
    }

    return result;
  }, [emulators, romStats, lastScanned]);

  // Overall KPIs
  const stats = useMemo(() => {
    const totalRoms = rows.reduce((sum, r) => sum + r.gameCount, 0);
    const totalSize = rows.reduce((sum, r) => sum + (r.totalSizeBytes ?? 0), 0);
    return {
      catalog: rows.length,
      added: rows.filter((r) => r.added).length,
      configured: rows.filter((r) => r.configured).length,
      roms: totalRoms,
      totalSizeBytes: totalSize,
    };
  }, [rows]);

  const selectedRow = useMemo<EmuRow | null>(() => {
    if (selectedId) {
      const hit = rows.find((r) => r.id === selectedId);
      if (hit) return hit;
    }
    return rows.find((r) => r.added) ?? rows[0] ?? null;
  }, [rows, selectedId]);

  useEffect(() => {
    if (!selectedId && rows.length) {
      const first = rows.find((r) => r.added) ?? rows[0];
      setSelectedId(first.id);
    }
  }, [rows, selectedId]);

  const selectedGames = useMemo(() => {
    if (!selectedRow?.emulator) return [];
    return games
      .filter((g) => g.emulatorId === selectedRow.emulator!.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [games, selectedRow]);

  const mergeScanned = useCallback(
    (scanned: Game[]) => {
      for (const g of scanned) {
        const existing = games.find((x) => x.id === g.id);
        if (existing) updateGame(g.id, g);
        else addGame(g);
      }
    },
    [games, addGame, updateGame]
  );

  const handleScan = useCallback(
    async (emu: Emulator) => {
      if (!emu.executablePath) {
        showToast(t("emulators.launcherNotSet"), "error");
        return;
      }
      if (!emu.romFolder) {
        showToast(t("emulators.folderNotSet"), "error");
        return;
      }
      setScanningId(emu.id);
      try {
        const scanned = await invoke<Game[]>("scan_emulator_roms", {
          emulatorId: emu.id,
        });
        mergeScanned(scanned);
        setLastScanned((prev) => ({ ...prev, [emu.id]: Date.now() }));
        const count = scanned.length;
        showToast(
          count === 1
            ? t("emulators.scanCompleteSingle", { count, name: emu.name })
            : t("emulators.scanComplete", { count, name: emu.name }),
          "success"
        );
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        setScanningId(null);
      }
    },
    [mergeScanned, showToast, t]
  );

  const handleScanAll = useCallback(async () => {
    for (const emu of emulators) {
      await handleScan(emu);
    }
  }, [emulators, handleScan]);

  const handleSaved = useCallback(
    async (emu: Emulator, scanAfter: boolean) => {
      setShowEditor(false);
      setEditing(null);
      setPresetKnown(null);
      await load();
      setSelectedId(emu.id);
      if (scanAfter) await handleScan(emu);
    },
    [load, handleScan]
  );

  const handleDownloadInstalled = useCallback(
    async (emu: Emulator) => {
      setShowDownload(false);
      await load();
      setSelectedId(emu.id);
      showToast(t("emulators.download.done") + " ✓", "success");
    },
    [load, showToast, t]
  );

  const handleOpenFolder = useCallback(
    async (folder: string) => {
      try {
        await openPath(folder);
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [showToast]
  );

  const handleLaunchExe = useCallback(
    async (emu: Emulator) => {
      if (!emu.executablePath) {
        showToast(t("emulators.launcherNotSet"), "error");
        return;
      }
      try {
        await openPath(emu.executablePath);
        showToast(t("emulators.launchExeSuccess", { name: emu.name }), "success");
      } catch (err) {
        showToast(t("emulators.launchExeError", { error: String(err) }), "error");
      }
    },
    [showToast, t]
  );

  const handleDelete = useCallback(
    async (emu: Emulator) => {
      try {
        await invoke("delete_emulator", { id: emu.id });
        removeGames((g) => g.emulatorId === emu.id);
        setEmulators((prev) => prev.filter((e) => e.id !== emu.id));
        showToast(t("emulators.delete") + " ✓", "success");
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        setConfirmDelete(null);
      }
    },
    [removeGames, showToast, t]
  );

  const handleAddRom = useCallback(
    async (emu: Emulator) => {
      try {
        const picked = await open({
          multiple: false,
          title: t("emulators.games.addRomTitle"),
        });
        if (!picked || typeof picked !== "string") return;
        const added = await invoke<Game>("add_rom_file", {
          emulatorId: emu.id,
          path: picked,
        });
        addGame(added);
        showToast(t("emulators.games.addRom") + " ✓", "success");
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [addGame, showToast, t]
  );

  const handleOpenLocation = useCallback(
    async (path: string) => {
      try {
        await invoke("open_folder", { path });
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [showToast]
  );

  const handleRenameRom = useCallback(async () => {
    if (!renameGame) return;
    const trimmed = renameValue.trim();
    if (trimmed === (renameGame.name ?? "")) {
      showToast(t("emulators.games.renameSame"), "error");
      return;
    }
    try {
      const updated = await invoke<Game>("rename_rom_file", {
        gameId: renameGame.id,
        newName: trimmed,
      });
      removeGames((g) => g.id === renameGame.id);
      addGame(updated);
      setRenameGame(null);
      setRenameValue("");
      if (inspectRom?.id === renameGame.id) {
        setInspectRom(updated);
      }
      showToast(t("emulators.games.rename") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }, [renameGame, renameValue, addGame, removeGames, inspectRom, showToast, t]);

  const handleDeleteRom = useCallback(async () => {
    if (!confirmDeleteRom) return;
    try {
      await invoke("delete_rom_file", { gameId: confirmDeleteRom.id });
      removeGames((g) => g.id === confirmDeleteRom.id);
      if (inspectRom?.id === confirmDeleteRom.id) {
        setInspectRom(null);
      }
      setConfirmDeleteRom(null);
      showToast(t("emulators.games.deleteRom") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }, [confirmDeleteRom, removeGames, inspectRom, showToast, t]);

  const handleRecalcSizes = useCallback(
    async (emu: Emulator) => {
      setRecalcId(emu.id);
      try {
        const updated = await invoke<Game[]>("recalc_rom_sizes", {
          emulatorId: emu.id,
        });
        for (const g of updated) updateGame(g.id, g);
        showToast(
          t("emulators.games.recalcDone", { count: updated.length }),
          "success"
        );
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        setRecalcId(null);
      }
    },
    [updateGame, showToast, t]
  );

  const openRename = useCallback((g: Game) => {
    setRenameGame(g);
    setRenameValue(g.name ?? "");
  }, []);

  const openAdd = useCallback(() => {
    setEditing(null);
    setPresetKnown(null);
    setShowEditor(true);
  }, []);

  const openAddKnown = useCallback((known: KnownEmulator) => {
    setEditing(null);
    setPresetKnown(known);
    setShowEditor(true);
  }, []);

  const openEdit = useCallback((emu: Emulator) => {
    setEditing(emu);
    setPresetKnown(null);
    setShowEditor(true);
  }, []);

  return (
    <div className="emulators-page">
      <PageHeader
        eyebrow={t("emulators.eyebrow")}
        title={t("emulators.title")}
        description={t("emulators.subtitle")}
        actions={
          <>
            <Button
              variant="primary"
              onClick={openAdd}
              leftIcon={
                <svg {...ICON}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              }
            >
              {t("emulators.addEmulator")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowDownload(true)}
              leftIcon={
                <svg {...ICON}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              }
            >
              {t("emulators.download.title")}
            </Button>
            {stats.added > 0 && (
              <Button
                variant="secondary"
                onClick={handleScanAll}
                disabled={scanningId !== null}
                leftIcon={
                  <svg {...ICON}>
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                }
              >
                {t("emulators.scanAll")}
              </Button>
            )}
          </>
        }
      />

      {!loading && (
        <EmulatorStatsHeader
          stats={stats}
          activeFilter={filter}
          onFilterChange={setFilter}
        />
      )}

      {loading ? (
        <div className="emulators-loading">
          <div className="emulators-skeleton-stats">
            {["", "", "", ""].map((_, i) => (
              <div key={i} className="emu-skeleton emu-skeleton-stat" />
            ))}
          </div>
          <div className="emulators-split">
            <div className="emu-skeleton emu-skeleton-list" />
            <div className="emu-skeleton emu-skeleton-detail" />
          </div>
        </div>
      ) : (
        <div className="emulators-split">
          {/* Left: Searchable list & filters */}
          <EmulatorSidebarList
            rows={rows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            search={search}
            onSearchChange={setSearch}
            filter={filter}
            onFilterChange={setFilter}
            category={category}
            onCategoryChange={setCategory}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            sortDir={sortDir}
            onToggleSortDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          />

          {/* Right: Selected emulator showcase & ROM manager */}
          <section className="emulators-detail-pane">
            {!selectedRow ? (
              <div className="emulators-detail-empty">
                <span className="emulators-detail-empty-glyph">🕹️</span>
                <p>{t("emulators.detail.emptySelection")}</p>
              </div>
            ) : (
              <div className="emulators-detail">
                {/* Hero Banner Showcase */}
                <EmulatorDetailHero
                  selectedRow={selectedRow}
                  scanningId={scanningId}
                  onLaunchExe={handleLaunchExe}
                  onScan={handleScan}
                  onEdit={openEdit}
                  onDelete={(emu) => setConfirmDelete(emu)}
                  onOpenFolder={handleOpenFolder}
                  onAddKnown={openAddKnown}
                  onOpenUrl={openUrl}
                />

                {/* Scanned ROMs Manager & Gallery (only when emulator is added) */}
                {selectedRow.added && selectedRow.emulator && (
                  <EmulatorRomManager
                    emulator={selectedRow.emulator}
                    accentColor={selectedRow.accent}
                    games={selectedGames}
                    runningGameIds={runningGameIds}
                    recalcId={recalcId}
                    onAddRom={handleAddRom}
                    onRecalcSizes={handleRecalcSizes}
                    onLaunch={launchGame}
                    onOpenLocation={handleOpenLocation}
                    onRename={openRename}
                    onDelete={(g) => setConfirmDeleteRom(g)}
                    onInspect={(g) => setInspectRom(g)}
                    onBulkDelete={() => setConfirmBulkDelete(true)}
                  />
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <EmulatorEditorModal
          emulator={editing}
          presetKnown={presetKnown}
          onClose={() => {
            setShowEditor(false);
            setEditing(null);
            setPresetKnown(null);
          }}
          onSaved={handleSaved}
        />
      )}

      {/* Download Wizard Modal */}
      {showDownload && (
        <DownloadEmulatorModal
          onClose={() => setShowDownload(false)}
          onInstalled={handleDownloadInstalled}
        />
      )}

      {/* Inspect ROM Details Modal */}
      {inspectRom && (
        <EmulatorRomDetailModal
          game={inspectRom}
          isRunning={runningGameIds.includes(inspectRom.id)}
          onClose={() => setInspectRom(null)}
          onLaunch={launchGame}
          onOpenLocation={handleOpenLocation}
          onRename={openRename}
          onDelete={(g) => setConfirmDeleteRom(g)}
        />
      )}

      {/* Delete Emulator Confirmation */}
      <ConfirmModal
        open={confirmDelete !== null}
        title={`${t("emulators.delete")}?`}
        message={
          confirmDelete
            ? romStats.counts[confirmDelete.id]
              ? t("emulators.confirmDelete", {
                  name: confirmDelete.name,
                  count: romStats.counts[confirmDelete.id],
                })
              : t("emulators.confirmDeleteNoGames", { name: confirmDelete.name })
            : undefined
        }
        confirmLabel="emulators.delete"
        onConfirm={() => {
          if (confirmDelete) handleDelete(confirmDelete);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Rename ROM Modal */}
      {renameGame && (
        <div className="modal-overlay" onMouseDown={() => setRenameGame(null)}>
          <div
            className="modal emulators-modal"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>{t("emulators.games.renameTitle")}</h2>
              <button
                className="modal-close"
                aria-label={t("common.close")}
                onClick={() => setRenameGame(null)}
              >
                ×
              </button>
            </div>
            <div className="modal-body emulators-editor-body">
              <label className="modal-label" htmlFor="rom-rename">
                {t("emulators.games.renameLabel")}
              </label>
              <input
                id="rom-rename"
                className="modal-input"
                type="text"
                value={renameValue}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameRom();
                }}
              />
            </div>
            <div className="modal-footer">
              <span className="modal-footer-count">&nbsp;</span>
              <div className="modal-footer-actions">
                <Button variant="ghost" onClick={() => setRenameGame(null)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onClick={handleRenameRom}>
                  {t("emulators.games.rename")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Single ROM Confirmation */}
      <ConfirmModal
        open={confirmDeleteRom !== null}
        title={`${t("emulators.games.deleteRom")}?`}
        message={
          confirmDeleteRom
            ? t("emulators.games.deleteConfirm", { name: confirmDeleteRom.name })
            : undefined
        }
        confirmLabel="emulators.games.deleteRom"
        onConfirm={() => {
          if (confirmDeleteRom) handleDeleteRom();
        }}
        onCancel={() => setConfirmDeleteRom(null)}
      />

      {/* Bulk Delete ROMs Confirmation */}
      <ConfirmModal
        open={confirmBulkDelete}
        title={`${t("emulators.games.deleteRom")}?`}
        message={t("emulators.games.bulkDeleteConfirm", {
          count: selectedGames.length,
        })}
        confirmLabel="emulators.games.deleteRom"
        onConfirm={async () => {
          for (const g of selectedGames) {
            try {
              await invoke("delete_rom_file", { gameId: g.id });
            } catch (err) {
              showToast(String(err), "error");
            }
          }
          removeGames((g) => g.emulatorId === selectedRow?.emulator?.id);
          setConfirmBulkDelete(false);
          showToast(t("emulators.games.romDeleted") + " ✓", "success");
        }}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
