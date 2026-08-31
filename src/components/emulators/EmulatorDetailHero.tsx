import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Emulator, EmuRow, KnownEmulator } from "../../types/emulator";
import { Button, Tooltip } from "../ui";

interface DetailHeroProps {
  selectedRow: EmuRow;
  scanningId: string | null;
  onLaunchExe: (emu: Emulator) => void;
  onScan: (emu: Emulator) => void;
  onEdit: (emu: Emulator) => void;
  onDelete: (emu: Emulator) => void;
  onOpenFolder: (path: string) => void;
  onAddKnown: (known: KnownEmulator) => void;
  onOpenUrl: (url: string) => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function truncateMiddle(path: string, max = 50): string {
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

function relativeTime(
  ts: number,
  t: (key: string, vars?: Record<string, unknown>) => string
): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  if (diff < min) return t("emulators.relative.justNow");
  if (diff < hr) return t("emulators.relative.minutes", { n: Math.floor(diff / min) });
  if (diff < day) return t("emulators.relative.hours", { n: Math.floor(diff / hr) });
  if (diff < 30 * day) return t("emulators.relative.days", { n: Math.floor(diff / day) });
  return formatDate(ts);
}

function EmulatorGlyph({
  logo,
  glyph,
  className,
}: {
  logo?: string;
  glyph: string;
  className: string;
}) {
  if (logo) {
    return (
      <img
        className={`${className}-img`}
        src={logo}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <span className={className}>{glyph}</span>;
}

function EmulatorDetailHeroBase({
  selectedRow,
  scanningId,
  onLaunchExe,
  onScan,
  onEdit,
  onDelete,
  onOpenFolder,
  onAddKnown,
  onOpenUrl,
}: DetailHeroProps) {
  const { t } = useLanguage();
  const isScanning = scanningId === selectedRow.id;

  if (!selectedRow.added) {
    return (
      <div className="emulators-detail-header-card">
        <header
          className="emu-detail-banner"
          style={{ ["--emu-accent" as string]: selectedRow.accent }}
        >
          <EmulatorGlyph
            logo={selectedRow.logo}
            glyph={selectedRow.glyph}
            className="emu-detail-glyph"
          />
          <div className="emu-detail-titles">
            <div className="emu-detail-title-row">
              <h2 className="emu-detail-name">{selectedRow.name}</h2>
              <span className="emu-status-pill emu-status-pill--lg is-catalog">
                {t("emulators.status.notAdded")}
              </span>
            </div>
            <span className="emu-detail-platform">{selectedRow.platform}</span>
          </div>
        </header>

        <div className="emu-detail-body">
          {selectedRow.known?.description && (
            <p className="emu-detail-desc">{selectedRow.known.description}</p>
          )}

          <div className="emulators-notadded">
            <EmulatorGlyph
              logo={selectedRow.logo}
              glyph={selectedRow.glyph}
              className="emulators-notadded-glyph"
            />
            <h3>{t("emulators.detail.addTitle")}</h3>
            <p>{t("emulators.detail.addDesc")}</p>
            <div className="emulators-notadded-actions">
              {selectedRow.known?.githubUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={
                    <svg {...ICON}>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  }
                  onClick={() => onOpenUrl(selectedRow.known!.githubUrl!)}
                >
                  {t("emulators.github")}
                </Button>
              )}
              <Button
                variant="primary"
                leftIcon={
                  <svg {...ICON}>
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                }
                onClick={() => selectedRow.known && onAddKnown(selectedRow.known)}
              >
                {t("emulators.detail.addCta", { name: selectedRow.name })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="emulators-detail-header-card">
      <header
        className="emu-detail-banner"
        style={{ ["--emu-accent" as string]: selectedRow.accent }}
      >
        <EmulatorGlyph
          logo={selectedRow.logo}
          glyph={selectedRow.glyph}
          className="emu-detail-glyph"
        />
        <div className="emu-detail-titles">
          <div className="emu-detail-title-row">
            <h2 className="emu-detail-name">{selectedRow.name}</h2>
            <span
              className={`emu-status-pill emu-status-pill--lg ${
                selectedRow.configured ? "is-configured" : "is-unconfigured"
              }`}
            >
              {selectedRow.configured
                ? t("emulators.status.configured")
                : t("emulators.status.notConfigured")}
            </span>
          </div>
          <span className="emu-detail-platform">{selectedRow.platform}</span>
        </div>
      </header>

      <div className="emu-detail-body">
        {selectedRow.known?.description && (
          <p className="emu-detail-desc">{selectedRow.known.description}</p>
        )}

        <div className="emu-detail-meta-grid">
          <div className="emu-detail-meta-tile">
            <span className="emu-detail-meta-label">
              <svg {...ICON}>
                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              {t("emulators.detail.executable")}
            </span>
            <span
              className="emu-detail-meta-value emu-mono"
              title={selectedRow.emulator?.executablePath}
            >
              {selectedRow.emulator?.executablePath
                ? truncateMiddle(selectedRow.emulator.executablePath)
                : "—"}
            </span>
          </div>

          <div className="emu-detail-meta-tile">
            <div className="emu-detail-meta-tile-head">
              <span className="emu-detail-meta-label">
                <svg {...ICON}>
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                {t("emulators.detail.romFolder")}
              </span>
              {selectedRow.emulator?.romFolder && (
                <button
                  type="button"
                  className="emu-meta-folder-btn"
                  title={t("emulators.openFolder")}
                  onClick={() =>
                    selectedRow.emulator && onOpenFolder(selectedRow.emulator.romFolder)
                  }
                >
                  <svg {...ICON}>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>
              )}
            </div>
            <span
              className="emu-detail-meta-value"
              title={selectedRow.emulator?.romFolder}
            >
              {selectedRow.emulator?.romFolder
                ? truncateMiddle(selectedRow.emulator.romFolder)
                : "—"}
            </span>
          </div>

          <div className="emu-detail-meta-tile">
            <span className="emu-detail-meta-label">
              <svg {...ICON}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {t("emulators.detail.lastScanned")}
            </span>
            <span className="emu-detail-meta-value">
              {selectedRow.scannedAt
                ? relativeTime(selectedRow.scannedAt, t)
                : t("emulators.neverScanned")}
            </span>
          </div>

          <div className="emu-detail-meta-tile">
            <span className="emu-detail-meta-label">
              <svg {...ICON}>
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              {t("emulators.argumentsTemplate")}
            </span>
            <span className="emu-detail-meta-value emu-mono">
              {selectedRow.emulator?.argumentsTemplate
                ? selectedRow.emulator.argumentsTemplate
                : "—"}
            </span>
          </div>
        </div>

        {selectedRow.emulator?.notes && (
          <p className="emu-detail-notes">{selectedRow.emulator.notes}</p>
        )}

        <div className="emu-detail-actions">
          {selectedRow.configured ? (
            <Button
              variant="primary"
              leftIcon={
                <svg {...ICON}>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              }
              onClick={() =>
                selectedRow.emulator && onLaunchExe(selectedRow.emulator)
              }
            >
              {t("emulators.launchExe")}
            </Button>
          ) : (
            <Tooltip content={t("emulators.launcherNotSet")} placement="bottom">
              <Button
                variant="primary"
                leftIcon={
                  <svg {...ICON}>
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                }
                disabled
              >
                {t("emulators.launchExe")}
              </Button>
            </Tooltip>
          )}

          <Button
            variant="secondary"
            leftIcon={
              <svg {...ICON}>
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            }
            isLoading={isScanning}
            onClick={() => selectedRow.emulator && onScan(selectedRow.emulator)}
          >
            {isScanning ? t("emulators.scanning") : t("emulators.scan")}
          </Button>

          <Button
            variant="ghost"
            leftIcon={
              <svg {...ICON}>
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            }
            onClick={() => selectedRow.emulator && onEdit(selectedRow.emulator)}
          >
            {t("emulators.edit")}
          </Button>

          {selectedRow.known?.githubUrl && (
            <Button
              variant="ghost"
              leftIcon={
                <svg {...ICON}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              }
              onClick={() => onOpenUrl(selectedRow.known!.githubUrl!)}
            >
              {t("emulators.github")}
            </Button>
          )}

          <span className="emu-detail-actions-spacer" />

          <Button
            variant="danger"
            leftIcon={
              <svg {...ICON}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            }
            onClick={() => selectedRow.emulator && onDelete(selectedRow.emulator)}
          >
            {t("emulators.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default memo(EmulatorDetailHeroBase);
