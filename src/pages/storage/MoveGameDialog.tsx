import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { formatSize, type Game } from "../../types/game";
import { Button } from "../../components/ui";
import { relocateExe, gameTotalBytes } from "./utils";
import type { DriveUsage } from "./useDriveUsage";

interface MoveProgressPayload {
  gameId: string;
  copiedBytes: number;
  totalBytes: number;
  phase: string;
}

interface Props {
  games: Game[];
  onMoved: (game: Game, toPath: string, newExe: string) => void;
  onClose: () => void;
}

export function MoveGameDialog({ games, onMoved, onClose }: Props) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { unit } = useSizeUnit();

  const [destDir, setDestDir] = useState("");
  const [destUsage, setDestUsage] = useState<DriveUsage | null>(null);
  const [checkingDest, setCheckingDest] = useState(false);

  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"idle" | "copying" | "verifying" | "cleaning">("idle");
  const [copied, setCopied] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const totalRequiredBytes = games.reduce((sum, g) => sum + gameTotalBytes(g), 0);

  // Listen for progress ticks
  useEffect(() => {
    let cancelled = false;
    listen<MoveProgressPayload>("game-move-progress", (e) => {
      if (cancelled) return;
      setCopied(e.payload.copiedBytes);
      setTotal(e.payload.totalBytes);
      setPhase(e.payload.phase as typeof phase);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenRef.current = fn;
    });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  async function pickDestination() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: t("storagePage.selectDestFolder"),
    });
    if (typeof picked === "string" && picked.trim() !== "") {
      setDestDir(picked);
      setCheckingDest(true);
      try {
        const usage = await invoke<DriveUsage>("disk_usage", { path: picked });
        setDestUsage(usage);
      } catch {
        setDestUsage(null);
      } finally {
        setCheckingDest(false);
      }
    }
  }

  async function run() {
    if (!destDir || running) return;
    setRunning(true);
    setErrors([]);
    const failed: string[] = [];

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      setCurrent(i);
      setCopied(0);
      setTotal(0);
      setPhase("copying");
      const fromRoot = g.sizeRootPath || g.path;
      if (!fromRoot) {
        failed.push(t("storageMove.noInstallFolder", { name: g.name }));
        continue;
      }
      try {
        const result = await invoke<{ toPath: string; sizeBytes: number }>(
          "move_game_install",
          { gameId: g.id, fromRoot, destDir }
        );
        const newExe = relocateExe(g.path, fromRoot, result.toPath);
        onMoved(g, result.toPath, newExe);
        setDone((d) => d + 1);
      } catch (err) {
        const msg = typeof err === "string" ? err : String(err);
        failed.push(`${g.name}: ${msg}`);
        console.error("move_game_install failed for", g.name, err);
      }
    }

    setRunning(false);
    setPhase("idle");
    if (failed.length === 0) {
      showToast(
        t("storageMove.movedTo", { count: done, plural: done === 1 ? "" : "s", dest: destDir }),
        "success"
      );
      onClose();
    } else {
      setErrors(failed);
      showToast(
        t("storageMove.movedPartial", { done, total: games.length, failed: failed.length }),
        "error"
      );
    }
  }

  const pct = total > 0 ? Math.min(100, (copied / total) * 100) : 0;
  const phaseLabel =
    phase === "verifying"
      ? t("storageMove.verifying")
      : phase === "cleaning"
        ? t("storageMove.cleaning")
        : t("storageMove.copying");

  const multiple = games.length > 1;
  const hasEnoughSpace = !destUsage || destUsage.available >= totalRequiredBytes;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={() => !running && onClose()}
      role="presentation"
    >
      <div
        className="modal move-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 7h13l-3-3" />
              <path d="M21 17H8l3 3" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="move-dialog-title">
              {multiple
                ? t("storageMove.moveCount", { count: games.length })
                : t("storageMove.moveName", { name: games[0]?.name ?? "" })}
            </h2>
          </div>
        </div>

        <div className="modal-body move-dialog-body">
          {!running && errors.length === 0 && (
            <>
              <p className="move-dialog-lead">
                {t("storageMove.lead")}
              </p>

              {/* Destination picker button */}
              <button
                type="button"
                className="move-dialog-dest"
                onClick={pickDestination}
                disabled={running}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <span className="move-dialog-dest-value">
                  {destDir || t("storageMove.selectDestEllipsis")}
                </span>
              </button>

              {/* Destination Free Space Info */}
              {destUsage && (
                <div className="move-dialog-space-card">
                  <div className="move-dialog-space-row">
                    <span className="move-dialog-space-label">
                      {t("storageMove.targetFree", { free: formatSize(destUsage.available, unit) })}
                    </span>
                    <span className="move-dialog-space-val">
                      {t("storageMove.spaceRequired", { required: formatSize(totalRequiredBytes, unit) })}
                    </span>
                  </div>

                  {!hasEnoughSpace && (
                    <div className="move-dialog-space-warning">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <span>
                        {t("storageMove.notEnoughSpace", {
                          free: formatSize(destUsage.available, unit),
                          required: formatSize(totalRequiredBytes, unit),
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Game list */}
              {multiple && (
                <ul className="move-dialog-list">
                  {games.map((g) => (
                    <li key={g.id} className="move-dialog-list-item">
                      <span className="move-dialog-list-name">{g.name}</span>
                      <span className="move-dialog-list-size">
                        {formatSize(gameTotalBytes(g), unit)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Running progress bar */}
          {running && (
            <div className="move-dialog-progress">
              <div className="move-dialog-progress-head">
                <span>
                  {multiple
                    ? t("storageMove.movingOf", { current: current + 1, total: games.length, name: games[current]?.name ?? "" })
                    : t("storageMove.movingName", { name: games[0]?.name ?? "" })}
                </span>
                <span className="move-dialog-progress-pct">{pct.toFixed(0)}%</span>
              </div>
              <div className="move-dialog-progress-track">
                <div
                  className="move-dialog-progress-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="move-dialog-progress-meta">
                {phaseLabel}{" "}
                {total > 0 && (
                  <span className="move-dialog-progress-bytes">
                    {formatSize(copied, unit)} / {formatSize(total, unit)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Error display */}
          {!running && errors.length > 0 && (
            <div className="move-dialog-errors">
              <p className="move-dialog-errors-title">
                {t("storageMove.movedFailed", { done, failed: errors.length })}
              </p>
              <ul>
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <button
                type="button"
                className="move-dialog-dest"
                onClick={pickDestination}
              >
                <span className="move-dialog-dest-value">{t("storagePage.chooseFolder")}</span>
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {multiple && !running && errors.length === 0
              ? t("storageMove.totalSize", {
                  size: formatSize(totalRequiredBytes, unit),
                })
              : " "}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose} disabled={running}>
              {errors.length > 0 ? t("common.close") : t("common.cancel")}
            </Button>
            {errors.length === 0 && (
              <Button
                variant="primary"
                onClick={run}
                isLoading={running || checkingDest}
                disabled={!destDir || running}
              >
                {running ? t("storageMove.moving") : t("storageMove.moveHere")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
