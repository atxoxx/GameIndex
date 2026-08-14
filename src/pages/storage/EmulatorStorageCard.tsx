import { useState, useMemo } from "react";
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
import { Badge, Button } from "../../components/ui";

interface Props {
  emulator: Emulator;
  roms: Game[];
  installBytes?: number | null;
  measuring: boolean;
  onMeasure: () => void;
  onOpenRomFolder: (g: Game) => void;
}

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
  const [romSearch, setRomSearch] = useState("");

  const romBytes = useMemo(() => roms.reduce((s, g) => s + gameTotalBytes(g), 0), [roms]);
  const globalBytes = (installBytes ?? 0) + romBytes;
  const accent = accentForPlatform(emulator.platform);
  const known = KNOWN_EMULATORS.find((k) => k.name === emulator.name);
  const bodyId = `emu-storage-body-${emulator.id}`;

  const filteredRoms = useMemo(() => {
    if (!romSearch.trim()) return roms;
    const q = romSearch.trim().toLowerCase();
    return roms.filter((g) => g.name.toLowerCase().includes(q));
  }, [roms, romSearch]);

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
      className={`emu-storage-card ${expanded ? "emu-storage-card--expanded" : "emu-storage-card--collapsed"}`}
      style={{ "--emu-accent": accent } as CSSProperties}
    >
      <div className="emu-storage-card-head">
        <button
          type="button"
          className="emu-storage-card-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          <div className="emu-storage-card-glyph" aria-hidden="true">
            {known?.logo || emulator.iconUrl ? (
              <img src={known?.logo ?? emulator.iconUrl} alt="" />
            ) : (
              <span className="emu-glyph-fallback">{emulator.name.charAt(0)}</span>
            )}
          </div>
          <div className="emu-storage-card-meta">
            <div className="emu-storage-card-name-line">
              <span className="emu-storage-card-name">{emulator.name}</span>
              <span className="emu-storage-platform-tag">{emulator.platform}</span>
            </div>
            <span className="emu-storage-card-count">
              {t("storage.gamesCount", { count: roms.length, plural: roms.length === 1 ? "" : "s" })}
            </span>
          </div>
        </button>

        {/* Global size metric */}
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

        {/* Action strip */}
        <div className="emu-storage-card-actions">
          <Badge
            variant={emulator.executablePath ? "success" : "warning"}
            size="sm"
            dot
          >
            {emulator.executablePath
              ? t("emulators.status.configured")
              : t("emulators.status.notConfigured")}
          </Badge>

          <Button
            variant={installBytes == null ? "secondary" : "ghost"}
            size="sm"
            onClick={onMeasure}
            isLoading={measuring}
            title={t("storage.measureEmulator")}
          >
            {installBytes == null ? t("storage.measure") : t("storage.remeasure")}
          </Button>

          {emulator.executablePath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={openInstallFolder}
              title={t("storage.openInstall")}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              }
            >
              {t("downloadRow.openFolder")}
            </Button>
          )}

          <button
            type="button"
            className="emu-storage-card-chevron"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("common.collapse") : t("common.expand")}
            aria-controls={bodyId}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="emu-storage-card-body" id={bodyId}>
          {/* Optional ROM search when there are more than 4 ROMs */}
          {roms.length > 4 && (
            <div className="emu-storage-card-search-bar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder={t("storage.searchPlaceholder")}
                value={romSearch}
                onChange={(e) => setRomSearch(e.target.value)}
                className="emu-storage-search-input"
              />
              {romSearch && (
                <button
                  type="button"
                  className="emu-storage-search-clear"
                  onClick={() => setRomSearch("")}
                >
                  ×
                </button>
              )}
            </div>
          )}

          {/* ROMs Table Header */}
          {filteredRoms.length > 0 && (
            <div className="emu-storage-roms-header">
              <span className="emu-th emu-th--name">{t("storageRow.game")}</span>
              <span className="emu-th emu-th--size">{t("storagePage.trackedSize")}</span>
              <span className="emu-th emu-th--action">{t("storagePage.path")}</span>
            </div>
          )}

          {filteredRoms.length === 0 ? (
            <div className="emu-storage-card-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <line x1="6" y1="12" x2="10" y2="12" />
                <line x1="8" y1="10" x2="8" y2="14" />
                <circle cx="15" cy="13" r="1" />
                <circle cx="18" cy="11" r="1" />
              </svg>
              <p>{t("emulators.detail.emptyGames")}</p>
            </div>
          ) : (
            <ul className="emu-storage-card-roms">
              {filteredRoms.map((g) => {
                const total = gameTotalBytes(g);
                const hasMods = (g.modsSizeBytes ?? 0) > 0;
                const path = g.sizeRootPath || g.path;

                return (
                  <li key={g.id} className="emu-storage-rom">
                    <div className="emu-storage-rom-left">
                      {g.coverArtUrl || g.iconUrl ? (
                        <img
                          src={g.coverArtUrl || g.iconUrl}
                          alt=""
                          className="emu-storage-rom-thumb"
                          loading="lazy"
                        />
                      ) : (
                        <div className="emu-storage-rom-icon-box">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="2" y="6" width="20" height="12" rx="2" />
                            <line x1="6" y1="12" x2="10" y2="12" />
                            <line x1="8" y1="10" x2="8" y2="14" />
                          </svg>
                        </div>
                      )}
                      <span className="emu-storage-rom-name" title={g.name}>
                        {g.name}
                      </span>
                    </div>

                    <div className="emu-storage-rom-size-cell">
                      {hasMods && (g.sizeBytes ?? 0) > 0 ? (
                        <div className="emu-storage-rom-equation">
                          <span className="emu-storage-rom-formula">
                            {formatSize(g.sizeBytes ?? 0, unit)} + {formatSize(g.modsSizeBytes ?? 0, unit)} =
                          </span>
                          <span className="emu-storage-rom-total">
                            {formatSize(total, unit)}
                          </span>
                        </div>
                      ) : (
                        <span className="emu-storage-rom-total">
                          {formatSize(total, unit)}
                        </span>
                      )}
                    </div>

                    <div className="emu-storage-rom-actions-cell">
                      {path ? (
                        <button
                          type="button"
                          className="emu-storage-rom-open-btn"
                          onClick={() => onOpenRomFolder(g)}
                          title={path}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                          </svg>
                          <span>{t("downloadRow.openFolder")}</span>
                        </button>
                      ) : (
                        <span className="emu-storage-rom-no-path">—</span>
                      )}
                    </div>
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
