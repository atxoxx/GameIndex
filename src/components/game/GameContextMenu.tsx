import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Heart,
  ListChecks,
  Pencil,
  Pin,
  Play,
  Power,
  RefreshCw,
  Shield,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { copyTextToClipboard } from "../../utils/clipboard";
import { PLAY_STATUS_DETAILS, type Game, type PlayStatus } from "../../types/game";

const STATUS_ORDER: PlayStatus[] = ["backlog", "playing", "completed", "on_hold", "abandoned"];

export interface GameContextMenuProps {
  x: number;
  y: number;
  game: Game;
  isRunning: boolean;
  isPinned?: boolean;
  /** Called on any dismiss path (action, outside click, Escape, scroll). */
  onClose: () => void;
  onLaunch: () => void;
  onLaunchAdmin?: () => void;
  onForceClose?: () => void;
  onViewDetails: () => void;
  onEdit?: () => void;
  onTogglePin?: () => void;
  onRemove: () => void;
}

/**
 * GameContextMenu
 * ───────────────
 * Shared right-click menu for a library game. Owns the utility actions
 * (clipboard, install folder, store pages, metadata refresh, favorite,
 * play status, playtime-tracking) so every surface renders the same menu;
 * callers inject only the actions that mutate their own state (launch,
 * pinning, navigation, removal).
 */
export default function GameContextMenu({
  x,
  y,
  game,
  isRunning,
  isPinned,
  onClose,
  onLaunch,
  onLaunchAdmin,
  onForceClose,
  onViewDetails,
  onEdit,
  onTogglePin,
  onRemove,
}: GameContextMenuProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { isWindowsHost } = useSettings();
  const { updateGame, enrichGameMetadata, isGameUntracked, toggleGameTracking } = useGames();

  const isUntracked = isGameUntracked(game.id);

  const handleCopy = useCallback(
    async (text: string) => {
      onClose();
      const copied = await copyTextToClipboard(text);
      showToast(
        copied ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
        copied ? "success" : "error"
      );
    },
    [onClose, showToast, t]
  );

  const handleShowInFolder = useCallback(() => {
    onClose();
    if (!game.path) {
      showToast(t("sidebar.noLocalPath", { name: game.name }), "info");
      return;
    }
    invoke("open_folder", { path: game.path }).catch((err) =>
      showToast(t("sidebar.couldNotOpenFolder", { error: String(err) }), "error")
    );
  }, [game.name, game.path, onClose, showToast, t]);

  const handleOpenStore = useCallback(() => {
    onClose();
    if (game.metadataUrl) {
      openUrl(game.metadataUrl).catch(() => undefined);
      return;
    }
    navigate(`/store?q=${encodeURIComponent(game.name)}`);
  }, [game.metadataUrl, game.name, navigate, onClose]);

  const handleOpenSteam = useCallback(() => {
    if (!game.steamAppId) return;
    onClose();
    openUrl(`https://store.steampowered.com/app/${game.steamAppId}`).catch(() => undefined);
  }, [game.steamAppId, onClose]);

  const handleRefreshMetadata = useCallback(() => {
    onClose();
    showToast(t("sidebar.refreshingMetadata", { name: game.name }), "info");
    enrichGameMetadata(game.id, game.name, game.steamAppId)
      .then(() => showToast(t("sidebar.metadataRefreshed", { name: game.name }), "success"))
      .catch((err) => console.warn("Metadata refresh failed:", err));
  }, [enrichGameMetadata, game.id, game.name, game.steamAppId, onClose, showToast, t]);

  const handleToggleFavorite = useCallback(() => {
    const next = !game.favorite;
    onClose();
    updateGame(game.id, { favorite: next });
    showToast(
      next ? t("commandPalette.addedToFavorites") : t("commandPalette.removedFromFavorites"),
      "info"
    );
  }, [game.favorite, game.id, onClose, showToast, t, updateGame]);

  const handleToggleTracking = useCallback(() => {
    onClose();
    toggleGameTracking(game.id);
    showToast(
      isUntracked
        ? t("commandPalette.trackingEnabledToast", { name: game.name })
        : t("commandPalette.trackingDisabledToast", { name: game.name }),
      "info"
    );
  }, [game.id, game.name, isUntracked, onClose, showToast, t, toggleGameTracking]);

  const handleSetStatus = useCallback(
    (status: PlayStatus) => {
      onClose();
      updateGame(game.id, { playStatus: status });
      const meta = PLAY_STATUS_DETAILS[status];
      showToast(
        t("sidebar.statusSet", { name: game.name, status: meta ? t(meta.labelKey) : status }),
        "success"
      );
    },
    [game.id, game.name, onClose, showToast, t, updateGame]
  );

  const items = useMemo<ContextMenuItem[]>(() => {
    const raw: (ContextMenuItem | null)[] = [
      isRunning
        ? {
            id: "force-close",
            label: t("game.forceClose"),
            icon: <Power size={15} />,
            danger: true,
            disabled: !onForceClose,
            onSelect: onForceClose,
          }
        : {
            id: "launch",
            label: t("game.playGame"),
            icon: <Play size={15} />,
            accent: true,
            onSelect: onLaunch,
          },
      isWindowsHost && !isRunning && onLaunchAdmin && game.path
        ? {
            id: "launch-admin",
            label: t("sidebar.runAsAdmin"),
            icon: <Shield size={15} />,
            onSelect: onLaunchAdmin,
          }
        : null,
      {
        id: "view-details",
        label: t("game.viewDetails"),
        icon: <Eye size={15} />,
        onSelect: onViewDetails,
      },
      onEdit
        ? {
            id: "edit",
            label: t("library.context.editGame"),
            icon: <Pencil size={15} />,
            onSelect: onEdit,
          }
        : null,
      { id: "set-status", separator: true },
      {
        id: "status",
        label: t("sidebar.setStatus"),
        icon: <ListChecks size={15} />,
        submenu: STATUS_ORDER.map((status) => {
          const meta = PLAY_STATUS_DETAILS[status];
          return {
            id: `status-${status}`,
            label: t(meta.labelKey),
            swatch: meta.color,
            active: (game.playStatus || "backlog") === status,
            onSelect: () => handleSetStatus(status),
          };
        }),
      },
      {
        id: "favorite",
        label: game.favorite ? t("gameMenu.unfavorite") : t("gameMenu.favorite"),
        icon: <Heart size={15} fill={game.favorite ? "currentColor" : "none"} />,
        onSelect: handleToggleFavorite,
      },
      onTogglePin
        ? {
            id: "pin",
            label: isPinned ? t("sidebar.unpin") : t("sidebar.pinToTop"),
            icon: <Pin size={15} fill={isPinned ? "currentColor" : "none"} />,
            onSelect: onTogglePin,
          }
        : null,
      {
        id: "tracking",
        label: isUntracked
          ? t("commandPalette.enableTracking")
          : t("commandPalette.disableTracking"),
        icon: isUntracked ? <Eye size={15} /> : <EyeOff size={15} />,
        onSelect: handleToggleTracking,
      },
      {
        id: "refresh-metadata",
        label: t("sidebar.refreshMetadata"),
        icon: <RefreshCw size={15} />,
        onSelect: handleRefreshMetadata,
      },
      { id: "open-sep", separator: true },
      game.path
        ? {
            id: "open-folder",
            label: t("sidebar.showInFolder"),
            icon: <FolderOpen size={15} />,
            onSelect: handleShowInFolder,
          }
        : null,
      {
        id: "open-store",
        label: t("sidebar.openInStore"),
        icon: <ShoppingCart size={15} />,
        onSelect: handleOpenStore,
      },
      game.steamAppId
        ? {
            id: "open-steam",
            label: t("gameMenu.openSteamPage"),
            icon: <ExternalLink size={15} />,
            onSelect: handleOpenSteam,
          }
        : null,
      {
        id: "copy",
        label: t("common.copy"),
        icon: <Copy size={15} />,
        submenu: [
          {
            id: "copy-name",
            label: t("gameMenu.copyName"),
            onSelect: () => handleCopy(game.name),
          },
          ...(game.path
            ? [
                {
                  id: "copy-path",
                  label: t("sidebar.copyPath"),
                  onSelect: () => handleCopy(game.path),
                },
              ]
            : []),
          ...(game.steamAppId
            ? [
                {
                  id: "copy-steam-id",
                  label: t("sidebar.copySteamAppId"),
                  onSelect: () => handleCopy(String(game.steamAppId)),
                },
              ]
            : []),
          {
            id: "copy-game-id",
            label: t("gameMenu.copyGameId"),
            onSelect: () => handleCopy(game.id),
          },
        ],
      },
      { id: "remove-sep", separator: true },
      {
        id: "remove",
        label: t("sidebar.removeFromLibrary"),
        icon: <Trash2 size={15} />,
        danger: true,
        onSelect: onRemove,
      },
    ];
    return raw.filter((entry): entry is ContextMenuItem => entry !== null);
  }, [
    game.favorite,
    game.id,
    game.name,
    game.path,
    game.playStatus,
    game.steamAppId,
    handleCopy,
    handleOpenSteam,
    handleOpenStore,
    handleRefreshMetadata,
    handleSetStatus,
    handleShowInFolder,
    handleToggleFavorite,
    handleToggleTracking,
    isPinned,
    isRunning,
    isUntracked,
    isWindowsHost,
    onEdit,
    onForceClose,
    onLaunch,
    onLaunchAdmin,
    onRemove,
    onTogglePin,
    onViewDetails,
    t,
  ]);

  return (
    <ContextMenu
      x={x}
      y={y}
      items={items}
      onClose={onClose}
      ariaLabel={game.name}
      className="game-context-menu"
      header={
        <>
          <span className="context-menu-title" title={game.name}>
            {game.name}
          </span>
          <span className="game-context-menu__meta">
            {isRunning && (
              <span className="game-context-menu__running">
                <span className="game-context-menu__running-dot" aria-hidden="true" />
                {t("game.running")}
              </span>
            )}
            <span className="game-context-menu__platform">{game.platform}</span>
          </span>
        </>
      }
    />
  );
}
