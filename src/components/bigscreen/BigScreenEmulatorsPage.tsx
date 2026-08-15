// BigScreenEmulatorsPage — controller-first emulator browser for Big
// Screen Mode.
//
// Two-phase drill-down:
//   1. Grid phase: every known emulator (curated catalog merged with the
//      user's configured emulators) as a `.bigscreen-game-card` tile with
//      logo, platform and live ROM count.
//   2. ROMs phase: the selected emulator's detected ROMs in a scrollable
//      list; activating a ROM opens a BigScreenModal with Launch / Open
//      location / Delete actions.
//
// Data mirrors the desktop EmulatorsPage:
//   • `invoke("list_emulators")` for configured emulators
//   • `KNOWN_EMULATORS` catalog merged in via `matchKnownEmulator`
//   • `useGames()` for per-emulator ROM counts and the ROM list
// The desktop page is untouched.

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import {
  KNOWN_EMULATORS,
  accentForPlatform,
  matchKnownEmulator,
  type Emulator,
} from "../../types/emulator";
import { formatBytesShort } from "../../types/download";
import type { Game } from "../../types/game";
import BigScreenBackHeader from "./BigScreenBackHeader";
import BigScreenModal from "./BigScreenModal";

interface EmuRow {
  id: string;
  name: string;
  platform: string;
  glyph: string;
  logo?: string;
  accent: string;
  added: boolean;
  configured: boolean;
  /** True for configured-but-uncatalogued emulators: no platform glyph,
   *  so the tile falls back to an inline SVG instead of an emoji. */
  generic: boolean;
  emulator?: Emulator;
  gameCount: number;
}

export default function BigScreenEmulatorsPage() {
  const { t } = useLanguage();
  const { games } = useGames();

  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Emulator[]>("list_emulators")
      .then((list) => {
        if (!cancelled) setEmulators(list);
      })
      .catch(() => {
        if (!cancelled) setEmulators([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ROM count per configured emulator, derived from the live library.
  const romCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of games) {
      if (g.emulatorId) m[g.emulatorId] = (m[g.emulatorId] ?? 0) + 1;
    }
    return m;
  }, [games]);

  // Merge the curated catalog with the configured emulators — same
  // `matchKnownEmulator` matching the desktop page uses.
  const rows = useMemo<EmuRow[]>(() => {
    const result: EmuRow[] = [];
    const used = new Set<string>();
    for (const k of KNOWN_EMULATORS) {
      const emu = emulators.find(
        (e) => !used.has(e.id) && matchKnownEmulator(e)?.key === k.key
      );
      if (emu) used.add(emu.id);
      result.push({
        id: emu ? emu.id : `known:${k.key}`,
        name: emu?.name ?? k.name,
        platform: k.platform,
        glyph: k.glyph,
        logo: emu?.iconUrl ?? k.logo,
        accent: k.accent,
        added: !!emu,
        configured: !!emu?.executablePath,
        generic: false,
        emulator: emu,
        gameCount: emu ? (romCounts[emu.id] ?? 0) : 0,
      });
    }
    for (const e of emulators) {
      if (used.has(e.id)) continue;
      result.push({
        id: e.id,
        name: e.name,
        platform: e.platform,
        glyph: "",
        logo: e.iconUrl,
        accent: accentForPlatform(e.platform),
        added: true,
        configured: !!e.executablePath,
        generic: true,
        emulator: e,
        gameCount: romCounts[e.id] ?? 0,
      });
    }
    return result;
  }, [emulators, romCounts]);

  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="bigscreen-library-dashboard">
      <BigScreenBackHeader
        title={t("bigscreen.emulators.title")}
        subtitle={t("bigscreen.emulators.selectEmulator")}
      />

      {loading ? (
        <div className="system-view-empty">
          <p>{t("common.loading")}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bigscreen-library-empty-state">
          <h3>{t("emulators.empty.title")}</h3>
          <p>{t("emulators.empty.desc")}</p>
        </div>
      ) : selectedRow && selectedRow.emulator ? (
        <EmulatorRomsView
          key={selectedRow.id}
          row={selectedRow}
          onBack={() => setSelectedId(null)}
        />
      ) : selectedRow && !selectedRow.emulator ? (
        <div className="bigscreen-dashboard-scrollable-content">
          <BigScreenBackHeader
            title={selectedRow.name}
            subtitle={t("emulators.status.notConfigured")}
            onBack={() => setSelectedId(null)}
          />
          <div className="bigscreen-library-empty-state">
            <h3>{selectedRow.name}</h3>
            <p>{t("bigscreen.emulators.notConfiguredHint")}</p>
          </div>
        </div>
      ) : (
        <div className="bigscreen-dashboard-scrollable-content">
          <div className="bigscreen-library-grid">
            {rows.map((r) => (
              <EmulatorTile key={r.id} row={r} onSelect={() => setSelectedId(r.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Phase 2: ROM list for one emulator ───────────────────────────────

function EmulatorRomsView({
  row,
  onBack,
}: {
  row: EmuRow;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { games, launchGame, runningGameIds, removeGames } = useGames();
  const { registerBackHandler } = useGamepad();

  const [actionRom, setActionRom] = useState<Game | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null);
  const [deleting, setDeleting] = useState(false);

  const emu = row.emulator!;

  // B button returns to the emulator grid (a modal owns B while open).
  useEffect(
    () => registerBackHandler(onBack),
    [registerBackHandler, onBack],
  );

  const roms = useMemo(
    () =>
      games
        .filter((g) => g.emulatorId === emu.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [games, emu.id],
  );

  const handleOpenLocation = useCallback(
    async (rom: Game) => {
      if (!rom.romPath) {
        showToast(t("emulators.games.noRomPath"), "info");
        return;
      }
      try {
        await invoke("open_folder", { path: rom.romPath });
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [showToast, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await invoke("delete_rom_file", { gameId: deleteTarget.id });
      removeGames((g) => g.id === deleteTarget.id);
      showToast(t("emulators.games.romDeleted"), "success");
      setDeleteTarget(null);
      setActionRom(null);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, removeGames, showToast, t]);

  const closeModals = useCallback(() => {
    setActionRom(null);
    setDeleteTarget(null);
  }, []);

  return (
    <>
      <BigScreenBackHeader
        title={row.name}
        subtitle={row.platform}
        onBack={onBack}
      />

      <div className="bigscreen-dashboard-scrollable-content">
        {roms.length === 0 ? (
          <div className="system-view-empty">
            <p>{t("bigscreen.emulators.noRoms")}</p>
          </div>
        ) : (
          <div className="bigscreen-overlay-options-list">
            {roms.map((g) => {
              const running = runningGameIds.includes(g.id);
              return (
                <RomRow
                  key={g.id}
                  rom={g}
                  running={running}
                  onActivate={() => setActionRom(g)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── ROM actions modal ─────────────────────────────────── */}
      <BigScreenModal
        open={actionRom !== null}
        title={actionRom?.name ?? ""}
        onClose={closeModals}
        footer={
          <>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
              {...useFocusable(() => actionRom && setDeleteTarget(actionRom))}
            >
              {t("emulators.games.deleteRom")}
            </button>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
              {...useFocusable(() => actionRom && void handleOpenLocation(actionRom))}
            >
              {t("emulators.games.openLocation")}
            </button>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
              {...useFocusable(() => actionRom && launchGame(actionRom))}
            >
              {t("emulators.games.launch")}
            </button>
          </>
        }
      >
        {actionRom && (
          <div className="bigscreen-modal-stat-grid">
            <RomDetailStat label={t("bigscreen.emulators.platform")} value={row.platform} />
            <RomDetailStat
              label={t("bigscreen.emulators.size")}
              value={actionRom.sizeBytes ? formatBytesShort(actionRom.sizeBytes) : "—"}
            />
            <div className="bigscreen-modal-stat-full">
              <RomDetailStat label={t("bigscreen.emulators.romPath")} value={actionRom.romPath ?? "—"} />
            </div>
          </div>
        )}
      </BigScreenModal>

      {/* ── Delete confirmation modal ─────────────────────────── */}
      <BigScreenModal
        open={deleteTarget !== null}
        title={deleteTarget ? t("bigscreen.emulators.deleteTitle", { name: deleteTarget.name }) : ""}
        onClose={closeModals}
        footer={
          <>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
              {...useFocusable(() => !deleting && setDeleteTarget(null))}
              disabled={deleting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--danger bigscreen-details-btn--compact"
              {...useFocusable(() => void handleDelete())}
              disabled={deleting}
            >
              {deleting ? t("bigscreen.emulators.deleting") : t("emulators.games.deleteRom")}
            </button>
          </>
        }
      >
        <p className="bigscreen-modal-body-text">
          {t("bigscreen.emulators.deleteBody")}
        </p>
      </BigScreenModal>
    </>
  );
}

// ── Sub-components (each calls useFocusable exactly once) ───────────

function EmulatorTile({
  row,
  onSelect,
}: {
  row: EmuRow;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const focusProps = useFocusable(onSelect);

  return (
    <button type="button" className="bigscreen-game-card" {...focusProps}>
      <div className="bigscreen-game-card-cover">
        <div className="bigscreen-game-card-cover-logo">
          {row.logo ? (
            <img
              src={row.logo}
              alt=""
              loading="lazy"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          ) : row.generic ? (
            <span className="bigscreen-tile-glyph">
              <svg
                viewBox="0 0 24 24"
                width="40"
                height="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="6" width="18" height="12" rx="3" />
                <path d="M8 12h4M10 10v4M16 11h.01M18 13h.01" />
              </svg>
            </span>
          ) : (
            <span className="bigscreen-tile-glyph">{row.glyph}</span>
          )}
        </div>
        <div className="bigscreen-game-card-body">
          <h4 className="bigscreen-game-card-name">{row.name}</h4>
          <div className="bigscreen-game-card-meta">
            <span className="bigscreen-game-card-platform">{row.platform}</span>
            <span className="bigscreen-game-card-playtime">
              {row.gameCount === 1
                ? t("emulators.romCountSingle", { count: row.gameCount })
                : t("emulators.romCount", { count: row.gameCount })}
            </span>
          </div>
        </div>
        {row.configured && <span className="bigscreen-game-card-running-dot" />}
      </div>
    </button>
  );
}

function RomRow({
  rom,
  running,
  onActivate,
}: {
  rom: Game;
  running: boolean;
  onActivate: () => void;
}) {
  const { t } = useLanguage();
  const focusProps = useFocusable(onActivate);

  return (
    <button
      type="button"
      className="bigscreen-overlay-drawer-option bigscreen-option-row"
      {...focusProps}
    >
      <span className="bigscreen-option-row-main">
        <span className="bigscreen-option-row-title">{rom.name}</span>
        <span className="bigscreen-option-row-sub">
          {rom.romPath ?? t("emulators.games.noRomPath")}
        </span>
      </span>
      <span className="bigscreen-option-row-trail">
        <span className="bigscreen-option-size">
          {rom.sizeBytes ? formatBytesShort(rom.sizeBytes) : "—"}
        </span>
        <span
          className="bigscreen-option-badge"
          style={{
            background: running
              ? "color-mix(in srgb, var(--bigscreen-success) 18%, transparent)"
              : "color-mix(in srgb, var(--bigscreen-text) 8%, transparent)",
            color: running
              ? "var(--bigscreen-success-soft)"
              : "color-mix(in srgb, var(--bigscreen-text) 50%, transparent)",
          }}
        >
          {running ? t("bigscreen.emulators.running") : t("emulators.games.launch")}
        </span>
      </span>
    </button>
  );
}

function RomDetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bigscreen-modal-stat">
      <span className="bigscreen-modal-stat-label">{label}</span>
      <span className="bigscreen-modal-stat-value">{value}</span>
    </div>
  );
}
