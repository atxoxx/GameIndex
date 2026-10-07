import { memo, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { Button, ContextMenu, type ContextMenuItem } from "../ui";
import { formatBytesShort } from "../../types/download";
import type { Emulator, KnownEmulator } from "../../types/emulator";
import {
  emulatorSetupSteps,
  isEmulatorReady,
  setupProgress,
  type EmulatorVisual,
  type SetupStepKey,
} from "./emulatorUi";
import EmulatorSetupChecklist from "./EmulatorSetupChecklist";

interface HeroProps {
  emulator: Emulator;
  known?: KnownEmulator;
  visual: EmulatorVisual;
  romCount: number;
  totalSizeBytes: number;
  lastScanned?: number;
  lastPlayed?: number;
  scanning: boolean;
  onLaunchExe: () => void;
  onScan: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFolder: (folder: string) => void;
  onCheckBios: () => void;
  onFindRomFolders: () => void;
  onOpenUrl: (url: string) => void;
  onFixSetup: (key: SetupStepKey) => void;
}

function formatDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

function GitHubMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.72-1.55-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  );
}

function EmulatorDetailHeroBase({
  emulator,
  known,
  visual,
  romCount,
  totalSizeBytes,
  lastScanned,
  lastPlayed,
  scanning,
  onLaunchExe,
  onScan,
  onEdit,
  onDelete,
  onOpenFolder,
  onCheckBios,
  onFindRomFolders,
  onOpenUrl,
  onFixSetup,
}: HeroProps) {
  const { t } = useLanguage();
  const ready = isEmulatorReady(emulator);
  const steps = emulatorSetupSteps(emulator, romCount);
  const progress = setupProgress(steps);

  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

  const openMore = () => {
    const rect = moreBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMoreMenu({ x: rect.right, y: rect.bottom + 4 });
  };

  const githubUrl = known?.githubUrl;
  const romFolder = emulator.romFolder;

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [
      {
        id: "check-bios",
        label: t("emulators.bios.check"),
        icon: <AlertTriangle size={15} />,
        onSelect: () => {
          setMoreMenu(null);
          onCheckBios();
        },
      },
      {
        id: "find-rom-folders",
        label: t("emulators.discovery.romFolders"),
        icon: <FolderOpen size={15} />,
        onSelect: () => {
          setMoreMenu(null);
          onFindRomFolders();
        },
      },
    ];

    if (romFolder.trim().length > 0) {
      items.push({
        id: "open-folder",
        label: t("emulators.openFolder"),
        icon: <FolderOpen size={15} />,
        onSelect: () => {
          setMoreMenu(null);
          onOpenFolder(romFolder);
        },
      });
    }

    if (githubUrl) {
      items.push({
        id: "github",
        label: t("emulators.github"),
        icon: <GitHubMark />,
        onSelect: () => {
          setMoreMenu(null);
          onOpenUrl(githubUrl);
        },
      });
    }

    items.push({ id: "sep-delete", separator: true });
    items.push({
      id: "delete",
      label: t("emulators.delete"),
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: () => {
        setMoreMenu(null);
        onDelete();
      },
    });

    return items;
  }, [
    t,
    romFolder,
    githubUrl,
    onCheckBios,
    onFindRomFolders,
    onOpenFolder,
    onOpenUrl,
    onDelete,
  ]);

  return (
    <div className="emulators-detail-header-card">
      <header
        className="emu-detail-banner"
        style={{ ["--emu-accent" as string]: visual.accent }}
      >
        {visual.logo ? (
          <img
            className="emu-detail-glyph-img"
            src={visual.logo}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="emu-detail-glyph">{visual.glyph}</span>
        )}
        <div className="emu-detail-titles">
          <div className="emu-detail-title-row">
            <h2 className="emu-detail-name">{emulator.name}</h2>
            <span
              className={`emu-status-pill emu-status-pill--lg ${
                ready ? "is-configured" : "is-unconfigured"
              }`}
            >
              {ready
                ? t("emulators.status.configured")
                : t("emulators.status.notConfigured")}
            </span>
          </div>
          <span className="emu-detail-platform">{emulator.platform}</span>
        </div>
      </header>

      <div className="emu-detail-body">
        {known?.description && (
          <p className="emu-detail-desc">{known.description}</p>
        )}

        <EmulatorSetupChecklist
          steps={steps}
          progress={progress}
          onFix={onFixSetup}
        />

        <div className="emu-quickstats">
          <div className="emu-quickstat">
            <span className="emu-quickstat-label">
              {t("emulators.stats.games")}
            </span>
            <span className="emu-quickstat-value">{romCount}</span>
          </div>
          <div className="emu-quickstat">
            <span className="emu-quickstat-label">{t("emulators.games.size")}</span>
            <span className="emu-quickstat-value">
              {totalSizeBytes > 0 ? formatBytesShort(totalSizeBytes) : "—"}
            </span>
          </div>
          {lastPlayed != null && (
            <div className="emu-quickstat">
              <span className="emu-quickstat-label">{t("game.lastPlayed")}</span>
              <span className="emu-quickstat-value">
                {relativeTime(lastPlayed, t)}
              </span>
            </div>
          )}
          <div className="emu-quickstat">
            <span className="emu-quickstat-label">
              {t("emulators.detail.lastScanned")}
            </span>
            <span className="emu-quickstat-value">
              {lastScanned
                ? relativeTime(lastScanned, t)
                : t("emulators.neverScanned")}
            </span>
          </div>
        </div>

        <div className="emu-hero-actions">
          {ready ? (
            <Button
              variant="primary"
              leftIcon={<Play size={16} />}
              onClick={onLaunchExe}
            >
              {t("emulators.launchExe")}
            </Button>
          ) : (
            <Button
              variant="primary"
              leftIcon={<Pencil size={16} />}
              onClick={onEdit}
            >
              {t("emulators.setup.title")}
            </Button>
          )}

          <Button
            variant="secondary"
            leftIcon={<RefreshCw size={16} />}
            isLoading={scanning}
            onClick={onScan}
          >
            {scanning ? t("emulators.scanning") : t("emulators.scan")}
          </Button>

          <Button
            variant="ghost"
            leftIcon={<Pencil size={16} />}
            onClick={onEdit}
          >
            {t("emulators.edit")}
          </Button>

          <Button
            ref={moreBtnRef}
            variant="ghost"
            iconOnly
            title={t("emulators.actions.more")}
            aria-label={t("emulators.actions.more")}
            leftIcon={<MoreHorizontal size={16} />}
            onClick={openMore}
          />
        </div>
      </div>

      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          items={menuItems}
          onClose={() => setMoreMenu(null)}
          ariaLabel={t("emulators.actions.more")}
        />
      )}
    </div>
  );
}

export default memo(EmulatorDetailHeroBase);
