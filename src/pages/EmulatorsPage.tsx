import { useCallback, useEffect, useMemo, useState } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { useGames } from "../context/GameContext";
import type { Game } from "../types/game";
import { accentForPlatform, KNOWN_EMULATORS, type Emulator, type KnownEmulator } from "../types/emulator";
import { formatBytesShort } from "../types/download";
import { PageHeader } from "../components/ui";
import "../styles/page-emulators.css";
import EmulatorEditorModal from "./EmulatorEditorModal";

function truncateMiddle(path: string, max = 48): string {
  if (path.length <= max) return path;
  const head = path.slice(0, max / 2 - 1);
  const tail = path.slice(path.length - (max / 2 - 1));
  return `${head}…${tail}`;
}

function formatDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Renders an emulator's real logo when available, otherwise falls back to
 *  the (emoji) glyph. */
function EmulatorGlyph({
  logo,
  glyph,
  className,
}: {
  logo?: string;
  glyph: string;
  className: string;
}) {
  if (logo) {
    return <img className={`${className}-img`} src={logo} alt="" draggable={false} />;
  }
  return <span className={className}>{glyph}</span>;
}

function renderRow(
  r: EmuRow,
  t: (key: string, vars?: Record<string, unknown>) => string,
  selectedRow: EmuRow | null,
  setSelectedId: (id: string) => void,
) {
  const active = selectedRow?.id === r.id;
  return (
    <button
      key={r.id}
      role="option"
      aria-selected={active}
      className={`emu-row${active ? " is-active" : ""}${r.added ? "" : " is-catalog"}`}
      style={{ ["--emu-accent" as string]: r.accent }}
      onClick={() => setSelectedId(r.id)}
    >
      <span className="emu-row-stripe" />
      <EmulatorGlyph logo={r.logo} glyph={r.glyph} className="emu-row-glyph" />
      <span className="emu-row-main">
        <span className="emu-row-name">{r.name}</span>
        <span className="emu-row-platform">{r.platform}</span>
      </span>
      <span className="emu-row-meta">
        <span className={`emu-badge ${r.added ? "is-added" : "is-notadded"}`}>
          {r.added
            ? t("emulators.status.added")
            : t("emulators.status.notAdded")}
        </span>
        {r.added && (
          <span
            className={`emu-badge ${
              r.configured ? "is-configured" : "is-notconfigured"
            }`}
          >
            {r.configured
              ? t("emulators.status.configured")
              : t("emulators.status.notConfigured")}
          </span>
        )}
        <span className="emu-row-count">
          {r.gameCount === 1
            ? t("emulators.romCountSingle", { count: r.gameCount })
            : t("emulators.romCount", { count: r.gameCount })}
        </span>
      </span>
    </button>
  );
}

type SortKey = "name" | "games" | "platform" | "dateAdded";
type SortDir = "asc" | "desc";

/** A flattened view-model row that unifies the curated catalog with the
 *  user's configured emulators, so the left list can show every known
 *  emulator (Added / Not added) alongside its live info. */
interface EmuRow {
  id: string;
  known?: KnownEmulator;
  emulator?: Emulator;
  name: string;
  platform: string;
  accent: string;
  glyph: string;
  logo?: string;
  added: boolean;
  /** True once an executable path has been configured. */
  configured: boolean;
  gameCount: number;
  createdAt?: number;
  scannedAt?: number;
}

/**
 * The Emulators tab, redesigned as a master / detail split:
 *  - Left: a searchable, sortable list of every known emulator with an
 *    Added / Not added + Configured status and live game counts.
 *  - Right: details for the selected emulator, including a launchable
 *    table of every ROM game detected/scanned for it.
 */
export default function EmulatorsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { games, addGame, updateGame, removeGames, launchGame, runningGameIds } = useGames();

  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Emulator | null>(null);
  const [presetKnown, setPresetKnown] = useState<KnownEmulator | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<Record<string, number>>({});
  const [confirmDelete, setConfirmDelete] = useState<Emulator | null>(null);
  const [renameGame, setRenameGame] = useState<Game | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteRom, setConfirmDeleteRom] = useState<Game | null>(null);
  const [recalcId, setRecalcId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<
    "all" | "added" | "notAdded" | "configured" | "notConfigured"
  >("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gameSearch, setGameSearch] = useState("");

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

  // ROM count per emulator, derived from the live library.
  const romCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of games) {
      if (g.emulatorId) m[g.emulatorId] = (m[g.emulatorId] ?? 0) + 1;
    }
    return m;
  }, [games]);

  // Merge the curated catalog with the configured emulators.
  const rows = useMemo<EmuRow[]>(() => {
    const result: EmuRow[] = [];
    const used = new Set<string>();

    for (const k of KNOWN_EMULATORS) {
      const emu =
        emulators.find((e) => e.platform === k.platform) ??
        emulators.find((e) => e.name === k.name);
      if (emu) used.add(emu.id);
      result.push({
        id: emu ? emu.id : `known:${k.key}`,
        known: k,
        emulator: emu,
        name: emu?.name ?? k.name,
        platform: k.platform,
        accent: k.accent,
        glyph: k.glyph,
        logo: k.logo,
        added: !!emu,
        configured: !!emu?.executablePath,
        gameCount: emu ? (romCounts[emu.id] ?? 0) : 0,
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
        added: true,
        configured: !!e.executablePath,
        gameCount: romCounts[e.id] ?? 0,
        createdAt: e.createdAt,
        scannedAt: lastScanned[e.id],
      });
    }

    return result;
  }, [emulators, romCounts, lastScanned]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.platform.toLowerCase().includes(q))
        return false;
      switch (filter) {
        case "added":
          return r.added;
        case "notAdded":
          return !r.added;
        case "configured":
          return r.configured;
        case "notConfigured":
          return r.added && !r.configured;
        default:
          return true;
      }
    });

    const sorted = [...base].sort((a, b) => {
      let res = 0;
      switch (sortKey) {
        case "games":
          res = a.gameCount - b.gameCount;
          break;
        case "platform":
          res = a.platform.localeCompare(b.platform);
          break;
        case "dateAdded":
          res = (a.createdAt ?? 0) - (b.createdAt ?? 0);
          break;
        case "name":
        default:
          res = a.name.localeCompare(b.name);
          break;
      }
      return sortDir === "desc" ? -res : res;
    });
    return sorted;
  }, [rows, search, sortKey, sortDir, filter]);

  // Summary stats for the header strip.
  const stats = useMemo(() => {
    const totalRoms = rows.reduce((sum, r) => sum + r.gameCount, 0);
    return {
      catalog: rows.length,
      added: rows.filter((r) => r.added).length,
      configured: rows.filter((r) => r.configured).length,
      roms: totalRoms,
    };
  }, [rows]);

  // Split the visible rows into two navigable groups.
  const groups = useMemo(() => {
    const added = filteredRows.filter((r) => r.added);
    const catalog = filteredRows.filter((r) => !r.added);
    return { added, catalog };
  }, [filteredRows]);

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
    const q = gameSearch.trim().toLowerCase();
    return games
      .filter((g) => g.emulatorId === selectedRow.emulator!.id)
      .filter((g) => (q ? g.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [games, selectedRow, gameSearch]);

  const selectedTotalBytes = useMemo(
    () => selectedGames.reduce((sum, g) => sum + (g.sizeBytes ?? 0), 0),
    [selectedGames],
  );

  const addedCount = useMemo(() => rows.filter((r) => r.added).length, [rows]);

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
      showToast(t("emulators.games.rename") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }, [renameGame, renameValue, addGame, removeGames, showToast, t]);

  const handleDeleteRom = useCallback(async () => {
    if (!confirmDeleteRom) return;
    try {
      await invoke("delete_rom_file", { gameId: confirmDeleteRom.id });
      removeGames((g) => g.id === confirmDeleteRom.id);
      setConfirmDeleteRom(null);
      showToast(t("emulators.games.deleteRom") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }, [confirmDeleteRom, removeGames, showToast, t]);

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

  const toggleSortDir = useCallback(() => {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }, []);

  // Arrow-key navigation across the visible (filtered) list.
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const ids = filteredRows.map((r) => r.id);
      if (ids.length === 0) return;
      const current = selectedRow?.id ?? ids[0];
      const idx = ids.indexOf(current);
      const next =
        e.key === "ArrowDown"
          ? Math.min(ids.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      if (next !== idx) {
        e.preventDefault();
        setSelectedId(ids[next]);
      }
    },
    [filteredRows, selectedRow],
  );

  const sortLabel: Record<SortKey, string> = {
    name: t("emulators.sort.name"),
    games: t("emulators.sort.games"),
    platform: t("emulators.sort.platform"),
    dateAdded: t("emulators.sort.dateAdded"),
  };

  return (
    <div className="emulators-page">
      <PageHeader
        eyebrow={t("emulators.eyebrow")}
        title={t("emulators.title")}
        description={t("emulators.subtitle")}
        actions={
          <>
            <button className="btn-primary" onClick={openAdd}>
              + {t("emulators.addEmulator")}
            </button>
            {addedCount > 0 && (
              <button
                className="btn-secondary"
                onClick={handleScanAll}
                disabled={scanningId !== null}
              >
                {t("emulators.scanAll")}
              </button>
            )}
          </>
        }
      />

      {!loading && (
        <div className="emulators-stats">
          <div className="emu-stat">
            <span className="emu-stat-value">{stats.catalog}</span>
            <span className="emu-stat-label">{t("emulators.stats.catalog")}</span>
          </div>
          <div className="emu-stat">
            <span className="emu-stat-value">{stats.added}</span>
            <span className="emu-stat-label">{t("emulators.stats.added")}</span>
          </div>
          <div className="emu-stat">
            <span className="emu-stat-value">{stats.configured}</span>
            <span className="emu-stat-label">{t("emulators.stats.configured")}</span>
          </div>
          <div className="emu-stat">
            <span className="emu-stat-value">{stats.roms}</span>
            <span className="emu-stat-label">{t("emulators.stats.roms")}</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="emulators-empty">
          <p>{t("common.loading")}</p>
        </div>
      ) : (
        <div className="emulators-split">
          {/* ── Left: emulator list ── */}
          <aside className="emulators-list-pane">
            <div className="emulators-list-controls">
              <input
                className="emulators-search"
                type="text"
                placeholder={t("emulators.list.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="emulators-sort">
                <label className="emulators-sort-label" htmlFor="emu-sort">
                  {t("emulators.sortBy")}
                </label>
                <select
                  id="emu-sort"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                >
                  {(Object.keys(sortLabel) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {sortLabel[k]}
                    </option>
                  ))}
                </select>
                <button
                  className="emulators-sort-dir"
                  onClick={toggleSortDir}
                  title={sortDir === "asc" ? "↑" : "↓"}
                  aria-label={sortDir === "asc" ? "Ascending" : "Descending"}
                >
                  {sortDir === "asc" ? "↑" : "↓"}
                </button>
              </div>
            </div>

            <div className="emulators-filters">
              {(
                [
                  ["all", t("emulators.filter.all")],
                  ["added", t("emulators.filter.added")],
                  ["notAdded", t("emulators.filter.notAdded")],
                  ["configured", t("emulators.filter.configured")],
                  ["notConfigured", t("emulators.filter.notConfigured")],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`emu-filter-chip${filter === key ? " is-active" : ""}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="emulators-list-count">
              {t("emulators.list.count", { added: addedCount, total: rows.length })}
            </div>

            <div
              className="emulators-list"
              role="listbox"
              tabIndex={0}
              onKeyDown={handleListKeyDown}
            >
              {filteredRows.length === 0 ? (
                <div className="emulators-list-empty">{t("emulators.list.empty")}</div>
              ) : (
                <>
                  {groups.added.length > 0 && (
                    <div className="emu-group">
                      <div className="emu-group-header">
                        <span>{t("emulators.group.added")}</span>
                        <span className="emu-group-count">{groups.added.length}</span>
                      </div>
                      {groups.added.map((r) => renderRow(r, t, selectedRow, setSelectedId))}
                    </div>
                  )}
                  {groups.catalog.length > 0 && (
                    <div className="emu-group">
                      <div className="emu-group-header">
                        <span>{t("emulators.group.catalog")}</span>
                        <span className="emu-group-count">{groups.catalog.length}</span>
                      </div>
                      {groups.catalog.map((r) =>
                        renderRow(r, t, selectedRow, setSelectedId),
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* ── Right: detail / games ── */}
          <section className="emulators-detail-pane">
            {!selectedRow ? (
              <div className="emulators-detail-empty">
                {t("emulators.detail.emptySelection")}
              </div>
            ) : !selectedRow.added ? (
              <div className="emulators-detail">
                <div
                  className="emu-detail-head emu-detail-banner"
                  style={{ ["--emu-accent" as string]: selectedRow.accent }}
                >
                  <EmulatorGlyph logo={selectedRow.logo} glyph={selectedRow.glyph} className="emu-detail-glyph" />
                  <div className="emu-detail-titles">
                    <h2 className="emu-detail-name">{selectedRow.name}</h2>
                    <span className="emu-detail-platform">{selectedRow.platform}</span>
                  </div>
                  <span className="emu-badge is-notadded">
                    {t("emulators.status.notAdded")}
                  </span>
                </div>
                {selectedRow.known && (
                  <p className="emu-detail-desc">{selectedRow.known.description}</p>
                )}
                {selectedRow.known?.githubUrl && (
                  <button
                    className="btn-ghost btn-sm emu-detail-github"
                    onClick={() => openUrl(selectedRow.known!.githubUrl!)}
                  >
                    <span className="emu-detail-github-icon" aria-hidden>★</span>
                    {t("emulators.github")}
                  </button>
                )}
                <div className="emulators-notadded">
                  <h3>{t("emulators.detail.addTitle")}</h3>
                  <p>{t("emulators.detail.addDesc")}</p>
                  <button
                    className="btn-primary"
                    onClick={() => openAddKnown(selectedRow.known!)}
                  >
                    + {t("emulators.detail.addCta", { name: selectedRow.name })}
                  </button>
                </div>
              </div>
            ) : (
              <div className="emulators-detail">
                <div
                  className="emu-detail-head emu-detail-banner"
                  style={{ ["--emu-accent" as string]: selectedRow.accent }}
                >
                  <EmulatorGlyph logo={selectedRow.logo} glyph={selectedRow.glyph} className="emu-detail-glyph" />
                  <div className="emu-detail-titles">
                    <h2 className="emu-detail-name">{selectedRow.name}</h2>
                    <span className="emu-detail-platform">{selectedRow.platform}</span>
                  </div>
                  <span
                    className={`emu-badge ${
                      selectedRow.configured ? "is-configured" : "is-notconfigured"
                    }`}
                  >
                    {selectedRow.configured
                      ? t("emulators.status.configured")
                      : t("emulators.status.notConfigured")}
                  </span>
                </div>

                <div className="emu-detail-meta">
                  <div className="emu-detail-meta-row">
                    <span className="emu-detail-meta-label">
                      {t("emulators.detail.executable")}
                    </span>
                    <span
                      className="emu-detail-meta-value"
                      title={selectedRow.emulator?.executablePath}
                    >
                      {selectedRow.emulator?.executablePath
                        ? truncateMiddle(selectedRow.emulator.executablePath)
                        : "—"}
                    </span>
                  </div>
                  <div className="emu-detail-meta-row">
                    <span className="emu-detail-meta-label">
                      {t("emulators.detail.romFolder")}
                    </span>
                    <span
                      className="emu-detail-meta-value"
                      title={selectedRow.emulator?.romFolder}
                    >
                      {selectedRow.emulator?.romFolder
                        ? truncateMiddle(selectedRow.emulator.romFolder)
                        : "—"}
                    </span>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() =>
                        selectedRow.emulator && handleOpenFolder(selectedRow.emulator.romFolder)
                      }
                      disabled={!selectedRow.emulator?.romFolder}
                    >
                      {t("emulators.openFolder")}
                    </button>
                  </div>
                  <div className="emu-detail-meta-row">
                    <span className="emu-detail-meta-label">
                      {t("emulators.detail.lastScanned")}
                    </span>
                    <span className="emu-detail-meta-value">
                      {selectedRow.scannedAt
                        ? formatDate(selectedRow.scannedAt)
                        : t("emulators.neverScanned")}
                    </span>
                  </div>
                </div>

                <div className="emu-detail-actions">
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => selectedRow.emulator && handleScan(selectedRow.emulator)}
                    disabled={scanningId === selectedRow.id}
                  >
                    {scanningId === selectedRow.id
                      ? t("emulators.scanning")
                      : t("emulators.scan")}
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => openEdit(selectedRow.emulator!)}
                  >
                    {t("emulators.edit")}
                  </button>
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => setConfirmDelete(selectedRow.emulator!)}
                  >
                    {t("emulators.delete")}
                  </button>
                  {selectedRow.known?.githubUrl && (
                    <button
                      className="btn-ghost btn-sm emu-detail-github"
                      onClick={() => openUrl(selectedRow.known!.githubUrl!)}
                    >
                      <span className="emu-detail-github-icon" aria-hidden>★</span>
                      {t("emulators.github")}
                    </button>
                  )}
                </div>

                <div className="emu-games">
                  <div className="emu-games-head">
                    <h3 className="emu-games-title">
                      {t("emulators.detail.gamesTitle")}
                      <span className="emu-games-count">
                        {t("emulators.detail.gamesCount", { count: selectedRow.gameCount })}
                      </span>
                    </h3>
                    {selectedGames.length > 0 && (
                      <input
                        className="emulators-search emu-games-search"
                        type="text"
                        placeholder={t("emulators.games.search")}
                        value={gameSearch}
                        onChange={(e) => setGameSearch(e.target.value)}
                      />
                    )}
                    {selectedRow.emulator && (
                      <div className="emu-games-actions">
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => handleAddRom(selectedRow.emulator!)}
                        >
                          + {t("emulators.games.addRom")}
                        </button>
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => handleRecalcSizes(selectedRow.emulator!)}
                          disabled={recalcId === selectedRow.emulator.id}
                        >
                          {recalcId === selectedRow.emulator.id
                            ? "…"
                            : t("emulators.games.recalc")}
                        </button>
                      </div>
                    )}
                  </div>

                  {selectedGames.length === 0 ? (
                    <div className="emu-games-empty">
                      <p>{t("emulators.detail.emptyGames")}</p>
                      <p className="emu-games-empty-hint">
                        {t("emulators.detail.emptyGamesHint")}
                      </p>
                    </div>
                  ) : (
                    <div className="emu-games-table">
                      <div className="emu-game-row emu-game-row-head">
                        <span className="emu-game-icon" />
                        <span className="emu-game-main">
                          {t("emulators.name")}
                        </span>
                        <span className="emu-game-size">{t("emulators.games.size")}</span>
                        <span className="emu-game-actions" />
                        <span className="emu-game-launch" />
                      </div>
                      {selectedGames.map((g) => {
                        const running = runningGameIds.includes(g.id);
                        return (
                          <div className="emu-game-row" key={g.id}>
                            <span className="emu-game-icon">
                              {g.iconUrl || g.coverArtUrl ? (
                                <img src={g.iconUrl ?? g.coverArtUrl} alt="" />
                              ) : (
                                <span className="emu-game-icon-fallback">🎮</span>
                              )}
                            </span>
                            <span className="emu-game-main">
                              <span className="emu-game-name" title={g.name}>
                                {g.name}
                              </span>
                              <span className="emu-game-path" title={g.romPath}>
                                {g.romPath ? truncateMiddle(g.romPath, 60) : t("emulators.games.noRomPath")}
                              </span>
                            </span>
                            <span className="emu-game-size">
                              {g.sizeBytes ? formatBytesShort(g.sizeBytes) : "—"}
                            </span>
                            <span className="emu-game-actions">
                              <button
                                className="btn-ghost btn-sm"
                                title={t("emulators.games.openLocation")}
                                onClick={() => g.romPath && handleOpenLocation(g.romPath)}
                                disabled={!g.romPath}
                              >
                                {t("emulators.games.openLocation")}
                              </button>
                              <button
                                className="btn-ghost btn-sm"
                                onClick={() => openRename(g)}
                              >
                                {t("emulators.games.rename")}
                              </button>
                              <button
                                className="btn-danger btn-sm"
                                onClick={() => setConfirmDeleteRom(g)}
                              >
                                {t("emulators.games.deleteRom")}
                              </button>
                            </span>
                            <button
                              className="btn-primary btn-sm emu-game-launch"
                              onClick={() => launchGame(g)}
                              disabled={running}
                            >
                              {running ? "…" : t("emulators.games.launch")}
                            </button>
                          </div>
                        );
                      })}
                      <div className="emu-games-footer">
                        <span className="emu-games-footer-count">
                          {t("emulators.detail.gamesCount", {
                            count: selectedGames.length,
                          })}
                        </span>
                        <span className="emu-games-footer-size">
                          {t("emulators.detail.totalSize")}:{" "}
                          {formatBytesShort(selectedTotalBytes)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

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

      {confirmDelete && (
        <div className="modal-overlay" onMouseDown={() => setConfirmDelete(null)}>
          <div className="modal confirm-modal" onMouseDown={(e) => e.stopPropagation()} role="alertdialog">
            <div className="modal-header">
              <h2>{t("emulators.delete")}?</h2>
            </div>
            <div className="modal-body">
              <p>
                {romCounts[confirmDelete.id]
                  ? t("emulators.confirmDelete", {
                      name: confirmDelete.name,
                      count: romCounts[confirmDelete.id],
                    })
                  : t("emulators.confirmDeleteNoGames", { name: confirmDelete.name })}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn-danger" onClick={() => handleDelete(confirmDelete)}>
                {t("emulators.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameGame && (
        <div className="modal-overlay" onMouseDown={() => setRenameGame(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <h2>{t("emulators.games.renameTitle")}</h2>
            </div>
            <div className="modal-body">
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
              <button className="btn-ghost" onClick={() => setRenameGame(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={handleRenameRom}>
                {t("emulators.games.rename")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteRom && (
        <div className="modal-overlay" onMouseDown={() => setConfirmDeleteRom(null)}>
          <div className="modal confirm-modal" onMouseDown={(e) => e.stopPropagation()} role="alertdialog">
            <div className="modal-header">
              <h2>{t("emulators.games.deleteRom")}?</h2>
            </div>
            <div className="modal-body">
              <p>
                {t("emulators.games.deleteConfirm", { name: confirmDeleteRom.name })}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setConfirmDeleteRom(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn-danger" onClick={handleDeleteRom}>
                {t("emulators.games.deleteRom")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
