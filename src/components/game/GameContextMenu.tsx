import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  ChevronRight,
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
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { PLAY_STATUS_DETAILS, type Game, type PlayStatus } from "../../types/game";

const STATUS_ORDER: PlayStatus[] = ["backlog", "playing", "completed", "on_hold", "abandoned"];
const VIEWPORT_MARGIN = 8;
const SUBMENU_GAP = 4;

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

interface SubmenuEntry {
  id: string;
  label: string;
  swatch?: string;
  active?: boolean;
  onSelect: () => void;
}

interface MenuAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  submenu?: SubmenuEntry[];
}

interface MenuSeparator {
  id: string;
  separator: true;
}

type MenuEntry = MenuAction | MenuSeparator;

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return "separator" in entry;
}

/**
 * GameContextMenu
 * ───────────────
 * Shared right-click menu for a library game. Owns the utility actions
 * (clipboard, install folder, store pages, metadata refresh, favorite,
 * play status, playtime-tracking) so every surface renders the same menu;
 * callers inject only the actions that mutate their own state (launch,
 * pinning, navigation, removal). Portaled to `document.body`, clamped to
 * the viewport and fully keyboard navigable.
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

  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pos, setPos] = useState({ left: x, top: y });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [submenuIndex, setSubmenuIndex] = useState(0);

  const isUntracked = isGameUntracked(game.id);

  const handleCopy = useCallback(
    async (text: string) => {
      onClose();
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        /* clipboard unavailable */
      }
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

  const entries = useMemo<MenuEntry[]>(() => {
    const raw: (MenuEntry | null)[] = [
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
    return raw.filter((entry): entry is MenuEntry => entry !== null);
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
  ]);

  const actions = useMemo(
    () => entries.filter((entry): entry is MenuAction => !isSeparator(entry)),
    [entries]
  );

  // Measured clamping instead of hardcoded menu dimensions, so a trimmed
  // menu (no path / no Steam id) still lands inside the viewport.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, x - rect.width);
    }
    if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    }
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    setActiveId(null);
    setOpenSubmenu(null);
    setSubmenuIndex(0);
  }, [game.id, x, y]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (target.closest("[data-game-context-menu]")) return;
      onClose();
    };
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-game-context-menu]")) return;
      onClose();
    };
    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && (menuRef.current?.contains(target) || target.closest?.("[data-game-context-menu]"))) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("blur", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("blur", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const activeSubmenu = actions.find((entry) => entry.id === openSubmenu)?.submenu ?? null;

  const openItemSubmenu = useCallback(
    (entry: MenuAction) => {
      if (!entry.submenu) return;
      setOpenSubmenu(entry.id);
      setSubmenuIndex(0);
      setActiveId(entry.id);
    },
    []
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        onClose();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (openSubmenu) {
          setOpenSubmenu(null);
        } else {
          onClose();
        }
        return;
      }

      const currentIndex = Math.max(
        0,
        actions.findIndex((entry) => entry.id === activeId)
      );

      if (activeSubmenu && openSubmenu) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? 1 : -1;
          setSubmenuIndex((prev) => (prev + delta + activeSubmenu.length) % activeSubmenu.length);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setOpenSubmenu(null);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activeSubmenu[submenuIndex]?.onSelect();
          return;
        }
      }

      const move = (delta: number) => {
        e.preventDefault();
        if (actions.length === 0) return;
        let next = currentIndex;
        if (!activeId) {
          const first = actions.find((entry) => !entry.disabled);
          if (!first) return;
          setActiveId(first.id);
          setOpenSubmenu(null);
          itemRefs.current[first.id]?.scrollIntoView({ block: "nearest" });
          return;
        }
        for (let step = 0; step < actions.length; step++) {
          next = (next + delta + actions.length) % actions.length;
          if (!actions[next].disabled) break;
        }
        setActiveId(actions[next].id);
        setOpenSubmenu(null);
        itemRefs.current[actions[next].id]?.scrollIntoView({ block: "nearest" });
      };

      switch (e.key) {
        case "ArrowDown":
          move(1);
          break;
        case "ArrowUp":
          move(-1);
          break;
        case "Home":
          e.preventDefault();
          setActiveId(actions.find((entry) => !entry.disabled)?.id ?? null);
          setOpenSubmenu(null);
          break;
        case "End": {
          e.preventDefault();
          const last = [...actions].reverse().find((entry) => !entry.disabled);
          setActiveId(last?.id ?? null);
          setOpenSubmenu(null);
          break;
        }
        case "ArrowRight": {
          const entry = actions[currentIndex];
          if (entry?.submenu) {
            e.preventDefault();
            openItemSubmenu(entry);
          }
          break;
        }
        case "Enter":
        case " ": {
          const entry = actions[currentIndex];
          if (!entry || entry.disabled) return;
          e.preventDefault();
          if (entry.submenu) openItemSubmenu(entry);
          else entry.onSelect?.();
          break;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [actions, activeId, activeSubmenu, onClose, openItemSubmenu, openSubmenu, submenuIndex]);

  return createPortal(
    <>
      <div
        ref={menuRef}
        className="context-menu game-context-menu"
        data-game-context-menu="true"
        role="menu"
        aria-label={game.name}
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        onScroll={() => setOpenSubmenu(null)}
      >
        <div className="context-menu-header">
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
        </div>

        {entries.map((entry) =>
          isSeparator(entry) ? (
            <div key={entry.id} className="context-menu-separator" role="separator" />
          ) : (
            <div
              key={entry.id}
              id={`game-ctx-${entry.id}`}
              ref={(el) => {
                itemRefs.current[entry.id] = el;
              }}
              role="menuitem"
              aria-haspopup={entry.submenu ? "menu" : undefined}
              aria-expanded={entry.submenu ? openSubmenu === entry.id : undefined}
              aria-disabled={entry.disabled || undefined}
              className={`context-menu-item${entry.accent ? " play-action" : ""}${
                entry.danger ? " remove-action" : ""
              }${entry.disabled ? " is-disabled" : ""}${
                activeId === entry.id ? " is-active" : ""
              }${entry.submenu ? " has-submenu" : ""}${
                openSubmenu === entry.id ? " submenu-open" : ""
              }`}
              onClick={() => {
                if (entry.disabled) return;
                if (entry.submenu) {
                  if (openSubmenu === entry.id) setOpenSubmenu(null);
                  else openItemSubmenu(entry);
                } else {
                  entry.onSelect?.();
                }
              }}
              onMouseEnter={() => {
                setActiveId(entry.id);
                if (entry.submenu) openItemSubmenu(entry);
                else setOpenSubmenu(null);
              }}
            >
              <span className="game-ctx-icon">{entry.icon}</span>
              <span className="game-ctx-label">{entry.label}</span>
              {entry.submenu && (
                <ChevronRight className="game-ctx-chevron" size={13} aria-hidden="true" />
              )}
            </div>
          )
        )}
      </div>

      {activeSubmenu && openSubmenu && (
        <ContextSubmenu
          triggerRef={() => itemRefs.current[openSubmenu]}
          entries={activeSubmenu}
          activeIndex={submenuIndex}
          onHoverEntry={setSubmenuIndex}
          onSelect={(entry) => entry.onSelect()}
        />
      )}
    </>,
    document.body
  );
}

function ContextSubmenu({
  triggerRef,
  entries,
  activeIndex,
  onHoverEntry,
  onSelect,
}: {
  triggerRef: () => HTMLElement | null;
  entries: SubmenuEntry[];
  activeIndex: number;
  onHoverEntry: (index: number) => void;
  onSelect: (entry: SubmenuEntry) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const computePosition = useCallback(() => {
    const trigger = triggerRef();
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    let left = rect.right + SUBMENU_GAP;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, rect.left - width - SUBMENU_GAP);
    }
    let top = rect.top - SUBMENU_GAP;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    }
    setPos({ left, top });
  }, [triggerRef]);

  useLayoutEffect(() => {
    computePosition();
  }, [computePosition, entries.length]);

  useEffect(() => {
    window.addEventListener("resize", computePosition);
    return () => window.removeEventListener("resize", computePosition);
  }, [computePosition]);

  return createPortal(
    <div
      ref={panelRef}
      className="context-menu game-context-menu game-ctx-submenu"
      data-game-context-menu="true"
      role="menu"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, index) => (
        <div
          key={entry.id}
          role="menuitem"
          className={`context-menu-item game-ctx-submenu__item${
            index === activeIndex ? " is-active" : ""
          }${entry.active ? " is-selected" : ""}`}
          onClick={() => onSelect(entry)}
          onMouseEnter={() => onHoverEntry(index)}
        >
          {entry.swatch ? (
            <span
              className="game-ctx-swatch"
              style={{ background: entry.swatch }}
              aria-hidden="true"
            />
          ) : (
            <span className="game-ctx-icon" aria-hidden="true" />
          )}
          <span className="game-ctx-label">{entry.label}</span>
          {entry.active && <Check className="game-ctx-check" size={13} aria-hidden="true" />}
        </div>
      ))}
    </div>,
    document.body
  );
}
