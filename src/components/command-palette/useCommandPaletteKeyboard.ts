import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaletteCategory, PaletteItem } from "./commandPaletteTypes";

export interface UseCommandPaletteKeyboardParams {
  items: PaletteItem[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  scope: PaletteCategory;
  setScope: (scope: PaletteCategory) => void;
  rawQuery: string;
  setRawQuery: (q: string) => void;
  isSimpleMode: boolean;
  setShowInspector: React.Dispatch<React.SetStateAction<boolean>>;
  setActionDrawerOpen: (open: boolean) => void;
  setCheatSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRandomGameKey: React.Dispatch<React.SetStateAction<number>>;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  listRef: React.RefObject<HTMLDivElement | null>;
}

export function useCommandPaletteKeyboard(params: UseCommandPaletteKeyboardParams) {
  const {
    items,
    selectedIndex,
    setSelectedIndex,
    scope,
    setScope,
    rawQuery,
    isSimpleMode,
    setShowInspector,
    setActionDrawerOpen,
    setCheatSheetOpen,
    setRandomGameKey,
    showToast,
    t,
    listRef,
  } = params;

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex((prev) => (items.length === 0 ? 0 : Math.min(prev, items.length - 1)));
  }, [items.length, setSelectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.querySelector<HTMLElement>(".cmd-item.is-selected");
    activeEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex, listRef]);

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(items.length - 1, prev + 5));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(0, prev - 5));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSelectedIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSelectedIndex(Math.max(0, items.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const currentItem = items[selectedIndex];
      if (currentItem) {
        if ((e.ctrlKey || e.metaKey) && currentItem.onSecondarySelect) {
          currentItem.onSecondarySelect();
        } else {
          currentItem.onSelect();
        }
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const scopes: PaletteCategory[] = [
        "all",
        "games",
        "wishlist",
        "actions",
        "navigation",
        "themes",
        "downloads",
        "store",
        "utility",
      ];
      const currIdx = scopes.indexOf(scope);
      const nextIdx = e.shiftKey
        ? (currIdx - 1 + scopes.length) % scopes.length
        : (currIdx + 1) % scopes.length;
      setScope(scopes[nextIdx]);
      setSelectedIndex(0);
    } else if (e.key === "Delete" && e.shiftKey) {
      const currentItem = items[selectedIndex];
      if (currentItem?.isRecent && currentItem.onDeleteRecent) {
        e.preventDefault();
        currentItem.onDeleteRecent();
      }
    } else if (e.key === "Backspace" && rawQuery === "" && scope !== "all") {
      e.preventDefault();
      setScope("all");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
      e.preventDefault();
      setCheatSheetOpen((prev) => !prev);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      setRandomGameKey((k) => k + 1);
      showToast(t("commandPalette.rerolledGameToast"), "info");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      const currentItem = items[selectedIndex];
      if (currentItem?.gameData || currentItem?.storeData || currentItem?.calcData) {
        e.preventDefault();
        setActionDrawerOpen(true);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      if (!isSimpleMode) {
        e.preventDefault();
        setShowInspector((prev) => !prev);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      const currentItem = items[selectedIndex];
      if (currentItem?.gameData?.path) {
        e.preventDefault();
        invoke("open_folder", { path: currentItem.gameData.path }).catch(() => {
          showToast(t("commandPalette.folderNotFound"), "error");
        });
      }
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      const currentItem = items[selectedIndex];
      if (currentItem?.gameData?.name) {
        e.preventDefault();
        navigator.clipboard.writeText(currentItem.gameData.name);
        showToast(t("commandPalette.copiedToClipboard"), "info");
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      const currentItem = items[selectedIndex];
      if (currentItem) {
        e.preventDefault();
        const textToCopy =
          currentItem.calcData?.result || currentItem.gameData?.path || currentItem.title;
        navigator.clipboard.writeText(textToCopy);
        showToast(t("commandPalette.copiedToClipboard"), "info");
      }
    }
  };

  return { handleInputKeyDown };
}
