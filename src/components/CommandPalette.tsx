import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  BookOpen,
  ChartColumn,
  Check,
  Compass,
  Download,
  ExternalLink,
  Gamepad2,
  HardDrive,
  Heart,
  Loader2,
  Monitor,
  MonitorPlay,
  Palette,
  Play,
  Puzzle,
  Rss,
  Search,
  Settings,
  Store,
  Tag,
  Trophy,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useGames } from "../context/GameContext";
import { useTheme } from "../context/ThemeContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { useToast } from "../context/ToastContext";
import type { StoreGameSummary } from "../types/game";
import DownloadModal from "./DownloadModal";
import { playActionSound, playLaunchSound, playTabSound } from "../utils/soundEffects";

interface PaletteQuickAction {
  id: string;
  icon: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}

interface PaletteItem {
  id: string;
  category: "games" | "igdb" | "navigation" | "themes" | "actions";
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
  thumb?: string;
  swatchColor?: string;
  actionText?: string;
  quickActions?: PaletteQuickAction[];
  onSelect: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { games, launchGame } = useGames();
  const { themes, currentTheme, setTheme } = useTheme();
  const { isBigScreen, setBigScreen } = useBigScreen();
  const { uiSoundEnabled, setUiSoundEnabled } = useSettings();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [igdbResults, setIgdbResults] = useState<StoreGameSummary[]>([]);
  const [isSearchingIgdb, setIsSearchingIgdb] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{
    name: string;
    id?: string;
    poster?: string;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setIgdbResults([]);
      setIsSearchingIgdb(false);
      setDownloadTarget(null);
      playTabSound();
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Debounced IGDB online catalog search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setIgdbResults([]);
      setIsSearchingIgdb(false);
      return;
    }

    setIsSearchingIgdb(true);
    const timer = setTimeout(() => {
      invoke<StoreGameSummary[]>("search_store_games", {
        query: q,
        offset: 0,
        limit: 6,
      })
        .then((res) => {
          setIgdbResults(Array.isArray(res) ? res : []);
        })
        .catch(() => {
          setIgdbResults([]);
        })
        .finally(() => {
          setIsSearchingIgdb(false);
        });
    }, 280);

    return () => clearTimeout(timer);
  }, [query]);

  // Handle global Escape key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // Build items list based on query and results
  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const result: PaletteItem[] = [];

    // 1. Library Games
    const matchedGames =
      q === ""
        ? games.slice(0, 4)
        : games.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 6);

    matchedGames.forEach((game) => {
      result.push({
        id: `game-${game.id}`,
        category: "games",
        title: game.name,
        subtitle: `${game.platform || "PC"} · ${game.playTime || "0h"}`,
        thumb: game.coverArtUrl,
        actionText: t("commandPalette.launch"),
        icon: <Play size={14} />,
        quickActions: [
          {
            id: "launch",
            icon: <Play size={12} fill="currentColor" />,
            title: t("commandPalette.quickActionLaunch"),
            onClick: (e) => {
              e.stopPropagation();
              playLaunchSound();
              onClose();
              launchGame(game);
            },
          },
          {
            id: "page",
            icon: <ExternalLink size={12} />,
            title: t("commandPalette.quickActionPage"),
            onClick: (e) => {
              e.stopPropagation();
              playActionSound();
              onClose();
              navigate(`/library/${game.id}`);
            },
          },
        ],
        onSelect: () => {
          playLaunchSound();
          onClose();
          launchGame(game);
        },
      });
    });

    // 2. IGDB Online Catalog Games (Search results)
    if (igdbResults.length > 0) {
      igdbResults.forEach((igdbGame) => {
        const year = igdbGame.firstReleaseDate
          ? new Date(igdbGame.firstReleaseDate).getFullYear()
          : null;
        const rating = igdbGame.rating ? `★ ${Math.round(igdbGame.rating)}%` : null;
        const genre = igdbGame.genres?.[0] || null;
        const subParts = [year, rating, genre].filter(Boolean).join(" · ");

        result.push({
          id: `igdb-${igdbGame.id}`,
          category: "igdb",
          title: igdbGame.name,
          subtitle: subParts || "IGDB Catalog",
          badge: "IGDB",
          thumb: igdbGame.coverUrl ?? undefined,
          actionText: t("commandPalette.open"),
          icon: <Store size={14} />,
          quickActions: [
            {
              id: "page",
              icon: <ExternalLink size={12} />,
              title: t("commandPalette.quickActionPage"),
              onClick: (e) => {
                e.stopPropagation();
                playActionSound();
                onClose();
                navigate(`/store/${igdbGame.slug || igdbGame.id}`);
              },
            },
            {
              id: "download",
              icon: <Download size={12} />,
              title: t("commandPalette.quickActionDownload"),
              onClick: (e) => {
                e.stopPropagation();
                playActionSound();
                setDownloadTarget({
                  name: igdbGame.name,
                  id: String(igdbGame.id),
                  poster: igdbGame.coverUrl ?? undefined,
                });
              },
            },
          ],
          onSelect: () => {
            playActionSound();
            onClose();
            navigate(`/store/${igdbGame.slug || igdbGame.id}`);
          },
        });
      });
    }

    // 3. Navigation Routes
    const routes = [
      { path: "/home", labelKey: "nav.home", icon: <Compass size={15} /> },
      { path: "/library", labelKey: "nav.library", icon: <Monitor size={15} /> },
      { path: "/store", labelKey: "nav.store", icon: <Store size={15} /> },
      { path: "/wishlist", labelKey: "nav.wishlist", icon: <Heart size={15} /> },
      { path: "/deals", labelKey: "nav.deals", icon: <Tag size={15} /> },
      { path: "/activity", labelKey: "nav.activity", icon: <Activity size={15} /> },
      { path: "/achievements", labelKey: "nav.achievements", icon: <Trophy size={15} /> },
      { path: "/emulators", labelKey: "nav.emulators", icon: <Gamepad2 size={15} /> },
      { path: "/mods", labelKey: "nav.mods", icon: <Puzzle size={15} /> },
      { path: "/downloads", labelKey: "nav.downloads", icon: <Download size={15} /> },
      { path: "/storage", labelKey: "nav.storage", icon: <HardDrive size={15} /> },
      { path: "/news", labelKey: "nav.news", icon: <Rss size={15} /> },
      { path: "/community", labelKey: "nav.community", icon: <ChartColumn size={15} /> },
      { path: "/friends", labelKey: "nav.friends", icon: <Users size={15} /> },
      { path: "/settings", labelKey: "nav.settings", icon: <Settings size={15} /> },
      { path: "/docs", labelKey: "nav.docs", icon: <BookOpen size={15} /> },
    ];

    routes
      .filter((r) => {
        if (q === "") return true;
        const translated = t(r.labelKey).toLowerCase();
        return translated.includes(q) || r.path.includes(q);
      })
      .slice(0, q === "" ? 4 : 6)
      .forEach((r) => {
        result.push({
          id: `nav-${r.path}`,
          category: "navigation",
          title: t(r.labelKey),
          subtitle: `${t("commandPalette.navTo")} ${r.path}`,
          icon: r.icon,
          actionText: "↵",
          quickActions: [
            {
              id: "open",
              icon: <ExternalLink size={12} />,
              title: t("commandPalette.quickActionPage"),
              onClick: (e) => {
                e.stopPropagation();
                playActionSound();
                onClose();
                navigate(r.path);
              },
            },
          ],
          onSelect: () => {
            playActionSound();
            onClose();
            navigate(r.path);
          },
        });
      });

    // 4. Themes
    themes
      .filter((th) => {
        if (q === "") return false;
        return (
          th.id.toLowerCase().includes(q) ||
          th.meta.name.toLowerCase().includes(q) ||
          q.includes("theme") ||
          q.includes("color")
        );
      })
      .slice(0, 4)
      .forEach((th) => {
        const isCurrent = th.id === currentTheme;
        result.push({
          id: `theme-${th.id}`,
          category: "themes",
          title: th.meta.name,
          subtitle: `${t("commandPalette.switchTheme")} ${th.meta.name}`,
          icon: isCurrent ? <Check size={14} /> : <Palette size={14} />,
          actionText: isCurrent ? "Active" : t("commandPalette.hintSelect"),
          onSelect: () => {
            playActionSound();
            setTheme(th.id);
            showToast(t("settings.themeChanged", { theme: th.meta.name }), "success");
            onClose();
          },
        });
      });

    // 5. Quick Actions
    const actions = [
      {
        id: "act-bigscreen",
        title: t("commandPalette.toggleBigScreen"),
        subtitle: isBigScreen ? t("topnav.exitBigScreen") : t("topnav.enterBigScreen"),
        icon: <MonitorPlay size={15} />,
        matches: ["big", "screen", "tv", "controller", "gamepad"],
        action: () => {
          setBigScreen(!isBigScreen);
        },
      },
      {
        id: "act-sound",
        title: t("commandPalette.toggleSound"),
        subtitle: uiSoundEnabled ? "Sound ON" : "Sound OFF",
        icon: uiSoundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />,
        matches: ["sound", "audio", "mute", "volume", "click"],
        action: () => {
          setUiSoundEnabled(!uiSoundEnabled);
          showToast(`Sound ${!uiSoundEnabled ? "Enabled" : "Muted"}`, "info");
        },
      },
    ];

    actions
      .filter((act) => {
        if (q === "") return true;
        return (
          act.title.toLowerCase().includes(q) ||
          act.matches.some((m) => m.includes(q))
        );
      })
      .forEach((act) => {
        result.push({
          id: act.id,
          category: "actions",
          title: act.title,
          subtitle: act.subtitle,
          icon: act.icon,
          actionText: "↵",
          onSelect: () => {
            playActionSound();
            onClose();
            act.action();
          },
        });
      });

    return result;
  }, [
    query,
    games,
    igdbResults,
    themes,
    currentTheme,
    isBigScreen,
    uiSoundEnabled,
    setBigScreen,
    setTheme,
    setUiSoundEnabled,
    launchGame,
    navigate,
    onClose,
    showToast,
    t,
  ]);

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex((prev) => (items.length === 0 ? 0 : Math.min(prev, items.length - 1)));
  }, [items.length]);

  // Keyboard navigation through items
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIndex]) {
        items[selectedIndex].onSelect();
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.querySelector<HTMLElement>(".command-palette-item.is-selected");
    activeEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  let currentCategory = "";

  return createPortal(
    <>
      <div
        className="command-palette-backdrop"
        onClick={onClose}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
      >
        <div
          className="command-palette-panel"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search header */}
          <div className="command-palette-header">
            <Search className="command-palette-icon" aria-hidden="true" />
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              className="command-palette-input"
              placeholder={t("commandPalette.placeholder")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            {isSearchingIgdb && (
              <Loader2 size={15} className="command-palette-spinner" style={{ color: "var(--color-accent)" }} />
            )}
            <kbd className="command-palette-esc">Esc</kbd>
          </div>

          {/* Results List */}
          <div ref={listRef} className="command-palette-list" role="listbox">
            {items.length === 0 ? (
              <div className="command-palette-empty">
                <Search className="command-palette-empty-icon" />
                <span>{t("commandPalette.noResults")}</span>
              </div>
            ) : (
              items.map((item, idx) => {
                const showCategory = item.category !== currentCategory;
                currentCategory = item.category;

                const categoryTitle =
                  item.category === "games"
                    ? t("commandPalette.sectionGames")
                    : item.category === "igdb"
                      ? t("commandPalette.sectionIgdb")
                      : item.category === "navigation"
                        ? t("commandPalette.sectionNav")
                        : item.category === "themes"
                          ? t("commandPalette.sectionThemes")
                          : t("commandPalette.sectionActions");

                const isSelected = idx === selectedIndex;

                return (
                  <div key={item.id}>
                    {showCategory && (
                      <div
                        className="command-palette-group-title"
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                      >
                        <span>{categoryTitle}</span>
                        {item.category === "igdb" && isSearchingIgdb && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", textTransform: "none", opacity: 0.8 }}>
                            <Loader2 size={11} className="command-palette-spinner" />
                            {t("commandPalette.searchingIgdb")}
                          </span>
                        )}
                      </div>
                    )}
                    <div
                      role="option"
                      aria-selected={isSelected}
                      className={`command-palette-item${isSelected ? " is-selected" : ""}`}
                      onClick={item.onSelect}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      {item.thumb ? (
                        <img
                          src={item.thumb}
                          alt=""
                          className="command-palette-item-thumb"
                          loading="lazy"
                        />
                      ) : item.icon ? (
                        <div className="command-palette-item-icon">{item.icon}</div>
                      ) : null}

                      <div className="command-palette-item-body">
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className="command-palette-item-title">{item.title}</span>
                          {item.badge && (
                            <span className="command-palette-badge">{item.badge}</span>
                          )}
                        </div>
                        {item.subtitle && (
                          <span className="command-palette-item-subtitle">{item.subtitle}</span>
                        )}
                      </div>

                      {/* Right quick actions & primary action pill */}
                      <div className="command-palette-item-actions">
                        {item.quickActions && item.quickActions.length > 0 && (
                          <div className="command-palette-quick-btns">
                            {item.quickActions.map((qa) => (
                              <button
                                key={qa.id}
                                type="button"
                                className="command-palette-quick-btn"
                                title={qa.title}
                                aria-label={qa.title}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  qa.onClick(e);
                                }}
                              >
                                {qa.icon}
                              </button>
                            ))}
                          </div>
                        )}
                        {item.actionText && (
                          <span className="command-palette-item-action">
                            <span>{item.actionText}</span>
                            {isSelected && <kbd className="command-palette-key-pill">↵</kbd>}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="command-palette-footer">
            <div className="command-palette-hints">
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
                <span>{t("commandPalette.hintClose")}</span>
              </span>
            </div>
            <span style={{ opacity: 0.6, fontSize: "11px" }}>GameIndex Command HUD</span>
          </div>
        </div>
      </div>

      {/* Download Modal Triggered Directly from Command Palette */}
      {downloadTarget && (
        <DownloadModal
          gameName={downloadTarget.name}
          gameId={downloadTarget.id}
          gamePoster={downloadTarget.poster}
          onClose={() => setDownloadTarget(null)}
        />
      )}
    </>,
    document.body
  );
}
