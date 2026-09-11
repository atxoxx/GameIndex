import { Copy, Eraser, FolderOpen, Move, Play, RefreshCw, Trash2, Wrench } from "lucide-react";
import type { Game } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import type { ContextMenuItem } from "../../components/ui/ContextMenu";

interface StorageMenuOptions {
  game: Game;
  hasSize: boolean;
  hasModsFolder: boolean;
  onLaunch?: () => void;
  onOpenFolder?: () => void;
  onDetect: () => void;
  onClearSize?: () => void;
  onCopyPath?: () => void;
  onManageMods?: () => void;
  onMove?: () => void;
  onUninstall?: () => void;
}

/** Shared right-click item list for storage rows and grid cards. */
export function useStorageMenuItems({
  hasSize,
  hasModsFolder,
  onLaunch,
  onOpenFolder,
  onDetect,
  onClearSize,
  onCopyPath,
  onManageMods,
  onMove,
  onUninstall,
}: StorageMenuOptions): ContextMenuItem[] {
  const { t } = useLanguage();

  const raw: (ContextMenuItem | null)[] = [
    onLaunch
      ? {
          id: "launch",
          label: t("storage.row.play"),
          icon: <Play size={15} />,
          accent: true,
          onSelect: onLaunch,
        }
      : null,
    onOpenFolder
      ? {
          id: "open-folder",
          label: t("downloadRow.openFolder"),
          icon: <FolderOpen size={15} />,
          onSelect: onOpenFolder,
        }
      : null,
    {
      id: "detect-size",
      label: t("edit.autoDetect"),
      icon: <RefreshCw size={15} />,
      onSelect: onDetect,
    },
    hasSize && onClearSize
      ? {
          id: "clear-size",
          label: t("common.clear"),
          icon: <Eraser size={15} />,
          onSelect: onClearSize,
        }
      : null,
    onCopyPath
      ? {
          id: "copy-path",
          label: t("storage.row.copyPath"),
          icon: <Copy size={15} />,
          onSelect: onCopyPath,
        }
      : null,
    hasModsFolder && onManageMods
      ? {
          id: "manage-mods",
          label: t("storageRow.mods.manage"),
          icon: <Wrench size={15} />,
          onSelect: onManageMods,
        }
      : null,
    ...(onMove || onUninstall
      ? ([{ id: "sep-1", separator: true }] as ContextMenuItem[])
      : []),
    onMove
      ? {
          id: "move",
          label: t("storageRow.move"),
          icon: <Move size={15} />,
          onSelect: onMove,
        }
      : null,
    onUninstall
      ? {
          id: "uninstall",
          label: t("storage.uninstall"),
          icon: <Trash2 size={15} />,
          danger: true,
          onSelect: onUninstall,
        }
      : null,
  ];

  return raw.filter((item): item is ContextMenuItem => item !== null);
}
