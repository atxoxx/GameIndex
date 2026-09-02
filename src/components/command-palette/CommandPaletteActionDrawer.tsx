import { useEffect, useRef, useState, useMemo } from "react";
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
  Search,
  Download,
  Clock,
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
  toggleFavorite?: (gameId: string) => void;
  onOpenDownloadModal?: (target: { name: string; id?: string; poster?: string }) => void;
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
  toggleFavorite,
  onOpenDownloadModal,
}: CommandPaletteActionDrawerProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build secondary actions list for the selected item
  const allActions: PaletteSecondaryAction[] = useMemo(() => {
    if (!item) return [];
    const acts: PaletteSecondaryAction[] = [];

    if (item.gameData) {
      const game = item.gameData;
      const isUntracked = isGameUntracked ? isGameUntracked(game.id) : !!game.untracked;

      // 1. Launch Game
      if (game.installed && launchGame) {
        acts.push({
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
      acts.push({
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
        acts.push({
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
        acts.push({
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
      acts.push({
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

      // 6. Toggle Favorite
      if (toggleFavorite) {
        acts.push({
          id: "act-toggle-favorite",
          title: game.favorite ? t("commandPalette.unmarkFavorite") : t("commandPalette.markFavorite"),
          description: game.favorite ? t("commandPalette.unmarkFavoriteDesc") : t("commandPalette.markFavoriteDesc"),
          icon: <Heart size={15} fill={game.favorite ? "currentColor" : "none"} />,
          onExecute: () => {
            toggleFavorite(game.id);
            showToast(game.favorite ? t("commandPalette.removedFromFavorites") : t("commandPalette.addedToFavorites"), "info");
          },
        });
      }

      // 7. External Web Wiki & Store Links
      if (game.steamAppId) {
        acts.push({
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

        acts.push({
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

        acts.push({
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
      acts.push({
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

      // HowLongToBeat
      acts.push({
        id: "act-hltb",
        title: "HowLongToBeat",
        description: `Search completion times for ${game.name}`,
        icon: <Clock size={15} />,
        badge: "HLTB",
        onExecute: () => {
          const url = `https://howlongtobeat.com/?q=${encodeURIComponent(game.name)}`;
          invoke("open_url", { url }).catch(() => {
            window.open(url, "_blank");
          });
        },
      });

      // 8. Toggle Playtime Tracking Exclusion
      if (toggleGameTracking) {
        acts.push({
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
    } else if (item.storeData && toggleWishlist) {
      const storeGame = item.storeData;
      const wishlisted = isWishlisted ? isWishlisted(storeGame.slug || String(storeGame.id)) : false;

      acts.push({
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

      acts.push({
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

      if (onOpenDownloadModal) {
        acts.push({
          id: "act-store-download",
          title: t("commandPalette.quickActionDownload"),
          description: t("commandPalette.quickActionDownloadDesc"),
          icon: <Download size={15} />,
          badge: "Get",
          onExecute: () => {
            onClose();
            onOpenDownloadModal({
              name: storeGame.name,
              id: String(storeGame.id),
              poster: storeGame.coverUrl ?? undefined,
            });
          },
        });
      }
    } else if (item.calcData) {
      acts.push({
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

      acts.push({
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

    return acts;
  }, [
    item,
    isGameUntracked,
    launchGame,
    t,
    onClose,
    navigate,
    showToast,
    toggleFavorite,
    toggleGameTracking,
    toggleWishlist,
    isWishlisted,
    onOpenDownloadModal,
  ]);

  // Filter actions based on drawer search input
  const filteredActions = useMemo(() => {
    if (!filterQuery) return allActions;
    const q = filterQuery.toLowerCase();
    return allActions.filter(
      (a) => a.title.toLowerCase().includes(q) || (a.description && a.description.toLowerCase().includes(q))
    );
  }, [allActions, filterQuery]);

  // Reset filter and selection on open
  useEffect(() => {
    if (isOpen) {
      setFilterQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation inside the Action Drawer
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredActions.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredActions.length) % Math.max(1, filteredActions.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = filteredActions[selectedIndex];
        if (action) {
          action.onExecute();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isOpen, selectedIndex, filteredActions, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(".cmd-drawer-item.is-selected");
    active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex, isOpen]);

  if (!isOpen || !item || allActions.length === 0) return null;

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

        {allActions.length > 5 && (
          <div className="cmd-drawer-search">
            <Search size={13} className="cmd-drawer-search-icon" />
            <input
              ref={inputRef}
              type="text"
              className="cmd-drawer-search-input"
              placeholder={t("commandPalette.searchActions")}
              value={filterQuery}
              onChange={(e) => {
                setFilterQuery(e.target.value);
                setSelectedIndex(0);
              }}
            />
          </div>
        )}

        <div ref={listRef} className="cmd-drawer-list" role="menu">
          {filteredActions.length === 0 ? (
            <div className="cmd-drawer-empty">
              <span>{t("commandPalette.noActionsFound")}</span>
            </div>
          ) : (
            filteredActions.map((act, idx) => {
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
            })
          )}
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
