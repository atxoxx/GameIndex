// Updates tab — every mod that has a newer version at its source, with a
// real one-click check and a per-game serial update run.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { Button, Panel } from "../../ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Game } from "../../../types/game";
import type {
  GameMod,
  GameModsPayload,
  ModUpdateProgress,
  ModUpdateRunResult,
  ModWorkspaceStats,
} from "../../../types/mods";

interface UpdatesTabProps {
  game: Game;
  onChanged: () => void;
  onStats?: (stats: ModWorkspaceStats) => void;
}

function statsFrom(mods: GameMod[]): ModWorkspaceStats {
  return {
    total: mods.length,
    enabled: mods.filter((m) => m.enabled).length,
    updates: mods.filter((m) => m.updateAvailable).length,
    sizeBytes: mods.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0),
  };
}

export default function ModUpdatesTab({ game, onChanged, onStats }: UpdatesTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [mods, setMods] = useState<GameMod[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState<ModUpdateProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [runTotal, setRunTotal] = useState(0);
  const [runDone, setRunDone] = useState(0);
  const [runResults, setRunResults] = useState<ModUpdateRunResult[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await invoke<GameModsPayload>("mods_list", { gameId: game.id });
      if (!mounted.current) return;
      setMods(payload.mods);
      onStats?.(statsFrom(payload.mods));
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [game.id, onStats, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    listen<ModUpdateProgress>("mods-update-progress", (event) => {
      if (!disposed && event.payload.gameId === game.id) setCheckProgress(event.payload);
    }).then((fn) => {
      if (disposed) fn();
      else dispose = fn;
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [game.id]);

  const updates = useMemo(() => mods.filter((m) => m.updateAvailable), [mods]);
  const updatable = useMemo(
    () => updates.filter((m) => Boolean(m.source && m.sourceModId)),
    [updates]
  );

  const check = useCallback(async () => {
    setChecking(true);
    setCheckProgress(null);
    try {
      const payload = await invoke<GameModsPayload>("mods_check_updates", {
        gameId: game.id,
      });
      if (!mounted.current) return;
      setMods(payload.mods);
      onStats?.(statsFrom(payload.mods));
      const found = payload.mods.filter((m) => m.updateAvailable).length;
      showToast(
        found > 0
          ? t("mods.updates.found", { count: found })
          : t("mods.updates.noneFound"),
        found > 0 ? "info" : "success"
      );
      onChanged();
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      if (mounted.current) {
        setChecking(false);
        setCheckProgress(null);
      }
    }
  }, [game.id, onChanged, onStats, showToast, t]);

  const updateAll = useCallback(async () => {
    const queue = updatable.filter((m) => m.updateAvailable);
    if (queue.length === 0) return;
    setRunning(true);
    setRunTotal(queue.length);
    setRunDone(0);
    setRunResults([]);
    const results: ModUpdateRunResult[] = [];
    for (const mod of queue) {
      try {
        const result = await invoke<{ status: string; message?: string; url?: string }>(
          "mods_update_mod",
          { modId: mod.id }
        );
        const ok = result.status === "installed";
        results.push({ modId: mod.id, name: mod.name, ok, message: result.status, url: result.url });
        if (!ok && result.url) {
          showToast(`${mod.name}: ${t("mods.updates.needsManual")}`, "warning");
        }
      } catch (err) {
        results.push({ modId: mod.id, name: mod.name, ok: false, message: String(err) });
      }
      if (mounted.current) setRunDone((n) => n + 1);
    }
    if (!mounted.current) return;
    setRunResults(results);
    setRunning(false);
    const installed = results.filter((r) => r.ok).length;
    showToast(t("mods.updates.runDone", { installed, total: results.length }), "info");
    await load();
    onChanged();
  }, [updatable, load, onChanged, showToast, t]);

  const updateOne = useCallback(
    async (mod: GameMod) => {
      try {
        const result = await invoke<{ status: string; message?: string; url?: string }>(
          "mods_update_mod",
          { modId: mod.id }
        );
        if (result.status === "installed") {
          showToast(`${mod.name}: ${t("mods.updates.updated")}`, "success");
        } else if (result.url) {
          showToast(`${mod.name}: ${t("mods.updates.needsManual")}`, "warning");
        }
        await load();
        onChanged();
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [load, onChanged, showToast, t]
  );

  return (
    <div className="mods-tab-body mods-updates">
      <div className="mods-updates-head">
        <div>
          <h3>{t("mods.updates.title")}</h3>
          <p>{t("mods.updates.desc")}</p>
        </div>
        <div className="mods-updates-actions">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            isLoading={checking}
            onClick={() => void check()}
          >
            {checking ? t("mods.checkingUpdates") : t("mods.checkUpdates")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<ArrowUpCircle size={14} />}
            disabled={running || updatable.filter((m) => m.updateAvailable).length === 0}
            onClick={() => void updateAll()}
          >
            {running
              ? t("mods.updates.running", { done: runDone, total: runTotal })
              : t("mods.updates.updateAll", {
                  count: updatable.filter((m) => m.updateAvailable).length,
                })}
          </Button>
        </div>
      </div>

      {checking && checkProgress && (
        <div className="mods-updates-progress" role="status" aria-live="polite">
          <span className="mods-updates-progress-track">
            <span
              className="mods-updates-progress-fill"
              style={{
                width: `${checkProgress.total > 0 ? (checkProgress.done / checkProgress.total) * 100 : 0}%`,
              }}
            />
          </span>
          <span>
            {checkProgress.done}/{checkProgress.total} · {checkProgress.name}
          </span>
        </div>
      )}

      {running && (
        <div className="mods-updates-progress" role="status" aria-live="polite">
          <span className="mods-updates-progress-track">
            <span
              className="mods-updates-progress-fill"
              style={{ width: `${runTotal > 0 ? (runDone / runTotal) * 100 : 0}%` }}
            />
          </span>
          <span>{t("mods.updates.running", { done: runDone, total: runTotal })}</span>
        </div>
      )}

      <Panel
        tone="plain"
        heading={t("mods.updates.pending")}
        icon={<ArrowUpCircle size={16} />}
        actions={<span className="mods-updates-count">{updates.length}</span>}
      >
        {loading ? (
          <p className="mods-hint">{t("common.loading")}</p>
        ) : mods.length === 0 ? (
          <div className="mods-updates-empty">
            <Sparkles size={24} />
            <p>{t("mods.updates.noMods")}</p>
          </div>
        ) : updates.length === 0 ? (
          <div className="mods-updates-clean">
            <CheckCircle2 size={24} />
            <div>
              <strong>{t("mods.updates.cleanTitle")}</strong>
              <p>{t("mods.updates.cleanDesc")}</p>
            </div>
          </div>
        ) : (
          <ul className="mods-updates-list">
            {updates.map((mod) => (
              <li key={mod.id} className="mods-updates-row">
                <span className="mods-updates-icon" aria-hidden>
                  <ArrowUpCircle size={15} />
                </span>
                <div className="mods-updates-info">
                  <strong>{mod.name}</strong>
                  <span>
                    {mod.source ?? t("mods.updates.localSource")}
                    {mod.version && mod.latestVersion
                      ? ` · ${mod.version} → ${mod.latestVersion}`
                      : mod.latestVersion
                        ? ` · ${mod.latestVersion}`
                        : ""}
                  </span>
                </div>
                <div className="mods-updates-row-actions">
                  {mod.remoteUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      leftIcon={<ExternalLink size={14} />}
                      aria-label={t("mods.updates.openPage")}
                      title={t("mods.updates.openPage")}
                      onClick={() => void openUrl(mod.remoteUrl!)}
                    />
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<ArrowUpCircle size={13} />}
                    disabled={running || !mod.source || !mod.sourceModId}
                    title={!mod.source ? t("mods.updates.noSource") : undefined}
                    onClick={() => void updateOne(mod)}
                  >
                    {t("mods.updates.update")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {runResults.length > 0 && (
        <Panel tone="raised" heading={t("mods.updates.lastRun")} icon={<CheckCircle2 size={16} />}>
          <ul className="mods-updates-results">
            {runResults.map((result) => (
              <li key={result.modId} className={result.ok ? "is-ok" : "is-warn"}>
                {result.ok ? <CheckCircle2 size={13} /> : <X size={13} />}
                <span>{result.name}</span>
                {!result.ok && result.message && <em>{result.message}</em>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
