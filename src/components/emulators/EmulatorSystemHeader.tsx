// Compact identity header for the selected system inside the Emulators
// workbench. Replaces the tall hero card: one row of art + identity + status,
// a quiet stats line and the actions that matter, so the ROM workspace starts
// above the fold.

import { useMemo, useRef, useState } from "react";
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
  setupProgress,
  type EmulatorVisual,
  type SetupStepKey,
} from "./emulatorUi";

interface SystemHeaderProps {
  emulator: Emulator;
  known?: KnownEmulator;
  visual: EmulatorVisual;
  romCount: number;
  totalSizeBytes: number;
  lastPlayed?: number;
  lastScanned?: number;
  scanning: boolean;
  ready: boolean;
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

function relativeTime(ts: number, t: (key: string, vars?: Record<string, unknown>) => string) {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < 3_600_000) return t("emulators.relative.justNow");
  if (diff < day) return t("emulators.relative.hours", { n: Math.floor(diff / 3_600_000) });
  if (diff < 30 * day) return t("emulators.relative.days", { n: Math.floor(diff / day) });
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function EmulatorSystemHeader({
  emulator,
  known,
  visual,
  romCount,
  totalSizeBytes,
  lastPlayed,
  lastScanned,
  scanning,
  ready,
  onLaunchExe,
  onScan,
  onEdit,
  onDelete,
  onOpenFolder,
  onCheckBios,
  onFindRomFolders,
  onOpenUrl,
  onFixSetup,
}: SystemHeaderProps) {
  const { t } = useLanguage();
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

  const steps = useMemo(() => emulatorSetupSteps(emulator, romCount), [emulator, romCount]);
  const progress = setupProgress(steps);

  const menuItems: ContextMenuItem[] = useMemo(() => {
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
    if (emulator.romFolder.trim()) {
      items.push({
        id: "open-folder",
        label: t("emulators.openFolder"),
        icon: <FolderOpen size={15} />,
        onSelect: () => {
          setMoreMenu(null);
          onOpenFolder(emulator.romFolder);
        },
      });
    }
    if (known?.githubUrl) {
      items.push({
        id: "github",
        label: t("emulators.github"),
        icon: <span aria-hidden>↗</span>,
        onSelect: () => {
          setMoreMenu(null);
          onOpenUrl(known.githubUrl!);
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
  }, [t, emulator.romFolder, known?.githubUrl, onCheckBios, onFindRomFolders, onOpenFolder, onOpenUrl, onDelete]);

  return (
    <header
      className="emu-wb-header"
      style={{ ["--emu-accent" as string]: visual.accent }}
    >
      <div className="emu-wb-identity">
        <div className="emu-wb-art" aria-hidden>
          {visual.logo ? (
            <img src={visual.logo} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : (
            <span>{visual.glyph}</span>
          )}
        </div>

        <div className="emu-wb-meta">
          <div className="emu-wb-title-row">
            <h2 className="emu-wb-title">{emulator.name}</h2>
            <span className={`emu-wb-status${ready ? " is-ready" : ""}`}>
              <span className="emu-wb-status-dot" aria-hidden />
              {ready ? t("emulators.status.configured") : t("emulators.status.notConfigured")}
            </span>
          </div>
          <div className="emu-wb-subtitle">
            <span>{emulator.platform}</span>
            <span className="emu-wb-dot" aria-hidden />
            <span>{t("emulators.romCount", { count: romCount })}</span>
            {totalSizeBytes > 0 && (
              <>
                <span className="emu-wb-dot" aria-hidden />
                <span>{formatBytesShort(totalSizeBytes)}</span>
              </>
            )}
            {lastPlayed != null && (
              <>
                <span className="emu-wb-dot" aria-hidden />
                <span>{t("emulators.lastPlayedShort", { when: relativeTime(lastPlayed, t) })}</span>
              </>
            )}
            {lastScanned != null && (
              <>
                <span className="emu-wb-dot" aria-hidden />
                <span>{t("emulators.lastScannedShort", { when: relativeTime(lastScanned, t) })}</span>
              </>
            )}
          </div>

          {!ready && (
            <div className="emu-wb-setup">
              <span className="emu-wb-setup-track" aria-hidden>
                <span
                  className="emu-wb-setup-fill"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </span>
              <span className="emu-wb-setup-text">
                {t("emulators.setup.progress", { done: progress.done, total: progress.total })}
              </span>
              {steps
                .filter((step) => !step.done)
                .slice(0, 1)
                .map((step) => (
                  <button
                    key={step.key}
                    type="button"
                    className="emu-wb-setup-link"
                    onClick={() => onFixSetup(step.key)}
                  >
                    {step.key === "scan" ? t("emulators.scan") : t("emulators.edit")}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="emu-wb-actions">
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Play size={15} />}
          onClick={onLaunchExe}
        >
          {t("emulators.launchExe")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw size={15} />}
          isLoading={scanning}
          onClick={onScan}
        >
          {scanning ? t("emulators.scanning") : t("emulators.scan")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Pencil size={15} />}
          onClick={onEdit}
        >
          {t("emulators.edit")}
        </Button>
        <Button
          ref={moreRef}
          variant="ghost"
          size="sm"
          iconOnly
          title={t("emulators.actions.more")}
          aria-label={t("emulators.actions.more")}
          leftIcon={<MoreHorizontal size={16} />}
          onClick={() => {
            const rect = moreRef.current?.getBoundingClientRect();
            if (rect) setMoreMenu({ x: rect.right, y: rect.bottom + 4 });
          }}
        />
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
    </header>
  );
}
