import { useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import type { Game } from "../../types/game";

interface ModInstallModalProps {
  game: Game;
  modsRoot?: string;
  isOpen: boolean;
  onClose: () => void;
  onScan: () => Promise<unknown>;
}

export default function ModInstallModal({
  game,
  modsRoot,
  isOpen,
  onClose,
  onScan,
}: ModInstallModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const handlePickAndOpen = async () => {
    try {
      const picked = await openDialog({
        multiple: true,
        directory: false,
        title: t("mods.installMod"),
        filters: [
          {
            name: "Mod Files & Archives",
            extensions: ["zip", "7z", "rar", "pak", "dll", "esp", "esm", "esl", "txt"],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!picked) return;
      
      if (!modsRoot) {
        showToast(t("mods.installFailed", { error: "No mods folder selected" }), "error");
        return;
      }
      const files = typeof picked === "string" ? [picked] : picked;
      for (const file of files) {
        const lower = file.toLowerCase();
        if (lower.endsWith(".zip")) {
          const count = await invoke<number>("mods_install_archive", {
            gameId: game.id,
            archivePath: file,
            destination: modsRoot,
          });
          showToast(t("mods.installSuccess", { count: String(count) }), "success");
        } else {
          await invoke("open_folder", { path: modsRoot });
          showToast(t("mods.installModHint"), "info");
        }
      }
    } catch (e) {
      showToast(t("mods.installFailed", { error: String(e) }), "error");
    }
  };

  const handleOpenModsFolder = () => {
    if (!modsRoot) return;
    invoke("open_folder", { path: modsRoot })
      .then(() => showToast(t("mods.openFolder"), "info"))
      .catch((e) => showToast(String(e), "error"));
  };

  const handleRescanAndClose = async () => {
    setBusy(true);
    try {
      await onScan();
      showToast(t("mods.scanComplete", { count: "..." }), "success");
      onClose();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="mods-modal-backdrop" onClick={onClose}>
      <div
        className="mods-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mods-install-title"
      >
        <div className="mods-modal-header">
          <div>
            <h3 id="mods-install-title">{t("mods.installMod")}</h3>
            <p className="mods-modal-subtitle">{game.name}</p>
          </div>
          <button
            type="button"
            className="mods-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mods-install-body">
          <div className="mods-install-step">
            <div className="mods-install-step-num">1</div>
            <div className="mods-install-step-content">
              <h4>{t("mods.installModHint")}</h4>
              <p>
                Drop or extract your mod archives (<code>.zip</code>, <code>.7z</code>, <code>.rar</code>, <code>.pak</code>, <code>.dll</code>, <code>.esp</code>) into the active game mods directory.
              </p>
              {modsRoot && (
                <div className="mods-install-path-box">
                  <code>{modsRoot}</code>
                  <Button variant="secondary" size="sm" onClick={handleOpenModsFolder}>
                    {t("mods.openFolder")}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="mods-install-step">
            <div className="mods-install-step-num">2</div>
            <div className="mods-install-step-content">
              <h4>{t("mods.rescan")}</h4>
              <p>
                Once files are placed into the folder, click Scan to automatically detect new plugins, BepInEx DLLs, and Unreal paks.
              </p>
            </div>
          </div>
        </div>

        <div className="mods-modal-actions">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" size="sm" onClick={handlePickAndOpen}>
            {t("mods.installMod")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleRescanAndClose}
            isLoading={busy}
          >
            {t("mods.rescan")}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
