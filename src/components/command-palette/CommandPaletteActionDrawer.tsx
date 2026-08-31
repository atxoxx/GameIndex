import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Folder,
  Gamepad2,
  Copy,
  Heart,
  Globe,
  EyeOff,
  Eye,
  Layers,
  Sparkles,
  X,
} from "lucide-react";
import type { PaletteItem, PaletteSecondaryAction } from "./commandPaletteTypes";
import { invoke } from "@tauri-apps/api/core";

interface CommandPaletteActionDrawerProps {
  item: PaletteItem | null;
  isOpen: boolean;
  onClose: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  navigate: (path: string) => void;
  launchGame?: (game: any) => void;
  isGameUntracked?: (id: string) => boolean;
  toggleGameTracking?: (id: string) => void;
  isWishlisted?: (slug: string) => boolean;
  toggleWishlist?: (game: any) => void;
}

export default function CommandPaletteActionDrawer({
  item,
  isOpen,
  onClose,
  t,
  showToast,
  navigate,
  launchGame,
  isGameUntracked,
  toggleGameTracking,
  isWishlisted,
  toggleWishlist,
}: CommandPaletteActionDrawerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Build secondary actions list for the selected item
  const actions: PaletteSecondaryAction[] = [];

  if (item?.gameData) {
    const game = item.gameData;
    const isUntracked = isGameUntracked ? isGameUntracked(game.id) : !!game.untracked;

    // 1. Launch Game
    if (game.installed && launchGame) {
      actions.push({
        id: "act-launch",
        title: t("commandPalette.launch"),
        description: t("commandPalette.actLaunchDesc"),
        icon: <Gamepad2 size={15} />,
        shortcut: "↵",
        badge: t("commandPalette.primary"),
        onExecute: () => {
          onClose();
          launchGame(game);
        },
      });
    }

    // 2. Open in Library Details
    actions.push({
      id: "act-library-page",
      title: t("commandPalette.open"),
      description: t("commandPalette.actViewDetailsDesc"),
      icon: <Layers size={15} />,
      shortcut: "Ctrl+↵",
      onExecute: () => {
        onClose();
        navigate(`/library/${game.id}`);
      },
    });

    // 3. Open Install / Executable Folder
    if (game.path) {
      actions.push({
        id: "act-open-folder",
        title: t("commandPalette.openFolder"),
        description: t("commandPalette.actOpenFolderDesc"),
        icon: <Folder size={15} />,
        shortcut: "Ctrl+O",
        onExecute: () => {
          invoke("open_folder", { path: game.path }).catch(() => {
            showToast(t("commandPalette.folderNotFound"), "error");
          });
        },
      });

      // 4. Copy Executable Path
      actions.push({
        id: "act-copy-path",
        title: t("commandPalette.copyPath"),
        description: game.path,
        icon: <Copy size={15} />,
        shortcut: "Ctrl+C",
        onExecute: () => {
          navigator.clipboard.writeText(game.path);
          showToast(t("commandPalette.copiedToClipboard"), "info");
        },
      });
    }

    // 5. Copy Title
    actions.push({
      id: "act-copy-title",
      title: t("commandPalette.copyTitle"),
      description: game.name,
      icon: <Copy size={15} />,
      shortcut: "Ctrl+Shift+C",
      onExecute: () => {
        navigator.clipboard.writeText(game.name);
        showToast(t("commandPalette.copiedToClipboard"), "info");
      },
    });

    // 6. External Web Wiki & Store Links
    if (game.steamAppId) {
      actions.push({
        id: "act-steam-store",
        title: "Steam Store",
        description: `https://store.steampowered.com/app/${game.steamAppId}`,
        icon: <Globe size={15} />,
        badge: "Steam",
        onExecute: () => {
          invoke("open_url", { url: `https://store.steampowered.com/app/${game.steamAppId}` }).catch(() => {
            window.open(`https://store.steampowered.com/app/${game.steamAppId}`, "_blank");
          });
        },
      });

      actions.push({
        id: "act-steamdb",
        title: "SteamDB",
        description: `https://steamdb.info/app/${game.steamAppId}`,
        icon: <ExternalLink size={15} />,
        badge: "SteamDB",
        onExecute: () => {
          invoke("open_url", { url: `https://steamdb.info/app/${game.steamAppId}` }).catch(() => {
            window.open(`https://steamdb.info/app/${game.steamAppId}`, "_blank");
          });
        },
      });

      actions.push({
        id: "act-protondb",
        title: "ProtonDB Compatibility",
        description: `https://www.protondb.com/app/${game.steamAppId}`,
        icon: <ExternalLink size={15} />,
        badge: "ProtonDB",
        onExecute: () => {
          invoke("open_url", { url: `https://www.protondb.com/app/${game.steamAppId}` }).catch(() => {
            window.open(`https://www.protondb.com/app/${game.steamAppId}`, "_blank");
          });
        },
      });
    }

    // PCGamingWiki search link
    actions.push({
      id: "act-pcgamingwiki",
      title: "PCGamingWiki Fixes & Configs",
      description: `Search PCGamingWiki for ${game.name}`,
      icon: <ExternalLink size={15} />,
      badge: "PCGW",
      onExecute: () => {
        const url = `https://www.pcgamingwiki.com/w/index.php?search=${encodeURIComponent(game.name)}`;
        invoke("open_url", { url }).catch(() => {
          window.open(url, "_blank");
        });
      },
    });

    // 7. Toggle Playtime Tracking Exclusion
    if (toggleGameTracking) {
      actions.push({
        id: "act-toggle-tracking",
        title: isUntracked ? t("commandPalette.enableTracking") : t("commandPalette.disableTracking"),
        description: isUntracked
          ? t("commandPalette.enableTrackingDesc")
          : t("commandPalette.disableTrackingDesc"),
        icon: isUntracked ? <Eye size={15} /> : <EyeOff size={15} />,
        badge: isUntracked ? "Untracked" : undefined,
        onExecute: () => {
          toggleGameTracking(game.id);
          showToast(
            isUntracked
              ? t("commandPalette.trackingEnabledToast", { name: game.name })
              : t("commandPalette.trackingDisabledToast", { name: game.name }),
            "info"
          );
        },
      });
    }
  } else if (item?.storeData && toggleWishlist) {
    const storeGame = item.storeData;
    const wishlisted = isWishlisted ? isWishlisted(storeGame.slug || String(storeGame.id)) : false;

    actions.push({
      id: "act-store-page",
      title: t("commandPalette.quickActionPage"),
      description: t("commandPalette.viewStorePageDesc"),
      icon: <ExternalLink size={15} />,
      shortcut: "↵",
      onExecute: () => {
        onClose();
        navigate(`/store/${storeGame.slug || storeGame.id}`);
      },
    });

    actions.push({
      id: "act-store-wishlist",
      title: wishlisted ? t("store.inWishlist") : t("store.addToWishlist"),
      description: wishlisted ? t("commandPalette.removeFromWishlistDesc") : t("commandPalette.addToWishlistDesc"),
      icon: <Heart size={15} fill={wishlisted ? "currentColor" : "none"} />,
      shortcut: "W",
      onExecute: () => {
        toggleWishlist(storeGame);
        showToast(
          wishlisted
            ? `${storeGame.name}: ${t("commandPalette.removedFromWishlist")}`
            : `${storeGame.name}: ${t("commandPalette.addedToWishlist")}`,
          "info"
        );
      },
    });
  } else if (item?.calcData) {
    actions.push({
      id: "act-copy-calc-result",
      title: t("commandPalette.copyResult"),
      description: item.calcData.result,
      icon: <Copy size={15} />,
      shortcut: "↵",
      onExecute: () => {
        navigator.clipboard.writeText(item.calcData?.result || "");
        showToast(t("commandPalette.copiedToClipboard"), "info");
        onClose();
      },
    });

    actions.push({
      id: "act-copy-calc-formula",
      title: t("commandPalette.copyEquation"),
      description: item.calcData.expression,
      icon: <Copy size={15} />,
      shortcut: "Ctrl+C",
      onExecute: () => {
        navigator.clipboard.writeText(item.calcData?.expression || "");
        showToast(t("commandPalette.copiedToClipboard"), "info");
        onClose();
      },
    });
  }

  // Keyboard navigation inside the Action Drawer
  useEffect(() => {
    if (!isOpen) {
      setSelectedIndex(0);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, actions.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + actions.length) % Math.max(1, actions.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = actions[selectedIndex];
        if (action) {
          action.onExecute();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isOpen, selectedIndex, actions, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(".cmd-drawer-item.is-selected");
    active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex, isOpen]);

  if (!isOpen || !item || actions.length === 0) return null;

  return (
    <div className="cmd-drawer-backdrop" onClick={onClose}>
      <div className="cmd-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-drawer-header">
          <div className="cmd-drawer-title-group">
            <Sparkles className="cmd-drawer-icon" size={15} />
            <div className="cmd-drawer-titles">
              <span className="cmd-drawer-title">{t("commandPalette.actionsFor", { title: item.title })}</span>
              <span className="cmd-drawer-subtitle">{item.subtitle || t("commandPalette.contextActions")}</span>
            </div>
          </div>
          <button
            type="button"
            className="cmd-drawer-close-btn"
            onClick={onClose}
            aria-label={t("commandPalette.hintClose")}
          >
            <X size={14} />
          </button>
        </div>

        <div ref={listRef} className="cmd-drawer-list" role="menu">
          {actions.map((act, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={act.id}
                role="menuitem"
                className={`cmd-drawer-item${isSelected ? " is-selected" : ""}`}
                onClick={act.onExecute}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="cmd-drawer-item-icon">{act.icon}</div>
                <div className="cmd-drawer-item-body">
                  <div className="cmd-drawer-item-headline">
                    <span className="cmd-drawer-item-title">{act.title}</span>
                    {act.badge && (
                      <span className="command-palette-badge badge--accent">
                        {act.badge}
                      </span>
                    )}
                  </div>
                  {act.description && (
                    <span className="cmd-drawer-item-desc">{act.description}</span>
                  )}
                </div>
                {act.shortcut && (
                  <kbd className="command-palette-key-pill">{act.shortcut}</kbd>
                )}
              </div>
            );
          })}
        </div>

        <div className="cmd-drawer-footer">
          <span className="command-palette-hint">
            <kbd className="command-palette-key-pill">↑↓</kbd>
            <span>{t("commandPalette.hintNavigate")}</span>
          </span>
          <span className="command-palette-hint">
            <kbd className="command-palette-key-pill">↵</kbd>
            <span>{t("commandPalette.hintSelect")}</span>
          </span>
          <span className="command-palette-hint">
            <kbd className="command-palette-key-pill">Esc</kbd>
            <span>{t("commandPalette.back")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
