import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { useGames } from "../context/GameContext";
import type { Game } from "../types/game";
import { accentForPlatform, KNOWN_EMULATORS, type Emulator, type KnownEmulator } from "../types/emulator";
import { formatBytesShort } from "../types/download";
import { Button, ConfirmModal, PageHeader, Tooltip } from "../components/ui";
import "../styles/page-emulators.css";
import EmulatorEditorModal from "./EmulatorEditorModal";
import DownloadEmulatorModal from "../components/emulators/DownloadEmulatorModal";

/* ── Icon primitives ────────────────────────────────────────────────
 * Small stroke icons shared across the page. Sized by context via
 * `.emu-stat-icon svg`, `.emulators-search-icon`, `.emu-icon-btn svg`
 * etc.; all inherit `currentColor` so they tint with the surrounding
 * status (accent pills, danger buttons, …). */

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type IconProps = { className?: string };

const IconSearch = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconX = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconLayers = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);
const IconCheckSquare = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);
const IconSliders = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);
const IconGamepad = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <line x1="6" y1="11" x2="10" y2="11" />
    <line x1="8" y1="9" x2="8" y2="13" />
    <line x1="15" y1="12" x2="15.01" y2="12" />
    <line x1="18" y1="10" x2="18.01" y2="10" />
    <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
  </svg>
);
const IconPlay = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);
const IconScan = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
const IconRecalc = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);
const IconPencil = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);
const IconTrash = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);
const IconFolder = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
const IconExternal = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);
const IconPlus = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconDownload = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconChevronUp = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <polyline points="18 15 12 9 6 15" />
  </svg>
);
const IconChevronDown = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const IconPackage = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const IconClock = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);
const IconTerminal = ({ className }: IconProps) => (
  <svg className={className} {...ICON}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

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

/** Human-friendly relative time for "last scanned", e.g. "5m ago". */
function relativeTime(
  ts: number,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  if (diff < min) return t("emulators.relative.justNow");
  if (diff < hr) return t("emulators.relative.minutes", { n: Math.floor(diff / min) });
  if (diff < day) return t("emulators.relative.hours", { n: Math.floor(diff / hr) });
  if (diff < 30 * day) return t("emulators.relative.days", { n: Math.floor(diff / day) });
  return formatDate(ts);
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

function renderRow(
  r: EmuRow,
  t: (key: string, vars?: Record<string, unknown>) => string,
  selectedRow: EmuRow | null,
  setSelectedId: (id: string) => void,
) {
  const active = selectedRow?.id === r.id;
  const statusPill = r.added ? (
    <span className={`emu-status-pill ${r.configured ? "is-configured" : "is-unconfigured"}`}>
      {r.configured
        ? t("emulators.status.configured")
        : t("emulators.status.notConfigured")}
    </span>
  ) : (
    <span className="emu-status-pill is-catalog">{t("emulators.status.notAdded")}</span>
  );
  return (
    <button
      key={r.id}
      role="option"
      aria-selected={active}
      className={`emu-row${active ? " is-active" : ""}${r.added ? "" : " is-catalog"}`}
      style={{ ["--emu-accent" as string]: r.accent }}
      onClick={() => setSelectedId(r.id)}
    >
      <EmulatorGlyph logo={r.logo} glyph={r.glyph} className="emu-row-glyph" />
      <span className="emu-row-main">
        <span className="emu-row-name">{r.name}</span>
        <span className="emu-row-platform">{r.platform}</span>
      </span>
      <span className="emu-row-meta">
        <span className="emu-row-count">
          {r.gameCount === 1
            ? t("emulators.romCountSingle", { count: r.gameCount })
            : t("emulators.romCount", { count: r.gameCount })}
        </span>
        {statusPill}
      </span>
    </button>
  );
}

type SortKey = "name" | "games" | "platform" | "dateAdded";
type SortDir = "asc" | "desc";
type EmuFilter = "all" | "added" | "notAdded" | "configured" | "notConfigured";

/**
 * The Emulators tab — a master / detail split:
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
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<EmuFilter>("all");
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
      // Match by unique catalog name first, then fall back to platform.
      // Name-first avoids collapsing same-platform catalog entries (e.g.
      // Demul / Flycast / Redream all share "Sega Dreamcast") into one
      // false "Added" row.
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
        logo: e.iconUrl,
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

  // Clear ROM selection when switching to a different emulator.
  useEffect(() => {
    setSelectedGameIds(new Set());
  }, [selectedRow?.emulator?.id]);

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

  const toggleGameSelected = useCallback((id: string) => {
    setSelectedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedGameIds((prev) =>
      prev.size === selectedGames.length && selectedGames.length > 0
        ? new Set()
        : new Set(selectedGames.map((g) => g.id)),
    );
  }, [selectedGames]);

  const handleBulkOpen = useCallback(() => {
    for (const g of selectedGames) {
      if (selectedGameIds.has(g.id) && g.romPath) handleOpenLocation(g.romPath);
    }
  }, [selectedGames, selectedGameIds, handleOpenLocation]);

  const handleBulkLaunch = useCallback(() => {
    for (const g of selectedGames) {
      if (selectedGameIds.has(g.id)) launchGame(g);
    }
  }, [selectedGames, selectedGameIds, launchGame]);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedGameIds];
    for (const id of ids) {
      try {
        await invoke("delete_rom_file", { gameId: id });
      } catch (err) {
        showToast(String(err), "error");
      }
    }
    removeGames((g) => selectedGameIds.has(g.id));
    setSelectedGameIds(new Set());
    setConfirmBulkDelete(false);
  }, [selectedGameIds, removeGames, showToast]);

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
      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key !== "Home" &&
        e.key !== "End"
      )
        return;
      const ids = filteredRows.map((r) => r.id);
      if (ids.length === 0) return;
      const current = selectedRow?.id ?? ids[0];
      const idx = ids.indexOf(current);
      let next = idx;
      if (e.key === "ArrowDown") next = Math.min(ids.length - 1, idx + 1);
      else if (e.key === "ArrowUp") next = Math.max(0, idx - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = ids.length - 1;
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

  const statItems: {
    key: string;
    icon: ReactNode;
    value: number;
    label: string;
    filter: EmuFilter | null;
    tone: string;
  }[] = [
    {
      key: "catalog",
      icon: <IconLayers />,
      value: stats.catalog,
      label: t("emulators.stats.catalog"),
      filter: null,
      tone: "emu-stat--neutral",
    },
    {
      key: "added",
      icon: <IconCheckSquare />,
      value: stats.added,
      label: t("emulators.stats.added"),
      filter: "added",
      tone: "emu-stat--accent",
    },
    {
      key: "configured",
      icon: <IconSliders />,
      value: stats.configured,
      label: t("emulators.stats.configured"),
      filter: "configured",
      tone: "emu-stat--success",
    },
    {
      key: "roms",
      icon: <IconGamepad />,
      value: stats.roms,
      label: t("emulators.stats.roms"),
      filter: null,
      tone: "emu-stat--info",
    },
  ];

  return (
    <div className="emulators-page">
      <PageHeader
        eyebrow={t("emulators.eyebrow")}
        title={t("emulators.title")}
        description={t("emulators.subtitle")}
        actions={
          <>
            <Button variant="primary" onClick={openAdd} leftIcon={<IconPlus />}>
              {t("emulators.addEmulator")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowDownload(true)}
              leftIcon={<IconDownload />}
            >
              {t("emulators.download.title")}
            </Button>
            {addedCount > 0 && (
              <Button
                variant="secondary"
                onClick={handleScanAll}
                disabled={scanningId !== null}
                leftIcon={<IconScan />}
              >
                {t("emulators.scanAll")}
              </Button>
            )}
          </>
        }
      />

      {!loading && (
        <div className="emulators-stats">
          {statItems.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`emu-stat${s.filter ? " is-clickable" : ""}${
                s.filter && filter === s.filter ? " is-active" : ""
              } ${s.tone}`}
              onClick={() => s.filter && setFilter(s.filter as EmuFilter)}
              disabled={!s.filter}
              title={s.filter ? t("emulators.stats.clickToFilter") : undefined}
            >
              <span className="emu-stat-icon">{s.icon}</span>
              <span className="emu-stat-body">
                <span className="emu-stat-value">{s.value}</span>
                <span className="emu-stat-label">{s.label}</span>
              </span>
            </button>
          ))}
        </div>
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
          {/* ── Left: emulator library list ── */}
          <aside className="emulators-list-pane">
            <div className="emulators-list-pane-header">
              <span className="emulators-list-pane-title">
                {t("emulators.list.title")}
              </span>
              <span className="emulators-list-pane-count">{rows.length}</span>
            </div>

            <div className="emulators-search-wrap">
              <IconSearch className="emulators-search-icon" />
              <input
                className="emulators-search"
                type="text"
                placeholder={t("emulators.list.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="emulators-search-clear"
                  type="button"
                  aria-label={t("emulators.list.clearSearch")}
                  onClick={() => setSearch("")}
                >
                  <IconX />
                </button>
              )}
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

            <div className="emulators-sort">
              <label className="emulators-sort-label" htmlFor="emu-sort">
                {t("emulators.sortBy")}
              </label>
              <select
                id="emu-sort"
                className="emulators-sort-select"
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
                title={
                  sortDir === "asc"
                    ? t("emulators.sort.ascending")
                    : t("emulators.sort.descending")
                }
                aria-label={
                  sortDir === "asc"
                    ? t("emulators.sort.ascending")
                    : t("emulators.sort.descending")
                }
              >
                {sortDir === "asc" ? <IconChevronUp /> : <IconChevronDown />}
              </button>
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
                <div className="emulators-list-empty">
                  <span className="emulators-list-empty-glyph">🕹️</span>
                  <span>{t("emulators.list.empty")}</span>
                </div>
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
                <span className="emulators-detail-empty-glyph">🕹️</span>
                <p>{t("emulators.detail.emptySelection")}</p>
              </div>
            ) : !selectedRow.added ? (
              <div className="emulators-detail">
                <header
                  className="emu-detail-banner"
                  style={{ ["--emu-accent" as string]: selectedRow.accent }}
                >
                  <EmulatorGlyph
                    logo={selectedRow.logo}
                    glyph={selectedRow.glyph}
                    className="emu-detail-glyph"
                  />
                  <div className="emu-detail-titles">
                    <h2 className="emu-detail-name">{selectedRow.name}</h2>
                    <span className="emu-detail-platform">{selectedRow.platform}</span>
                  </div>
                  <span className="emu-status-pill emu-status-pill--lg is-catalog">
                    {t("emulators.status.notAdded")}
                  </span>
                </header>

                <div className="emu-detail-body">
                  {selectedRow.known && (
                    <p className="emu-detail-desc">{selectedRow.known.description}</p>
                  )}

                  <div className="emulators-notadded">
                    <EmulatorGlyph
                      logo={selectedRow.logo}
                      glyph={selectedRow.glyph}
                      className="emulators-notadded-glyph"
                    />
                    <h3>{t("emulators.detail.addTitle")}</h3>
                    <p>{t("emulators.detail.addDesc")}</p>
                    <div className="emulators-notadded-actions">
                      {selectedRow.known?.githubUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<IconExternal />}
                          onClick={() => openUrl(selectedRow.known!.githubUrl!)}
                        >
                          {t("emulators.github")}
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        leftIcon={<IconPlus />}
                        onClick={() => selectedRow.known && openAddKnown(selectedRow.known)}
                      >
                        {t("emulators.detail.addCta", { name: selectedRow.name })}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="emulators-detail">
                <header
                  className="emu-detail-banner"
                  style={{ ["--emu-accent" as string]: selectedRow.accent }}
                >
                  <EmulatorGlyph
                    logo={selectedRow.logo}
                    glyph={selectedRow.glyph}
                    className="emu-detail-glyph"
                  />
                  <div className="emu-detail-titles">
                    <h2 className="emu-detail-name">{selectedRow.name}</h2>
                    <span className="emu-detail-platform">{selectedRow.platform}</span>
                  </div>
                  <span
                    className={`emu-status-pill emu-status-pill--lg ${
                      selectedRow.configured ? "is-configured" : "is-unconfigured"
                    }`}
                  >
                    {selectedRow.configured
                      ? t("emulators.status.configured")
                      : t("emulators.status.notConfigured")}
                  </span>
                </header>

                <div className="emu-detail-body">
                  {selectedRow.known && (
                    <p className="emu-detail-desc">{selectedRow.known.description}</p>
                  )}

                  <div className="emu-detail-meta-grid">
                    <div className="emu-detail-meta-tile">
                      <span className="emu-detail-meta-label">
                        <IconPackage /> {t("emulators.detail.executable")}
                      </span>
                      <span
                        className="emu-detail-meta-value emu-mono"
                        title={selectedRow.emulator?.executablePath}
                      >
                        {selectedRow.emulator?.executablePath
                          ? truncateMiddle(selectedRow.emulator.executablePath)
                          : "—"}
                      </span>
                    </div>
                    <div className="emu-detail-meta-tile">
                      <span className="emu-detail-meta-label">
                        <IconFolder /> {t("emulators.detail.romFolder")}
                      </span>
                      <span
                        className="emu-detail-meta-value"
                        title={selectedRow.emulator?.romFolder}
                      >
                        {selectedRow.emulator?.romFolder
                          ? truncateMiddle(selectedRow.emulator.romFolder)
                          : "—"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<IconFolder />}
                        onClick={() =>
                          selectedRow.emulator &&
                          handleOpenFolder(selectedRow.emulator.romFolder)
                        }
                        disabled={!selectedRow.emulator?.romFolder}
                      >
                        {t("emulators.openFolder")}
                      </Button>
                    </div>
                    <div className="emu-detail-meta-tile">
                      <span className="emu-detail-meta-label">
                        <IconClock /> {t("emulators.detail.lastScanned")}
                      </span>
                      <span className="emu-detail-meta-value">
                        {selectedRow.scannedAt
                          ? relativeTime(selectedRow.scannedAt, t)
                          : t("emulators.neverScanned")}
                      </span>
                    </div>
                    <div className="emu-detail-meta-tile">
                      <span className="emu-detail-meta-label">
                        <IconTerminal /> {t("emulators.argumentsTemplate")}
                      </span>
                      <span className="emu-detail-meta-value emu-mono">
                        {selectedRow.emulator?.argumentsTemplate
                          ? selectedRow.emulator.argumentsTemplate
                          : "—"}
                      </span>
                    </div>
                  </div>

                  {selectedRow.emulator?.notes && (
                    <p className="emu-detail-notes">
                      {selectedRow.emulator.notes}
                    </p>
                  )}

                  <div className="emu-detail-actions">
                    {selectedRow.configured ? (
                      <Button
                        variant="primary"
                        leftIcon={<IconPlay />}
                        onClick={() =>
                          selectedRow.emulator && handleLaunchExe(selectedRow.emulator)
                        }
                      >
                        {t("emulators.launchExe")}
                      </Button>
                    ) : (
                      <Tooltip content={t("emulators.launcherNotSet")} placement="bottom">
                        <Button
                          variant="primary"
                          leftIcon={<IconPlay />}
                          disabled
                          onClick={() =>
                            selectedRow.emulator && handleLaunchExe(selectedRow.emulator)
                          }
                        >
                          {t("emulators.launchExe")}
                        </Button>
                      </Tooltip>
                    )}
                    <Button
                      variant="secondary"
                      leftIcon={<IconScan />}
                      isLoading={scanningId === selectedRow.id}
                      onClick={() => selectedRow.emulator && handleScan(selectedRow.emulator)}
                    >
                      {scanningId === selectedRow.id
                        ? t("emulators.scanning")
                        : t("emulators.scan")}
                    </Button>
                    <Button
                      variant="ghost"
                      leftIcon={<IconPencil />}
                      onClick={() => openEdit(selectedRow.emulator!)}
                    >
                      {t("emulators.edit")}
                    </Button>
                    {selectedRow.known?.githubUrl && (
                      <Button
                        variant="ghost"
                        leftIcon={<IconExternal />}
                        onClick={() => openUrl(selectedRow.known!.githubUrl!)}
                      >
                        {t("emulators.github")}
                      </Button>
                    )}
                    <span className="emu-detail-actions-spacer" />
                    <Button
                      variant="danger"
                      leftIcon={<IconTrash />}
                      onClick={() => setConfirmDelete(selectedRow.emulator!)}
                    >
                      {t("emulators.delete")}
                    </Button>
                  </div>

                  <div className="emu-games">
                    <div className="emu-games-head">
                      <h3 className="emu-games-title">
                        {t("emulators.detail.gamesTitle")}
                        <span className="emu-games-count">
                          {t("emulators.detail.gamesCount", { count: selectedRow.gameCount })}
                        </span>
                      </h3>
                      <div className="emu-games-tools">
                        {selectedRow.gameCount > 0 && (
                          <div className="emulators-search-wrap emu-games-search">
                            <IconSearch className="emulators-search-icon" />
                            <input
                              className="emulators-search"
                              type="text"
                              placeholder={t("emulators.games.search")}
                              value={gameSearch}
                              onChange={(e) => setGameSearch(e.target.value)}
                            />
                            {gameSearch && (
                              <button
                                className="emulators-search-clear"
                                type="button"
                                aria-label={t("emulators.list.clearSearch")}
                                onClick={() => setGameSearch("")}
                              >
                                <IconX />
                              </button>
                            )}
                          </div>
                        )}
                        {selectedRow.emulator && (
                          <div className="emu-games-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<IconPlus />}
                              onClick={() => handleAddRom(selectedRow.emulator!)}
                            >
                              {t("emulators.games.addRom")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<IconRecalc />}
                              onClick={() => handleRecalcSizes(selectedRow.emulator!)}
                              isLoading={recalcId === selectedRow.emulator.id}
                            >
                              {t("emulators.games.recalc")}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedGameIds.size > 0 && (
                      <div className="emu-games-bulkbar">
                        <span className="emu-games-bulkcount">
                          {t("emulators.games.selected", { count: selectedGameIds.size })}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<IconPlay />}
                          onClick={handleBulkLaunch}
                        >
                          {t("emulators.games.launch")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<IconFolder />}
                          onClick={handleBulkOpen}
                        >
                          {t("emulators.games.openLocation")}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          leftIcon={<IconTrash />}
                          onClick={() => setConfirmBulkDelete(true)}
                        >
                          {t("emulators.games.deleteRom")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedGameIds(new Set())}
                        >
                          {t("common.cancel")}
                        </Button>
                      </div>
                    )}

                    {selectedGames.length === 0 ? (
                      <div className="emu-games-empty">
                        {gameSearch ? (
                          <p>{t("emulators.games.none")}</p>
                        ) : (
                          <>
                            <p>{t("emulators.detail.emptyGames")}</p>
                            <p className="emu-games-empty-hint">
                              {t("emulators.detail.emptyGamesHint")}
                            </p>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="emu-games-table">
                        <div className="emu-game-row emu-game-row-head">
                          <span className="emu-game-check">
                            <input
                              type="checkbox"
                              checked={
                                selectedGames.length > 0 &&
                                selectedGameIds.size === selectedGames.length
                              }
                              ref={(el) => {
                                if (el)
                                  el.indeterminate =
                                    selectedGameIds.size > 0 &&
                                    selectedGameIds.size < selectedGames.length;
                              }}
                              onChange={toggleSelectAll}
                              aria-label={t("emulators.games.selectAll")}
                            />
                          </span>
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
                              <span className="emu-game-check">
                                <input
                                  type="checkbox"
                                  checked={selectedGameIds.has(g.id)}
                                  onChange={() => toggleGameSelected(g.id)}
                                  aria-label={t("emulators.games.selectOne", { name: g.name })}
                                />
                              </span>
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
                                  {g.romPath
                                    ? truncateMiddle(g.romPath, 60)
                                    : t("emulators.games.noRomPath")}
                                </span>
                              </span>
                              <span className="emu-game-size">
                                {g.sizeBytes ? formatBytesShort(g.sizeBytes) : "—"}
                                {g.modsSizeBytes ? (
                                  <span
                                    className="emu-game-mods"
                                    title={t("emulators.games.hasMods")}
                                  >
                                    {" +"}
                                    {formatBytesShort(g.modsSizeBytes)}
                                  </span>
                                ) : null}
                              </span>
                              <span className="emu-game-actions">
                                <button
                                  type="button"
                                  className="emu-icon-btn"
                                  title={t("emulators.games.openLocation")}
                                  aria-label={t("emulators.games.openLocation")}
                                  onClick={() => g.romPath && handleOpenLocation(g.romPath)}
                                  disabled={!g.romPath}
                                >
                                  <IconFolder />
                                </button>
                                <button
                                  type="button"
                                  className="emu-icon-btn"
                                  title={t("emulators.games.rename")}
                                  aria-label={t("emulators.games.rename")}
                                  onClick={() => openRename(g)}
                                >
                                  <IconPencil />
                                </button>
                                <button
                                  type="button"
                                  className="emu-icon-btn emu-icon-btn--danger"
                                  title={t("emulators.games.deleteRom")}
                                  aria-label={t("emulators.games.deleteRom")}
                                  onClick={() => setConfirmDeleteRom(g)}
                                >
                                  <IconTrash />
                                </button>
                              </span>
                              <Button
                                variant="primary"
                                size="sm"
                                className="emu-game-launch"
                                onClick={() => launchGame(g)}
                                disabled={running}
                              >
                                {running ? "…" : t("emulators.games.launch")}
                              </Button>
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

      {showDownload && (
        <DownloadEmulatorModal
          onClose={() => setShowDownload(false)}
          onInstalled={handleDownloadInstalled}
        />
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        title={`${t("emulators.delete")}?`}
        message={
          confirmDelete
            ? romCounts[confirmDelete.id]
              ? t("emulators.confirmDelete", {
                  name: confirmDelete.name,
                  count: romCounts[confirmDelete.id],
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

      <ConfirmModal
        open={confirmBulkDelete}
        title={`${t("emulators.games.deleteRom")}?`}
        message={t("emulators.games.bulkDeleteConfirm", { count: selectedGameIds.size })}
        confirmLabel="emulators.games.deleteRom"
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
