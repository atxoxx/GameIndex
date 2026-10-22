import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  Compass,
  Download,
  Eye,
  FolderOpen,
  Heart,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { useToast } from "../context/ToastContext";
import { useGames } from "../context/GameContext";
import { useContextMenu } from "../hooks/useContextMenu";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import ContextMenu, { type ContextMenuItem } from "../components/ui/ContextMenu";
import type { Game } from "../types/game";
import {
  argumentsTemplateForHost,
  knownEmulatorByKey,
  type Emulator,
  type KnownEmulator,
  type DiscoveredEmulator,
  type BiosCheckResult,
} from "../types/emulator";
import { Button, ConfirmModal, PageHeader } from "../components/ui";
import PageWidget from "../components/PageWidget";
import "../styles/page-emulators.css";

import EmulatorStatsHeader from "../components/emulators/EmulatorStatsHeader";
import EmulatorBiosBoard from "../components/emulators/EmulatorBiosBoard";
import EmulatorSidebarList from "../components/emulators/EmulatorSidebarList";
import EmulatorDetailHero from "../components/emulators/EmulatorDetailHero";
import EmulatorRomManager from "../components/emulators/EmulatorRomManager";
import EmulatorRomDetailModal from "../components/emulators/EmulatorRomDetailModal";
import EmulatorAddModal from "../components/emulators/EmulatorAddModal";
import EmulatorEditorModal from "./EmulatorEditorModal";
import DownloadEmulatorModal from "../components/emulators/DownloadEmulatorModal";
import {
  computeEmulatorKpis,
  emulatorVisual,
  isEmulatorReady,
  type EmuStatusFilter,
  type SetupStepKey,
} from "../components/emulators/emulatorUi";

export default function EmulatorsPage() {
  const { t } = useLanguage();
  const { hostPlatform } = useSettings();
  const { showToast } = useToast();
  const { games, addGame, updateGame, removeGames, launchGame, runningGameIds } = useGames();
  const romMenu = useContextMenu<Game>();
  const copy = useCopyToClipboard();

  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [showAdd, setShowAdd] = useState(false);
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
  const [inspectRom, setInspectRom] = useState<Game | null>(null);
  // BIOS + ROM-folder discovery tools
  const [biosResult, setBiosResult] = useState<BiosCheckResult | null>(null);
  const [romFolderCandidates, setRomFolderCandidates] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EmuStatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("gamelib-last-emulator") || null;
    } catch {
      return null;
    }
  });

  // Header overflow menu, anchored to its trigger.
  const overflowRef = useRef<HTMLButtonElement | null>(null);
  const [overflowMenu, setOverflowMenu] = useState<{ x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await invoke<Emulator[]>("list_emulators");
      setEmulators(list);
    } catch (err) {
      showToast(String(err), "error");
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // ROM count & size per emulator derived from the library.
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

  const kpis = useMemo(() => {
    const totalSize = Object.values(romStats.sizes).reduce((sum, n) => sum + n, 0);
    return computeEmulatorKpis(emulators, romStats.counts, totalSize);
  }, [emulators, romStats]);

  const selectedEmulator = useMemo<Emulator | null>(() => {
    if (selectedId) {
      const hit = emulators.find((e) => e.id === selectedId);
      if (hit) return hit;
    }
    return emulators[0] ?? null;
  }, [emulators, selectedId]);

  // Keep a valid selection as the list loads/changes.
  useEffect(() => {
    if (emulators.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !emulators.some((e) => e.id === selectedId)) {
      setSelectedId(emulators[0].id);
    }
  }, [emulators, selectedId]);

  // Remember the last selected emulator across restarts.
  useEffect(() => {
    if (selectedId) {
      try {
        localStorage.setItem("gamelib-last-emulator", selectedId);
      } catch {
        /* ignore */
      }
    }
  }, [selectedId]);

  const selectedVisual = useMemo(
    () => (selectedEmulator ? emulatorVisual(selectedEmulator) : null),
    [selectedEmulator]
  );

  const selectedGames = useMemo(() => {
    if (!selectedEmulator) return [];
    return games
      .filter((g) => g.emulatorId === selectedEmulator.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [games, selectedEmulator]);

  const selectedRomCount = selectedEmulator
    ? romStats.counts[selectedEmulator.id] ?? 0
    : 0;
  const selectedSizeBytes = selectedEmulator
    ? romStats.sizes[selectedEmulator.id] ?? 0
    : 0;
  const selectedLastPlayed = useMemo(() => {
    let latest = 0;
    for (const g of selectedGames) {
      if ((g.lastPlayed ?? 0) > latest) latest = g.lastPlayed ?? 0;
    }
    return latest || undefined;
  }, [selectedGames]);

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

  // Keep a ref of the current emulator list for the watcher listener.
  const emulatorsRef = useRef(emulators);
  useEffect(() => {
    emulatorsRef.current = emulators;
  }, [emulators]);

  // ROM-folder watcher: auto-rescan (auto_scan) or prompt via toast.
  useEffect(() => {
    let disposed = false;
    const unlisten = listen<{ emulatorId: string; folder: string; autoScan: boolean }>(
      "rom-folder-changed",
      (event) => {
        if (disposed) return;
        const { emulatorId, autoScan } = event.payload;
        const emu = emulatorsRef.current.find((e) => e.id === emulatorId);
        if (!emu) return;
        if (autoScan) {
          handleScan(emu);
        } else {
          showToast(t("emulators.watcher.changed", { name: emu.name }), "info");
        }
      }
    );
    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleScan, showToast, t]);

  const handleAddDiscovered = useCallback(
    async (d: DiscoveredEmulator) => {
      const known = knownEmulatorByKey(d.key);
      const now = Date.now();
      const emu: Emulator = {
        id: `emu-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: known?.name ?? d.name,
        platform: known?.platform ?? d.platform,
        executablePath: d.executablePath,
        argumentsTemplate: known
          ? argumentsTemplateForHost(known, hostPlatform)
          : '"%ROM%"',
        romFolder: "",
        iconUrl: known?.logo,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await invoke("save_emulator", { emulator: emu });
        await load();
        setSelectedId(emu.id);
        showToast(t("emulators.discovery.addDone") + " ✓", "success");
      } catch (err) {
        showToast(t("emulators.discovery.addError", { error: String(err) }), "error");
      }
    },
    [load, showToast, t, hostPlatform]
  );

  const handleCheckBios = useCallback(
    async (emu: Emulator) => {
      try {
        const result = await invoke<BiosCheckResult>("check_bios_status", {
          emulatorId: emu.id,
        });
        setBiosResult(result);
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [showToast]
  );

  const handleFindRomFolders = useCallback(
    async (emu: Emulator) => {
      try {
        const folders = await invoke<string[]>("discover_rom_folders", {
          emulatorId: emu.id,
        });
        setRomFolderCandidates(folders);
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [showToast]
  );

  const handleUseRomFolder = useCallback(
    async (emu: Emulator, folder: string) => {
      const updated = { ...emu, romFolder: folder, updatedAt: Date.now() };
      try {
        await invoke("save_emulator", { emulator: updated });
        await load();
        setRomFolderCandidates([]);
        await handleScan(updated);
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [load, handleScan, showToast]
  );

  const handleExportConfig = useCallback(async () => {
    try {
      const json = await invoke<string>("export_emulators_config");
      const target = await save({
        title: t("emulators.config.export"),
        defaultPath: "gameindex-emulators.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!target) return;
      await invoke("save_text_file", { filePath: target, contents: json });
      showToast(t("emulators.config.exportDone") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }, [showToast, t]);

  const handleImportConfig = useCallback(async () => {
    try {
      const picked = await open({
        multiple: false,
        title: t("emulators.config.import"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!picked || typeof picked !== "string") return;
      const json = await invoke<string>("read_text_file", { filePath: picked });
      const count = await invoke<number>("import_emulators_config", { json });
      await load();
      showToast(t("emulators.config.importDone", { count }) + " ✓", "success");
    } catch (err) {
      showToast(t("emulators.config.importError", { error: String(err) }), "error");
    }
  }, [load, showToast, t]);

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

  const handleDeleteRoms = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        try {
          await invoke("delete_rom_file", { gameId: id });
        } catch (err) {
          showToast(String(err), "error");
        }
      }
      removeGames((g) => ids.includes(g.id));
      if (inspectRom && ids.includes(inspectRom.id)) setInspectRom(null);
      showToast(t("emulators.games.romDeleted") + " ✓", "success");
    },
    [removeGames, inspectRom, showToast, t]
  );

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
    setShowAdd(true);
    setOverflowMenu(null);
  }, []);

  const openAddKnown = useCallback((known: KnownEmulator) => {
    setShowAdd(false);
    setEditing(null);
    setPresetKnown(known);
    setShowEditor(true);
  }, []);

  const openCustom = useCallback(() => {
    setShowAdd(false);
    setEditing(null);
    setPresetKnown(null);
    setShowEditor(true);
  }, []);

  const openEdit = useCallback((emu: Emulator) => {
    setEditing(emu);
    setPresetKnown(null);
    setShowEditor(true);
  }, []);

  const openDownload = useCallback(() => {
    setShowAdd(false);
    setOverflowMenu(null);
    setShowDownload(true);
  }, []);

  const openOverflow = useCallback(() => {
    const rect = overflowRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOverflowMenu({ x: rect.right, y: rect.bottom + 4 });
  }, []);

  const handleFixSetup = useCallback(
    (key: SetupStepKey) => {
      if (!selectedEmulator) return;
      if (key === "scan") handleScan(selectedEmulator);
      else openEdit(selectedEmulator);
    },
    [selectedEmulator, handleScan, openEdit]
  );

  const overflowItems: ContextMenuItem[] = useMemo(
    () => [
      {
        id: "discover",
        label: t("emulators.discovery.scan"),
        icon: <Compass size={15} />,
        onSelect: () => {
          setOverflowMenu(null);
          openAdd();
        },
      },
      {
        id: "download",
        label: t("emulators.download.title"),
        icon: <Download size={15} />,
        onSelect: openDownload,
      },
      { id: "sep-config", separator: true },
      {
        id: "export",
        label: t("emulators.config.export"),
        icon: <Upload size={15} />,
        onSelect: () => {
          setOverflowMenu(null);
          void handleExportConfig();
        },
      },
      {
        id: "import",
        label: t("emulators.config.import"),
        icon: <Download size={15} />,
        onSelect: () => {
          setOverflowMenu(null);
          void handleImportConfig();
        },
      },
    ],
    [t, openDownload, handleExportConfig, handleImportConfig]
  );

  const contextRom = romMenu.state?.target ?? null;

  const romMenuItems: ContextMenuItem[] = contextRom
    ? [
        {
          id: "launch",
          label: t("emulators.games.launch"),
          icon: <Play size={15} />,
          accent: true,
          onSelect: () => {
            romMenu.close();
            launchGame(contextRom);
          },
        },
        {
          id: "details",
          label: t("game.viewDetails"),
          icon: <Eye size={15} />,
          onSelect: () => {
            romMenu.close();
            setInspectRom(contextRom);
          },
        },
        {
          id: "favorite",
          label: contextRom.favorite
            ? t("emulators.roms.favoriteRemove")
            : t("emulators.roms.favoriteAdd"),
          icon: <Heart size={15} fill={contextRom.favorite ? "currentColor" : "none"} />,
          onSelect: () => {
            romMenu.close();
            updateGame(contextRom.id, { favorite: !contextRom.favorite });
          },
        },
        { id: "sep-1", separator: true },
        {
          id: "open-location",
          label: t("emulators.games.openLocation"),
          icon: <FolderOpen size={15} />,
          onSelect: () => {
            romMenu.close();
            handleOpenLocation(contextRom.romPath ?? contextRom.path);
          },
        },
        {
          id: "rename",
          label: t("emulators.games.rename"),
          icon: <Pencil size={15} />,
          onSelect: () => {
            romMenu.close();
            openRename(contextRom);
          },
        },
        {
          id: "copy-path",
          label: t("sidebar.copyPath"),
          icon: <Copy size={15} />,
          onSelect: () => {
            romMenu.close();
            void copy(contextRom.romPath ?? contextRom.path);
          },
        },
        { id: "sep-2", separator: true },
        {
          id: "delete",
          label: t("emulators.games.deleteRom"),
          icon: <Trash2 size={15} />,
          danger: true,
          onSelect: () => {
            romMenu.close();
            setConfirmDeleteRom(contextRom);
          },
        },
      ]
    : [];

  return (
    <div className="emulators-page">
      <PageWidget page="emulators" widget="emuHeader">
        <div className="ui-item-emuHeader">
          <PageHeader
            eyebrow={t("emulators.eyebrow")}
            title={t("emulators.title")}
            description={t("emulators.subtitle")}
            actions={
              <div className="emu-header-actions">
                <Button variant="primary" onClick={openAdd} leftIcon={<Plus size={16} />}>
                  {t("emulators.addEmulator")}
                </Button>
                {kpis.systems > 0 && (
                  <Button
                    variant="secondary"
                    onClick={handleScanAll}
                    disabled={scanningId !== null}
                    leftIcon={<RefreshCw size={16} />}
                  >
                    {t("emulators.scanAll")}
                  </Button>
                )}
                <Button
                  ref={overflowRef}
                  variant="ghost"
                  iconOnly
                  title={t("emulators.actions.more")}
                  aria-label={t("emulators.actions.more")}
                  leftIcon={<MoreHorizontal size={16} />}
                  onClick={openOverflow}
                />
              </div>
            }
          />
        </div>
      </PageWidget>

      <PageWidget page="emulators" widget="emuStats">
        <div className="ui-item-emuStats">
          <EmulatorStatsHeader
            kpis={kpis}
            activeFilter={statusFilter}
            onFilterChange={setStatusFilter}
          />
        </div>
      </PageWidget>

      <PageWidget page="emulators" widget="emuBiosBoard">
        <div className="ui-item-emuBiosBoard">
          <EmulatorBiosBoard
            emulators={emulators}
            onCheck={handleCheckBios}
            onFix={openEdit}
          />
        </div>
      </PageWidget>

      <div className="emulators-split">
        {/* Left: your consoles */}
        <PageWidget page="emulators" widget="emuSidebar">
          <div className="ui-item-emuSidebar">
            <EmulatorSidebarList
              emulators={emulators}
              romCounts={romStats.counts}
              selectedId={selectedEmulator?.id ?? null}
              onSelect={setSelectedId}
              search={search}
              onSearchChange={setSearch}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              onAddEmulator={openAdd}
            />
          </div>
        </PageWidget>

        {/* Right: workspace */}
        <PageWidget page="emulators" widget="emuDetail">
          <section className="emulators-detail-pane ui-item-emuDetail">
            {!selectedEmulator || !selectedVisual ? (
              <div className="emulators-detail-empty">
                <span className="emulators-detail-empty-glyph">🕹️</span>
                <strong>{t("emulators.empty.title")}</strong>
                <p>{t("emulators.empty.desc")}</p>
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openAdd}>
                  {t("emulators.empty.cta")}
                </Button>
              </div>
            ) : (
              <div className="emulators-detail">
                <EmulatorDetailHero
                  emulator={selectedEmulator}
                  known={selectedVisual.known}
                  visual={selectedVisual}
                  romCount={selectedRomCount}
                  totalSizeBytes={selectedSizeBytes}
                  lastScanned={lastScanned[selectedEmulator.id]}
                  lastPlayed={selectedLastPlayed}
                  scanning={scanningId === selectedEmulator.id}
                  onLaunchExe={() => handleLaunchExe(selectedEmulator)}
                  onScan={() => handleScan(selectedEmulator)}
                  onEdit={() => openEdit(selectedEmulator)}
                  onDelete={() => setConfirmDelete(selectedEmulator)}
                  onOpenFolder={handleOpenFolder}
                  onCheckBios={() => handleCheckBios(selectedEmulator)}
                  onFindRomFolders={() => handleFindRomFolders(selectedEmulator)}
                  onOpenUrl={openUrl}
                  onFixSetup={handleFixSetup}
                />

                {(isEmulatorReady(selectedEmulator) || selectedGames.length > 0) && (
                  <EmulatorRomManager
                    emulator={selectedEmulator}
                    accentColor={selectedVisual.accent}
                    games={selectedGames}
                    runningGameIds={runningGameIds}
                    recalcId={recalcId}
                    scanning={scanningId === selectedEmulator.id}
                    onScan={() => handleScan(selectedEmulator)}
                    onAddRom={() => handleAddRom(selectedEmulator)}
                    onRecalcSizes={() => handleRecalcSizes(selectedEmulator)}
                    onLaunch={launchGame}
                    onOpenLocation={handleOpenLocation}
                    onRename={openRename}
                    onDelete={(g) => setConfirmDeleteRom(g)}
                    onInspect={(g) => setInspectRom(g)}
                    onDeleteRoms={handleDeleteRoms}
                    onRomContextMenu={(e, g) => romMenu.open(e, g)}
                  />
                )}
              </div>
            )}
          </section>
        </PageWidget>
      </div>

      {/* ROM context menu */}
      {contextRom && romMenu.state && (
        <ContextMenu
          x={romMenu.state.x}
          y={romMenu.state.y}
          items={romMenuItems}
          onClose={romMenu.close}
          ariaLabel={contextRom.name}
          header={
            <>
              <span className="context-menu-title" title={contextRom.name}>
                {contextRom.name}
              </span>
              {contextRom.romRegion && (
                <span className="ctx-badge">{contextRom.romRegion}</span>
              )}
            </>
          }
        />
      )}

      {/* Header overflow menu */}
      {overflowMenu && (
        <ContextMenu
          x={overflowMenu.x}
          y={overflowMenu.y}
          items={overflowItems}
          onClose={() => setOverflowMenu(null)}
          ariaLabel={t("emulators.actions.more")}
        />
      )}

      {/* Add / Discover surface */}
      {showAdd && (
        <EmulatorAddModal
          emulators={emulators}
          onClose={() => setShowAdd(false)}
          onAddDiscovered={handleAddDiscovered}
          onConfigureKnown={openAddKnown}
          onCustom={openCustom}
          onOpenDownload={openDownload}
        />
      )}

      {/* Editor modal */}
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

      {/* Download wizard modal */}
      {showDownload && (
        <DownloadEmulatorModal
          onClose={() => setShowDownload(false)}
          onInstalled={handleDownloadInstalled}
        />
      )}

      {/* Inspect ROM details modal */}
      {inspectRom && (
        <EmulatorRomDetailModal
          game={inspectRom}
          emulator={selectedEmulator ?? undefined}
          isRunning={runningGameIds.includes(inspectRom.id)}
          onClose={() => setInspectRom(null)}
          onLaunch={launchGame}
          onOpenLocation={handleOpenLocation}
          onRename={openRename}
          onDelete={(g) => setConfirmDeleteRom(g)}
          onGameUpdated={(updated) => {
            updateGame(updated.id, updated);
            setInspectRom(updated);
          }}
        />
      )}

      {/* Delete emulator confirmation */}
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

      {/* Rename ROM modal */}
      {renameGame &&
        createPortal(
          <div className="modal-overlay" onMouseDown={() => setRenameGame(null)}>
            <div
              className="modal emulators-modal"
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="modal-header">
                <h2>{t("emulators.games.renameTitle")}</h2>
                <Button variant="ghost" size="sm" iconOnly
                  
                  aria-label={t("common.close")}
                  onClick={() => setRenameGame(null)}
                 className="modal-close"> × </Button>
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
          </div>,
          document.body
        )}

      {/* Delete single ROM confirmation */}
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

      {/* BIOS check modal */}
      {biosResult &&
        createPortal(
          <div
            className="modal-overlay emulators-modal-overlay"
            onMouseDown={() => setBiosResult(null)}
          >
            <div
              className="modal emulators-modal emu-bios-modal"
              role="dialog"
              aria-modal="true"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div className="modal-header-text">
                  <h2>
                    {t("emulators.bios.title")} — {biosResult.platform}
                  </h2>
                  <p className="modal-subtitle">
                    {biosResult.configured
                      ? `${t("emulators.bios.configured")}: ${biosResult.biosFolder}`
                      : t("emulators.bios.notConfigured")}
                  </p>
                </div>
                <Button variant="ghost" size="sm" iconOnly
                  
                  aria-label={t("common.close")}
                  onClick={() => setBiosResult(null)}
                 className="modal-close"> × </Button>
              </div>
              <div className="modal-body emu-bios-body">
                {biosResult.requirements.length === 0 ? (
                  <p className="emu-panel-hint">{t("emulators.bios.noRequirements")}</p>
                ) : (
                  <>
                    <div className="emu-bios-summary">
                      {biosResult.missing.length === 0 ? (
                        <span className="emu-bios-ok">✓ {t("emulators.bios.ok")}</span>
                      ) : (
                        <span className="emu-bios-missing">
                          {t("emulators.bios.missing")}: {biosResult.missing.join(", ")}
                        </span>
                      )}
                    </div>
                    <div className="emu-bios-list">
                      {biosResult.requirements.map((req) => (
                        <div
                          key={req.name}
                          className={`emu-bios-entry${req.found ? " is-found" : " is-missing"}`}
                        >
                          <span className="emu-bios-state">{req.found ? "✓" : "✗"}</span>
                          <div className="emu-bios-entry-info">
                            <span className="emu-bios-name">{req.name}</span>
                            {req.description && (
                              <span className="emu-bios-sub">{req.description}</span>
                            )}
                            {req.hashOk === false && (
                              <span className="emu-bios-sub emu-bios-invalid">
                                {t("emulators.bios.invalid")}
                              </span>
                            )}
                          </div>
                          <span className="emu-bios-tag">
                            {req.found ? t("emulators.bios.found") : t("emulators.bios.missing")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <div className="modal-footer-actions">
                  <Button variant="ghost" onClick={() => setBiosResult(null)}>
                    {t("common.close")}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Discovered ROM-folder candidates */}
      {romFolderCandidates.length > 0 &&
        selectedEmulator &&
        createPortal(
          <div
            className="modal-overlay emulators-modal-overlay"
            onMouseDown={() => setRomFolderCandidates([])}
          >
            <div
              className="modal emulators-modal emu-folder-modal"
              role="dialog"
              aria-modal="true"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div className="modal-header-text">
                  <h2>{t("emulators.discovery.romFolders")}</h2>
                  <p className="modal-subtitle">{selectedEmulator.name}</p>
                </div>
                <Button variant="ghost" size="sm" iconOnly
                  
                  aria-label={t("common.close")}
                  onClick={() => setRomFolderCandidates([])}
                 className="modal-close"> × </Button>
              </div>
              <div className="modal-body emu-folder-body">
                {romFolderCandidates.length === 0 ? (
                  <p className="emu-panel-hint">{t("emulators.discovery.noFolders")}</p>
                ) : (
                  romFolderCandidates.map((f) => (
                    <div key={f} className="emu-discovery-entry">
                      <span className="emu-mono emu-discovery-path" title={f}>
                        {f}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleUseRomFolder(selectedEmulator, f)}
                      >
                        {t("emulators.discovery.useFolder")}
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <div className="modal-footer">
                <div className="modal-footer-actions">
                  <Button variant="ghost" onClick={() => setRomFolderCandidates([])}>
                    {t("common.close")}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

    </div>
  );
}
