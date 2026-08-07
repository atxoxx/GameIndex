// BigScreenModsPage — controller-first mod manager for Big Screen Mode.
//
// Two-phase drill-down:
//   1. Select phase: a windowed grid of moddable games via the shared
//      GameGrid (lane-C component; renders `.bigscreen-game-card` tiles).
//   2. Manage phase: the selected game's mods (Steam Workshop + Nexus +
//      every engine the backend detects) in a scrollable list with
//      enable/disable, scan, and a details modal for actions.
//
// Data comes from the SAME backend as the desktop ModsPage:
//   • `mods_overview` (per-game totals — used to float modded games
//     to the front of the selection grid)
//   • `useGameMods(game)` hook (list / scan / setEnabled / remove)
// The desktop ModsPage / ModManager are untouched.
//
// Presence: selecting a game publishes its name via `setModsGameName`
// so Discord Rich Presence shows the game being configured.
//
// Hooks hygiene: the two phases are separate components (BigScreenModsPage
// and ModsManagerView) so each keeps a stable hook order — no conditional
// hooks when drilling from the grid into a game.

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { usePresence } from "../../context/PresenceContext";
import { useGameMods } from "../../hooks/useGameMods";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import {
  ENGINE_LABELS,
  type GameMod,
  type ModsOverviewEntry,
} from "../../types/mods";
import type { Game } from "../../types/game";
import BigScreenBackHeader from "./BigScreenBackHeader";
import BigScreenModal from "./BigScreenModal";
import GameGrid from "./GameGrid";

function formatModSize(bytes?: number): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function BigScreenModsPage() {
  const { t } = useLanguage();
  const { games } = useGames();

  const [overview, setOverview] = useState<Map<string, ModsOverviewEntry>>(new Map());
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  // Installed games with a real on-disk path are moddable candidates —
  // mirrors the desktop ModsPage candidate filter. Games that already
  // have mods float to the top (same ordering as the desktop rail).
  const candidates = useMemo(() => {
    const list = games.filter((g) => g.installed !== false && !!g.path);
    return [...list].sort((a, b) => {
      const am = overview.get(a.id)?.total ?? 0;
      const bm = overview.get(b.id)?.total ?? 0;
      if ((am > 0) !== (bm > 0)) return am > 0 ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [games, overview]);

  const refreshOverview = useCallback(() => {
    invoke<ModsOverviewEntry[]>("mods_overview")
      .then((rows) => setOverview(new Map(rows.map((r) => [r.gameId, r]))))
      .catch(() => setOverview(new Map()));
  }, []);

  useEffect(refreshOverview, [refreshOverview]);

  const selectedGame = candidates.find((g) => g.id === selectedGameId) ?? null;

  // ── Phase 1: pick a game from the grid ─────────────────────────
  if (!selectedGame) {
    return (
      <div className="bigscreen-library-dashboard">
        <BigScreenBackHeader
          title={t("bigscreen.mods.title")}
          subtitle={t("bigscreen.mods.selectGame")}
        />
        {candidates.length === 0 ? (
          <div className="bigscreen-library-empty-state">
            <h3>{t("mods.noGames")}</h3>
            <p>{t("mods.noGamesHint")}</p>
          </div>
        ) : (
          <GameGrid
            games={candidates}
            onSelect={(g) => setSelectedGameId(g.id)}
            emptyState={
              <div className="bigscreen-library-empty-state">
                <h3>{t("mods.noGames")}</h3>
                <p>{t("mods.noGamesHint")}</p>
              </div>
            }
          />
        )}
      </div>
    );
  }

  return (
    <ModsManagerView
      key={selectedGame.id}
      game={selectedGame}
      onBack={() => setSelectedGameId(null)}
      onChanged={refreshOverview}
    />
  );
}

// ── Phase 2: mods manager for one game ───────────────────────────────

function ModsManagerView({
  game,
  onBack,
  onChanged,
}: {
  game: Game;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { setModsGameName } = usePresence();
  const { registerBackHandler } = useGamepad();

  const [actionMod, setActionMod] = useState<GameMod | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GameMod | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { payload, loading, scanning, scan, setEnabled, remove } = useGameMods(game);

  // B button returns to the game grid (a modal owns B while open).
  useEffect(
    () => registerBackHandler(onBack),
    [registerBackHandler, onBack],
  );

  // Discord presence: expose the game currently being configured.
  useEffect(() => {
    setModsGameName(game.name);
    return () => setModsGameName(null);
  }, [game, setModsGameName]);

  const mods = payload?.mods ?? [];
  const enabledCount = mods.filter((m) => m.enabled).length;
  const updateCount = mods.filter((m) => m.updateAvailable).length;

  const handleScan = useCallback(async () => {
    try {
      const p = await scan();
      if (p) {
        showToast(t("mods.scanComplete", { count: String(p.mods.length) }), "success");
      }
      onChanged();
    } catch (e) {
      showToast(String(e), "error");
    }
  }, [scan, onChanged, showToast, t]);

  const handleToggle = useCallback(
    async (mod: GameMod) => {
      try {
        await setEnabled(mod.id, !mod.enabled);
        setActionMod(null);
        onChanged();
      } catch (e) {
        showToast(String(e), "error");
      }
    },
    [setEnabled, onChanged, showToast],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      showToast(t("mods.deleted", { name: deleteTarget.name }), "success");
      setDeleteTarget(null);
      setActionMod(null);
      onChanged();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, remove, onChanged, showToast, t]);

  const closeModals = useCallback(() => {
    setActionMod(null);
    setDeleteTarget(null);
  }, []);

  // Source label for a mod: Workshop / Nexus are first-class sources,
  // anything else falls back to its engine label.
  const sourceLabel = (m: GameMod) =>
    m.engine === "workshop"
      ? t("bigscreen.mods.workshop")
      : m.nexusModId
        ? t("bigscreen.mods.nexus")
        : (ENGINE_LABELS[m.engine] ?? m.engine);

  const scanFocus = useFocusable(() => void handleScan());

  return (
    <div className="bigscreen-library-dashboard">
      <BigScreenBackHeader
        title={game.name}
        subtitle={t("bigscreen.mods.managing")}
        onBack={onBack}
      />

      <div className="bigscreen-dashboard-scrollable-content">
        {/* Stats row — reuses the system settings row classes. */}
        <div className="system-settings-list">
          <div className="system-setting-row">
            <div className="setting-info">
              <span className="setting-label">{t("bigscreen.mods.summary")}</span>
              <span className="setting-desc">
                {t("bigscreen.mods.summaryDesc", {
                  enabled: String(enabledCount),
                  total: String(mods.length),
                  updates: String(updateCount),
                })}
              </span>
            </div>
            <button
              type="button"
              className="setting-cycle-btn"
              {...scanFocus}
              disabled={!game.path || scanning}
            >
              {scanning ? t("mods.scanning") : t("mods.scan")}
            </button>
          </div>
        </div>

        {/* Mod list — each row is its own component so useFocusable
            runs exactly once per mod (stable hook order). */}
        {loading && mods.length === 0 ? (
          <div className="system-view-empty">
            <p>{t("common.loading")}</p>
          </div>
        ) : mods.length === 0 ? (
          <div className="system-view-empty">
            <p>{t("bigscreen.mods.noModsFound")}</p>
          </div>
        ) : (
          <div className="bigscreen-overlay-options-list">
            {mods.map((m) => (
              <ModRow
                key={m.id}
                mod={m}
                orderIndex={mods.indexOf(m)}
                onActivate={() => setActionMod(m)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Mod details / actions modal ───────────────────────── */}
      <BigScreenModal
        open={actionMod !== null}
        title={actionMod?.name ?? ""}
        onClose={closeModals}
        footer={
          <>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
              {...useFocusable(() => actionMod && setDeleteTarget(actionMod))}
            >
              {t("mods.delete")}
            </button>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
              {...useFocusable(() => actionMod && void handleToggle(actionMod))}
            >
              {actionMod?.enabled ? t("mods.disable") : t("mods.enable")}
            </button>
          </>
        }
      >
        {actionMod && (
          <div className="bigscreen-modal-stat-grid">
            <ModDetailStat label={t("bigscreen.mods.engine")} value={sourceLabel(actionMod)} />
            <ModDetailStat label={t("bigscreen.mods.version")} value={actionMod.version ?? "—"} />
            <ModDetailStat label={t("bigscreen.mods.author")} value={actionMod.author ?? "—"} />
            <ModDetailStat label={t("bigscreen.mods.size")} value={formatModSize(actionMod.sizeBytes)} />
            <ModDetailStat
              label={t("bigscreen.mods.state")}
              value={actionMod.enabled ? t("mods.enabled") : t("mods.disabled")}
            />
            {actionMod.updateAvailable && (
              <ModDetailStat
                label={t("bigscreen.mods.latest")}
                value={actionMod.latestVersion ?? "—"}
              />
            )}
            <div className="bigscreen-modal-stat-full">
              <ModDetailStat label={t("bigscreen.mods.path")} value={actionMod.path} />
            </div>
          </div>
        )}
      </BigScreenModal>

      {/* ── Delete confirmation modal ─────────────────────────── */}
      <BigScreenModal
        open={deleteTarget !== null}
        title={deleteTarget ? t("bigscreen.mods.deleteTitle", { name: deleteTarget.name }) : ""}
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
              {deleting ? t("bigscreen.mods.deleting") : t("mods.delete")}
            </button>
          </>
        }
      >
        <p className="bigscreen-modal-body-text">
          {t("bigscreen.mods.deleteBody")}
        </p>
      </BigScreenModal>
    </div>
  );
}

// ── Sub-components (each calls useFocusable exactly once) ───────────

function ModRow({
  mod,
  orderIndex,
  onActivate,
}: {
  mod: GameMod;
  orderIndex: number;
  onActivate: () => void;
}) {
  const { t } = useLanguage();
  const focusProps = useFocusable(onActivate);

  return (
    <button
      type="button"
      className={`bigscreen-overlay-drawer-option bigscreen-option-row ${mod.enabled ? "option-active" : ""}`}
      {...focusProps}
    >
      <span className="bigscreen-option-row-main">
        <span className="bigscreen-option-row-title">
          #{orderIndex + 1} {mod.name}
        </span>
        <span className="bigscreen-option-row-sub">
          {mod.version ? `v${mod.version}` : ""}
          {mod.updateAvailable ? ` · ${t("bigscreen.mods.updateAvailable")}` : ""}
        </span>
      </span>
      <span className="bigscreen-option-row-trail">
        <span
          className="bigscreen-option-badge"
          style={{
            background: "color-mix(in srgb, var(--bigscreen-accent) 15%, transparent)",
            color: "var(--bigscreen-accent-soft-text)",
          }}
        >
          {ENGINE_LABELS[mod.engine] ?? mod.engine}
        </span>
        <span className="bigscreen-option-size">
          {formatModSize(mod.sizeBytes)}
        </span>
        <span
          className="bigscreen-option-badge"
          style={{
            background: mod.enabled
              ? "color-mix(in srgb, var(--bigscreen-success) 18%, transparent)"
              : "color-mix(in srgb, var(--bigscreen-text) 8%, transparent)",
            color: mod.enabled
              ? "var(--bigscreen-success-soft)"
              : "color-mix(in srgb, var(--bigscreen-text) 50%, transparent)",
          }}
        >
          {mod.enabled ? t("mods.enabled") : t("mods.disabled")}
        </span>
      </span>
    </button>
  );
}

function ModDetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bigscreen-modal-stat">
      <span className="bigscreen-modal-stat-label">{label}</span>
      <span className="bigscreen-modal-stat-value">{value}</span>
    </div>
  );
}
