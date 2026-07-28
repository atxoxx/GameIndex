import { useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import type { Emulator } from "../../types/emulator";
import { formatSize } from "../../types/game";
import { gameTotalBytes } from "./utils";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { accentForPlatform, KNOWN_EMULATORS } from "../../types/emulator";
import { Button } from "../../components/ui";

interface Props {
  emulator: Emulator;
  /** ROM games linked to this emulator (already filtered). */
  roms: Game[];
  /** On-disk size of the emulator's install folder (the directory holding
   *  the executable). `undefined` = not yet measured; `null` = measure failed. */
  installBytes?: number | null;
  measuring: boolean;
  /** Re-measure the emulator install folder. */
  onMeasure: () => void;
  /** Reveal a ROM's measured folder in the OS file manager. */
  onOpenRomFolder: (g: Game) => void;
}

/** One collapsible card in the Storage → Emulators view. Shows the emulator's
 *  global footprint (install folder + every linked ROM's game + mods size)
 *  and lists each ROM with its own per-game size inside. */
export function EmulatorStorageCard({
  emulator,
  roms,
  installBytes,
  measuring,
  onMeasure,
  onOpenRomFolder,
}: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(true);

  const romBytes = roms.reduce((s, g) => s + gameTotalBytes(g), 0);
  const globalBytes = (installBytes ?? 0) + romBytes;
  const accent = accentForPlatform(emulator.platform);
  const known = KNOWN_EMULATORS.find((k) => k.name === emulator.name);

  async function openInstallFolder() {
    if (!emulator.executablePath) return;
    try {
      await invoke("open_folder", { path: emulator.executablePath });
    } catch (err) {
      showToast(t("storage.couldNotOpenFolder", { error: err }), "error");
    }
  }

  return (
    <li
      className="emu-storage-card"
      style={{ "--emu-accent": accent } as CSSProperties}
    >
      <div className="emu-storage-card-head">
        <button
          type="button"
          className="emu-storage-card-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
           <span className="emu-storage-card-glyph" aria-hidden="true">
             {known?.logo || emulator.iconUrl ? (
               <img src={known?.logo ?? emulator.iconUrl} alt="" />
             ) : (
               <span className="emu-glyph-fallback">{emulator.name.charAt(0)}</span>
             )}
           </span>
          <span className="emu-storage-card-meta">
            <span className="emu-storage-card-name">{emulator.name}</span>
            <span className="emu-storage-card-platform">{emulator.platform}</span>
          </span>
        </button>

        <div className="emu-storage-card-size">
          <span className="emu-storage-card-size-value">
            {formatSize(globalBytes, unit)}
          </span>
          <span className="emu-storage-card-size-breakdown">
            {installBytes != null
              ? t("storage.emuBreakdown", {
                  install: formatSize(installBytes, unit),
                  roms: formatSize(romBytes, unit),
                })
              : t("storage.emuRomOnly", { roms: formatSize(romBytes, unit) })}
          </span>
        </div>

        <div className="emu-storage-card-actions">
          <span
            className={`emu-storage-card-badge ${
              emulator.executablePath ? "is-configured" : "is-notconfigured"
            }`}
          >
            {emulator.executablePath
              ? t("emulators.status.configured")
              : t("emulators.status.notConfigured")}
          </span>
          {installBytes == null ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onMeasure}
              isLoading={measuring}
              title={t("storage.measureEmulator")}
            >
              {t("storage.measure")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMeasure}
              isLoading={measuring}
              title={t("storage.remeasure")}
            >
              {t("storage.remeasure")}
            </Button>
          )}
          {emulator.executablePath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={openInstallFolder}
              title={t("storage.openInstall")}
            >
              {t("downloadRow.openFolder")}
            </Button>
          )}
          <button
            type="button"
            className="emu-storage-card-chevron"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("common.collapse") : t("common.expand")}
          >
            {"\u25BE"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="emu-storage-card-body">
          {roms.length === 0 ? (
            <p className="emu-storage-card-empty">{t("emulators.detail.emptyGames")}</p>
          ) : (
            <ul className="emu-storage-card-roms">
              {roms.map((g) => {
                const gb = gameTotalBytes(g);
                const hasMods = (g.modsSizeBytes ?? 0) > 0;
                return (
                  <li key={g.id} className="emu-storage-rom">
                    <span className="emu-storage-rom-name" title={g.name}>
                      {g.name}
                    </span>
                    <span className="emu-storage-rom-size">
                      {formatSize(gb, unit)}
                      {hasMods && (
                        <span className="emu-storage-rom-mods">
                          {" + "}
                          {formatSize(g.modsSizeBytes ?? 0, unit)}
                        </span>
                      )}
                    </span>
                    {g.sizeRootPath && (
                      <button
                        type="button"
                        className="emu-storage-rom-open"
                        onClick={() => onOpenRomFolder(g)}
                        title={t("storageRow.openFolder")}
                        aria-label={t("storageRow.openFolder")}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
