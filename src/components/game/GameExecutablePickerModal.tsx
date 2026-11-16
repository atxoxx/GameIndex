import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Check,
  Copy,
  FolderOpen,
  Gamepad2,
  Play,
  Plus,
  Shield,
  Star,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { copyTextToClipboard } from "../../utils/clipboard";
import { gameDisplayName, type Game, type GameExecutable } from "../../types/game";
import "../../styles/exec-extras.css";

/**
 * GameExecutablePickerModal
 *
 * Opens from the hero play button's chevron on games that have extra
 * executables configured. Lists the execution targets: the main executable
 * (the target the Play button uses) and every additional executable with its
 * per-exe label / arguments / run-as-admin settings. Any extra can be promoted
 * to the default target, which swaps it with the current main path. Launches
 * on click and lets the user add or remove executables right here.
 *
 * Layout: one card per target. The main card is accent-tinted and carries the
 * "Default" chip; extra cards put the (editable) label + arguments on the first
 * line and a meta line with the file name, copy affordance, argument/admin
 * summary and a missing-file warning underneath. Every card ends in the same
 * right-hand action rail (admin toggle, Launch, remove).
 */
interface GameExecutablePickerModalProps {
  game: Game;
  open: boolean;
  onClose: () => void;
  /** Launch with a specific executable override (executed by the caller). */
  onLaunch: (exe: GameExecutable) => void;
  /** Plain launch of the game's default exe (kept separate so the picker
   *  never needs to know about exe-override plumbing). */
  launchGame: (game: Game) => void;
}

type AddError = "pick" | "duplicate";

export default function GameExecutablePickerModal({
  game,
  open,
  onClose,
  onLaunch,
  launchGame,
}: GameExecutablePickerModalProps) {
  const { t } = useLanguage();
  const { updateGame, runningGameIds } = useGames();
  const isRunning = runningGameIds.includes(game.id);
  const titleId = useId();

  const [adding, setAdding] = useState(false);
  const [newArgs, setNewArgs] = useState("");
  const [error, setError] = useState<AddError | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  const copyTimer = useRef<number | null>(null);

  const exes = game.extraExecutables || [];
  const paths = [game.path, ...exes.map((exe) => exe.path)].filter(Boolean);
  // Only the paths themselves: editing a label or the arguments must not
  // re-run the existence check.
  const pathSignature = paths.join("\n");

  useEffect(() => {
    if (!open) return;
    // Protocol URLs (steam://…) are valid launch targets but not files, so the
    // existence probe would report them as missing.
    const targets = (pathSignature ? pathSignature.split("\n") : []).filter(
      (path) => path && !/^[a-z][a-z0-9+.-]*:\/\//i.test(path)
    );
    if (targets.length === 0) {
      setMissing(new Set());
      return;
    }
    let cancelled = false;
    void invoke<boolean[]>("check_paths_exist", { paths: targets })
      .then((flags) => {
        if (cancelled) return;
        const next = new Set<string>();
        targets.forEach((path, index) => {
          if (flags[index] === false) next.add(path);
        });
        setMissing(next);
      })
      .catch(() => {
        if (!cancelled) setMissing(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [open, pathSignature]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    []
  );

  function setExes(next: GameExecutable[]) {
    updateGame(game.id, { extraExecutables: next.length > 0 ? next : undefined });
  }

  function startAdding() {
    setAdding(true);
    setError(null);
  }

  function cancelAdding() {
    setAdding(false);
    setNewArgs("");
    setError(null);
  }

  async function browseNewExe() {
    setError(null);
    try {
      const filePath = await pickFile({
        multiple: false,
        directory: false,
        title: t("game.execExtras.browseButton"),
        filters: [
          { name: "Executables", extensions: ["exe", "bat", "cmd", "lnk", "sh", "AppImage", "x86_64"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (typeof filePath !== "string") return;

      const target = filePath.trim().toLowerCase();
      const duplicate =
        target === game.path.trim().toLowerCase() ||
        exes.some((exe) => exe.path.trim().toLowerCase() === target);
      if (duplicate) {
        setError("duplicate");
        return;
      }

      setExes([...exes, { path: filePath, arguments: newArgs.trim() || undefined }]);
      setNewArgs("");
      setAdding(false);
    } catch {
      setError("pick");
    }
  }

  function fileNameOf(path: string) {
    return path.split(/[/\\]/).pop() || path;
  }

  function updateExe(index: number, patch: Partial<GameExecutable>) {
    setExes(exes.map((exe, i) => (i === index ? { ...exe, ...patch } : exe)));
  }

  function removeExe(index: number) {
    setExes(exes.filter((_, i) => i !== index));
  }

  /**
   * Promote an extra executable to the game's default launch target.
   *
   * `game.path` is what the hero Play button spawns, so making an extra the
   * default swaps the two entries: the chosen path becomes the main one (with
   * its arguments/admin flag), and the old main path becomes an extra so it can
   * still be launched from this dialog.
   */
  function makeDefault(index: number) {
    const chosen = exes[index];
    if (!chosen) return;
    const remaining = exes.filter((_, i) => i !== index);
    const previousMain: GameExecutable[] = game.path
      ? [
          {
            path: game.path,
            label: fileNameOf(game.path),
            arguments: game.launchArguments || undefined,
            runAsAdmin: game.runAsAdmin || undefined,
          },
        ]
      : [];
    const nextExtras = [...previousMain, ...remaining];
    updateGame(game.id, {
      path: chosen.path,
      launchArguments: chosen.arguments?.trim() ? chosen.arguments : undefined,
      runAsAdmin: chosen.runAsAdmin || undefined,
      extraExecutables: nextExtras.length > 0 ? nextExtras : undefined,
    });
  }

  async function copyPath(path: string) {
    if (!path) return;
    const copied = await copyTextToClipboard(path);
    if (!copied) return;
    setCopiedPath(path);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedPath(null), 1500);
  }

  function renderPath(path: string, label: string) {
    if (!path) return null;
    const isCopied = copiedPath === path;
    return (
      <div className="exe-picker-pathline">
        <button
          type="button"
          className="exe-picker-path"
          title={path}
          aria-label={t("game.execExtras.copyPath")}
          data-copied={isCopied ? "true" : undefined}
          onClick={() => void copyPath(path)}
        >
          <span className="exe-picker-path-text">{label}</span>
          <span className="exe-picker-path-icon" aria-hidden>
            {isCopied ? <Check size={12} /> : <Copy size={12} />}
          </span>
          {isCopied ? <span className="exe-picker-path-copied">{t("game.execExtras.copied")}</span> : null}
        </button>
        {missing.has(path) ? (
          <span className="exe-picker-chip exe-picker-chip--warning">
            <AlertTriangle size={11} aria-hidden />
            {t("game.execExtras.pathMissing")}
          </span>
        ) : null}
      </div>
    );
  }

  if (!open) return null;

  return createPortal(
    <div className="exe-picker-backdrop" onClick={onClose}>
      <div
        className="exe-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="exe-picker-header">
          <div className="exe-picker-heading">
            <h3 id={titleId}>{t("game.execExtras.chooserTitle")}</h3>
            <span className="exe-picker-game-name">{gameDisplayName(game)}</span>
          </div>
          <button
            type="button"
            className="exe-picker-close"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="exe-picker-list">
          {/* Main executable — launch-only, always the default target */}
          <div className="exe-picker-row exe-picker-row--main">
            <span className="exe-picker-glyph" aria-hidden>
              <Gamepad2 size={16} />
            </span>
            <div className="exe-picker-row-main">
              <span className="exe-picker-title" title={game.name}>
                {game.name}
              </span>
              {game.path ? renderPath(game.path, fileNameOf(game.path)) : null}
            </div>
            <span className="exe-picker-chip exe-picker-chip--default" title={t("game.execExtras.defaultHint")}>
              <span className="exe-picker-chip-dot" aria-hidden />
              {t("game.execExtras.main")}
            </span>
            <button
              type="button"
              className="exe-picker-launch"
              onClick={() => {
                onClose();
                launchGame(game);
              }}
              disabled={isRunning || missing.has(game.path)}
              title={t("game.execExtras.launchNamed", {
                label: game.path ? fileNameOf(game.path) : game.name,
              })}
            >
              <Play size={14} aria-hidden />
              {t("game.execExtras.launch")}
            </button>
          </div>

          {/* Additional executables — editable label / args, admin, launch, remove */}
          {exes.map((exe, index) => (
            <div className="exe-picker-row" key={`${exe.path}-${index}`}>
              <span className="exe-picker-glyph" aria-hidden>
                <Terminal size={16} />
              </span>
              <div className="exe-picker-row-main">
                <div className="exe-picker-fields">
                  <input
                    className="exe-picker-input exe-picker-input--label"
                    value={exe.label || ""}
                    onChange={(event) => updateExe(index, { label: event.target.value || undefined })}
                    placeholder={t("game.execExtras.labelPlaceholderShort")}
                    aria-label={t("game.execExtras.labelField")}
                  />
                  <input
                    className="exe-picker-input exe-picker-input--args"
                    value={exe.arguments || ""}
                    onChange={(event) =>
                      updateExe(index, { arguments: event.target.value })
                    }
                    placeholder={t("game.execExtras.argsPlaceholderShort")}
                    aria-label={t("game.execExtras.argsField")}
                    spellCheck={false}
                  />
                </div>
                <div className="exe-picker-meta">
                  {renderPath(exe.path, fileNameOf(exe.path))}
                  {exe.runAsAdmin ? (
                    <span className="exe-picker-chip exe-picker-chip--admin">
                      <Shield size={11} aria-hidden />
                      {t("game.execExtras.adminBadge")}
                    </span>
                  ) : null}
                  {exe.arguments?.trim() ? (
                    <span className="exe-picker-chip exe-picker-chip--args" title={exe.arguments}>
                      <span className="exe-picker-chip-label">{t("game.execExtras.argsField")}</span>
                      <span className="exe-picker-chip-value">{exe.arguments}</span>
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="exe-picker-actions">
                <button
                  type="button"
                  className="exe-picker-icon"
                  onClick={() => makeDefault(index)}
                  title={t("game.execExtras.makeDefault")}
                  aria-label={t("game.execExtras.makeDefault")}
                >
                  <Star size={15} />
                </button>
                <button
                  type="button"
                  className={`exe-picker-icon${exe.runAsAdmin ? " is-active" : ""}`}
                  onClick={() => updateExe(index, { runAsAdmin: !exe.runAsAdmin })}
                  title={t("game.execExtras.runAsAdmin")}
                  aria-label={t("game.execExtras.runAsAdmin")}
                  aria-pressed={!!exe.runAsAdmin}
                >
                  <Shield size={15} />
                </button>
                <button
                  type="button"
                  className="exe-picker-launch"
                  onClick={() => {
                    onClose();
                    onLaunch(exe);
                  }}
                  disabled={isRunning || missing.has(exe.path)}
                  title={t("game.execExtras.launchNamed", { label: fileNameOf(exe.path) })}
                >
                  <Play size={14} aria-hidden />
                  {t("game.execExtras.launch")}
                </button>
                <button
                  type="button"
                  className="exe-picker-icon exe-picker-icon--danger"
                  onClick={() => removeExe(index)}
                  title={t("game.execExtras.remove")}
                  aria-label={t("game.execExtras.remove")}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}

          {exes.length === 0 ? (
            <p className="exe-picker-empty">{t("game.execExtras.empty")}</p>
          ) : null}
        </div>

        {adding ? (
          <div className="exe-picker-add">
            <div className="exe-picker-add-row">
              <input
                className="exe-picker-input"
                value={newArgs}
                onChange={(event) => setNewArgs(event.target.value)}
                placeholder={t("game.execExtras.argsPlaceholder")}
                aria-label={t("game.execExtras.argsField")}
                spellCheck={false}
              />
              <button type="button" className="exe-picker-add-browse" onClick={() => void browseNewExe()}>
                <FolderOpen size={14} aria-hidden />
                {t("game.execExtras.browseFile")}
              </button>
            </div>
            <div className="exe-picker-add-footer">
              {error ? (
                <span className="exe-picker-error" role="alert">
                  <AlertTriangle size={12} aria-hidden />
                  {error === "duplicate"
                    ? t("game.execExtras.duplicate")
                    : t("game.execExtras.error")}
                </span>
              ) : (
                <span />
              )}
              <button type="button" className="exe-picker-link" onClick={cancelAdding}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="exe-picker-add-btn" onClick={startAdding}>
            <Plus size={14} aria-hidden />
            {t("game.execExtras.add")}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
