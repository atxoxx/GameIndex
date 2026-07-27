import { useCallback, useEffect, useMemo, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { useGames } from "../context/GameContext";
import type { Emulator, Game } from "../types/game";
import "../styles/page-emulators.css";
import { accentForPlatform } from "../types/emulator";
import EmulatorEditorModal from "./EmulatorEditorModal";

function truncateMiddle(path: string, max = 42): string {
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

/**
 * The Emulators tab. Lists configured emulators as cards (each linked to
 * one ROM folder), supports add / edit / delete and scanning, and merges
 * scanned ROMs into the library so they appear in the sidebar by console
 * platform. ROMs launch through the existing `launch_game` path.
 */
export default function EmulatorsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { games, addGame, updateGame, removeGames } = useGames();

  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Emulator | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<Record<string, number>>({});
  const [confirmDelete, setConfirmDelete] = useState<Emulator | null>(null);

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
      await load();
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

  return (
    <div className="emulators-page">
      <div className="emulators-header">
        <div>
          <h1 className="emulators-title">{t("emulators.title")}</h1>
          <p className="emulators-subtitle">{t("emulators.subtitle")}</p>
        </div>
        <div className="emulators-header-actions">
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setShowEditor(true);
            }}
          >
            + {t("emulators.addEmulator")}
          </button>
          {emulators.length > 0 && (
            <button className="btn-secondary" onClick={handleScanAll} disabled={scanningId !== null}>
              {t("emulators.scanAll")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="emulators-empty">
          <p>{t("common.loading")}</p>
        </div>
      ) : emulators.length === 0 ? (
        <div className="emulators-empty">
          <div className="emulators-empty-glyph">🕹️</div>
          <h2>{t("emulators.empty.title")}</h2>
          <p>{t("emulators.empty.desc")}</p>
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setShowEditor(true);
            }}
          >
            {t("emulators.empty.cta")}
          </button>
        </div>
      ) : (
        <div className="emulators-grid">
          {emulators.map((emu) => {
            const accent = accentForPlatform(emu.platform);
            const count = romCounts[emu.id] ?? 0;
            const scanning = scanningId === emu.id;
            return (
              <div
                key={emu.id}
                className="emulator-card"
                style={{ ["--emu-accent" as string]: accent }}
              >
                <div className="emulator-card-accent" />
                <div className="emulator-card-head">
                  <span className="emulator-card-glyph" style={{ background: accent }}>
                    {accentForPlatform(emu.platform)}
                  </span>
                  <div className="emulator-card-titles">
                    <h3 className="emulator-card-name">{emu.name}</h3>
                    <span className="emulator-card-platform" style={{ color: accent }}>
                      {emu.platform}
                    </span>
                  </div>
                </div>

                <div className="emulator-card-folder" title={emu.romFolder}>
                  📁 {truncateMiddle(emu.romFolder)}
                </div>

                <div className="emulator-card-meta">
                  <span className="emulator-card-count">
                    {count === 1
                      ? t("emulators.romCountSingle", { count })
                      : t("emulators.romCount", { count })}
                  </span>
                  <span className="emulator-card-scanned">
                    {lastScanned[emu.id]
                      ? t("emulators.lastScanned", { date: formatDate(lastScanned[emu.id]) })
                      : t("emulators.neverScanned")}
                  </span>
                </div>

                <div className="emulator-card-actions">
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => handleScan(emu)}
                    disabled={scanning}
                  >
                    {scanning ? t("emulators.scanning") : t("emulators.scan")}
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => handleOpenFolder(emu.romFolder)}
                    disabled={!emu.romFolder}
                  >
                    {t("emulators.openFolder")}
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      setEditing(emu);
                      setShowEditor(true);
                    }}
                  >
                    {t("emulators.edit")}
                  </button>
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => setConfirmDelete(emu)}
                  >
                    {t("emulators.delete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showEditor && (
        <EmulatorEditorModal
          emulator={editing}
          onClose={() => {
            setShowEditor(false);
            setEditing(null);
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
    </div>
  );
}
