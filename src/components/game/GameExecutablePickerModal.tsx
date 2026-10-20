import { useState } from "react";
import { createPortal } from "react-dom";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { Play, Plus, Shield, Trash2 } from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { gameDisplayName, type Game, type GameExecutable } from "../../types/game";

/**
 * GameExecutablePickerModal
 *
 * Opens from the hero play button's chevron on games that have extra
 * executables configured. Lists the main executable (launch-only, it is
 * always the default target) and every additional executable with its
 * per-exe label / arguments / run-as-admin settings, launches on click,
 * and lets the user add or remove executables right here.
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
  const [adding, setAdding] = useState(false);
  const [newArgs, setNewArgs] = useState("");
  const [error, setError] = useState(false);

  const exes = game.extraExecutables || [];

  function setExes(next: GameExecutable[]) {
    updateGame(game.id, { extraExecutables: next.length > 0 ? next : undefined });
  }

  async function browseNewExe() {
    setError(false);
    try {
      const filePath = await pickFile({
        multiple: false,
        directory: false,
        title: t("game.execExtras.browseButton"),
        filters: [
          { name: "Executables", extensions: ["exe", "bat", "lnk", "cmd"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (typeof filePath === "string") {
        setExes([
          ...exes,
          {
            path: filePath,
            arguments: newArgs.trim() || undefined,
          },
        ]);
        setNewArgs("");
        setAdding(false);
      }
    } catch {
      setError(true);
    }
  }

  function fileNameOf(path: string) {
    return path.split(/[/\\]/).pop() || path;
  }

  function updateExe(index: number, patch: Partial<GameExecutable>) {
    setExes(exes.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function removeExe(index: number) {
    setExes(exes.filter((_, i) => i !== index));
  }

  if (!open) return null;

  const fileName = fileNameOf(game.path);

  // Portaled to document.body: the game hero ancestors build their own
  // stacking contexts (hero gradients / transforms), which would let the
  // sticky game sub-nav and quick-stats bar paint over the dialog even
  // with a high z-index.
  return createPortal(
    <div className="exe-picker-backdrop" onClick={onClose}>
      <div
        className="exe-picker"
        role="dialog"
        aria-label={t("game.execExtras.chooserTitle")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="exe-picker-header">
          <div className="exe-picker-header-text">
            <h3>{t("game.execExtras.chooserTitle")}</h3>
            <span className="exe-picker-game-name">{gameDisplayName(game)}</span>
          </div>
          <button className="exe-picker-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Main executable — launch-only, always the default target */}
        <div className="exe-picker-row">
          <div className="exe-picker-row-main">
            <span className="exe-picker-label">{game.name}</span>
            <span className="exe-picker-path" title={game.path}>{fileName}</span>
          </div>
          <button
            className="exe-picker-launch"
            onClick={() => {
              onClose();
              launchGame(game);
            }}
            disabled={isRunning}
          >
            <Play size={14} />
            {t("game.execExtras.launch")}
          </button>
          <span className="exe-picker-badge">{t("game.execExtras.main")}</span>
        </div>

        {/* Additional executables — editable label / args / admin, launch, remove */}
        {exes.map((exe, i) => (
          <div className="exe-picker-row exe-picker-row--alt" key={`${exe.path}-${i}`}>
            <div className="exe-picker-row-main">
              <input
                className="exe-picker-input"
                value={exe.label || ""}
                onChange={(e) => updateExe(i, { label: e.target.value.trim() || undefined })}
                placeholder={t("game.execExtras.labelPlaceholder")}
              />
              <input
                className="exe-picker-input"
                value={exe.arguments || ""}
                onChange={(e) => updateExe(i, { arguments: e.target.value.trim() || undefined })}
                placeholder={t("game.execExtras.argsPlaceholder")}
              />
              <span className="exe-picker-path" title={exe.path}>{fileNameOf(exe.path)}</span>
            </div>
            <button
              className="exe-picker-launch"
              onClick={() => {
                onClose();
                onLaunch(exe);
              }}
              disabled={isRunning}
            >
              <Play size={14} />
              {t("game.execExtras.launch")}
            </button>
            <button
              className={`exe-picker-admin ${exe.runAsAdmin ? "active" : ""}`}
              onClick={() => updateExe(i, { runAsAdmin: !exe.runAsAdmin })}
              title={t("game.execExtras.runAsAdmin")}
              aria-label={t("game.execExtras.runAsAdmin")}
            >
              <Shield size={14} />
            </button>
            <button className="exe-picker-remove" onClick={() => removeExe(i)} title={t("game.execExtras.remove")}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {exes.length === 0 && (
          <p className="exe-picker-empty">{t("game.execExtras.empty")}</p>
        )}

        {adding ? (
          <div className="exe-picker-add-form">
            <input
              className="exe-picker-input"
              value={newArgs}
              onChange={(e) => setNewArgs(e.target.value)}
              placeholder={t("game.execExtras.argsPlaceholder")}
            />
            {error && <span className="exe-picker-error">{t("game.execExtras.error")}</span>}
            <button className="exe-picker-add-btn" onClick={browseNewExe}>
              <Play size={14} />
              {t("game.execExtras.browseButton")}
            </button>
          </div>
        ) : (
          <button className="exe-picker-add-btn" onClick={() => setAdding(true)}>
            <Plus size={14} />
            {t("game.execExtras.add")}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
