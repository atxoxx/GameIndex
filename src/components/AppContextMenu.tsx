import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Compass,
  Download,
  ExternalLink,
  FileText,
  Gamepad2,
  Heart,
  Home,
  Library,
  Link2,
  Monitor,
  Moon,
  Newspaper,
  RotateCw,
  Search,
  Settings,
  Store,
  Sun,
  Tag,
  Trophy,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import ContextMenu, { type ContextMenuAction, type ContextMenuItem } from "./ui/ContextMenu";
import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";

const NAV_LINKS: { path: string; labelKey: string; icon: LucideIcon }[] = [
  { path: "/home", labelKey: "nav.home", icon: Home },
  { path: "/library", labelKey: "nav.library", icon: Library },
  { path: "/store", labelKey: "nav.store", icon: Store },
  { path: "/deals", labelKey: "nav.deals", icon: Tag },
  { path: "/wishlist", labelKey: "nav.wishlist", icon: Heart },
  { path: "/news", labelKey: "nav.news", icon: Newspaper },
  { path: "/downloads", labelKey: "nav.downloads", icon: Download },
  { path: "/activity", labelKey: "nav.activity", icon: Activity },
  { path: "/achievements", labelKey: "nav.achievements", icon: Trophy },
  { path: "/mods", labelKey: "nav.mods", icon: Wrench },
  { path: "/emulators", labelKey: "nav.emulators", icon: Gamepad2 },
  { path: "/settings", labelKey: "nav.settings", icon: Settings },
  { path: "/docs", labelKey: "nav.docs", icon: FileText },
];

interface MenuPosition {
  x: number;
  y: number;
  linkHref?: string;
}

/**
 * AppContextMenu
 * ──────────────
 * Replaces the webview's default right-click menu on "empty" surfaces
 * (anything that isn't an editable field, a text selection, or an element
 * that already opened its own context menu). Offers app navigation,
 * history, the command palette, theme/Big Screen toggles and link actions.
 */
export default function AppContextMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { currentTheme, setTheme } = useTheme();
  const { setBigScreen } = useBigScreen();
  const copy = useCopyToClipboard();
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const isLight = currentTheme === "light";
  const historyIndex =
    typeof window !== "undefined"
      ? ((window.history.state?.idx as number | undefined) ?? 0)
      : 0;
  const maxHistoryIndexRef = useRef(historyIndex);
  useEffect(() => {
    maxHistoryIndexRef.current = Math.max(maxHistoryIndexRef.current, historyIndex);
  }, [historyIndex, location.key]);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Another surface already claimed the event (cards, rows, our menus).
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-context-menu]")) return;
      if (
        target.closest(
          "input, textarea, select, [contenteditable='true'], [contenteditable=''], [data-native-context-menu]"
        )
      ) {
        return;
      }
      // Keep the native menu when the user right-clicks a text selection.
      const selection = window.getSelection?.();
      if (selection && selection.toString().trim().length > 0) return;

      e.preventDefault();
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      setPosition({ x: e.clientX, y: e.clientY, linkHref: anchor?.href || undefined });
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  const close = useCallback(() => setPosition(null), []);

  const items = useMemo<ContextMenuItem[]>(() => {
    const goTo: ContextMenuAction[] = NAV_LINKS.map(({ path, labelKey, icon: Icon }) => ({
      id: `goto-${path}`,
      label: t(labelKey),
      icon: <Icon size={15} />,
      onSelect: () => {
        close();
        navigate(path);
      },
    }));

    const linkHref = position?.linkHref;
    return [
      ...(linkHref
        ? ([
            {
              id: "open-link",
              label: t("appMenu.openLink"),
              icon: <ExternalLink size={15} />,
              accent: true,
              onSelect: () => {
                close();
                void openUrl(linkHref);
              },
            },
            {
              id: "copy-link-address",
              label: t("appMenu.copyLinkAddress"),
              icon: <Link2 size={15} />,
              onSelect: () => {
                close();
                void copy(linkHref);
              },
            },
            { id: "sep-link", separator: true },
          ] as ContextMenuItem[])
        : []),
      {
        id: "back",
        label: t("appMenu.back"),
        icon: <ArrowLeft size={15} />,
        disabled: historyIndex <= 0,
        onSelect: () => {
          close();
          navigate(-1);
        },
      },
      {
        id: "forward",
        label: t("appMenu.forward"),
        icon: <ArrowRight size={15} />,
        disabled: historyIndex >= maxHistoryIndexRef.current,
        onSelect: () => {
          close();
          navigate(1);
        },
      },
      {
        id: "reload",
        label: t("appMenu.reload"),
        icon: <RotateCw size={15} />,
        onSelect: () => {
          close();
          window.location.reload();
        },
      },
      { id: "sep-1", separator: true },
      {
        id: "navigate",
        label: t("appMenu.navigate"),
        icon: <Compass size={15} />,
        submenu: goTo,
      },
      {
        id: "command-palette",
        label: t("appMenu.commandPalette"),
        icon: <Search size={15} />,
        onSelect: () => {
          close();
          window.dispatchEvent(new CustomEvent("gamelib:open-command-palette"));
        },
      },
      {
        id: "toggle-theme",
        label: t("appMenu.toggleTheme"),
        icon: isLight ? <Sun size={15} /> : <Moon size={15} />,
        onSelect: () => {
          close();
          setTheme(isLight ? "dark" : "light");
        },
      },
      {
        id: "big-screen",
        label: t("topnav.enterBigScreen"),
        icon: <Monitor size={15} />,
        onSelect: () => {
          close();
          void setBigScreen(true);
        },
      },
      { id: "sep-2", separator: true },
      {
        id: "copy-app-link",
        label: t("appMenu.copyLink"),
        icon: <Link2 size={15} />,
        onSelect: () => {
          close();
          void copy(window.location.href);
        },
      },
    ];
  }, [close, copy, historyIndex, isLight, navigate, position?.linkHref, setBigScreen, setTheme, t]);

  if (!position) return null;

  return (
    <ContextMenu
      x={position.x}
      y={position.y}
      items={items}
      onClose={close}
      ariaLabel="GameIndex"
      className="app-context-menu"
    />
  );
}
