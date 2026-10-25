import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaletteCategory, PaletteItem } from "./commandPaletteTypes";
import { SCOPE_ORDER } from "./commandPaletteScopes";
import { itemHasDrawerActions } from "./commandPaletteUtils";

export interface UseCommandPaletteKeyboardParams {
  items: PaletteItem[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  scope: PaletteCategory;
  setScope: (scope: PaletteCategory) => void;
  rawQuery: string;
  setPeekOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setActionDrawerOpen: (open: boolean) => void;
  setCheatSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRandomGameKey: React.Dispatch<React.SetStateAction<number>>;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  listRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Runs the row's primary action and records the query. */
  onExecute: (index: number) => void;
}

export function useCommandPaletteKeyboard(params: UseCommandPaletteKeyboardParams) {
  const {
    items,
    selectedIndex,
    setSelectedIndex,
    scope,
    setScope,
    rawQuery,
    setPeekOpen,
    setActionDrawerOpen,
    setCheatSheetOpen,
    setRandomGameKey,
    showToast,
    t,
    listRef,
    inputRef,
    onExecute,
  } = params;

  // Keep the selected index within bounds.
  useEffect(() => {
    setSelectedIndex((prev) => (items.length === 0 ? 0 : Math.min(prev, items.length - 1)));
  }, [items.length, setSelectedIndex]);

  // Keep the active row visible while walking the list.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.querySelector<HTMLElement>(".cp-row.is-selected");
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, listRef]);

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    const currentItem = items[selectedIndex];

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
      if (e.ctrlKey || e.metaKey) {
        setPeekOpen((prev) => !prev);
      } else if (e.altKey) {
        if (itemHasDrawerActions(currentItem)) setActionDrawerOpen(true);
      } else {
        onExecute(selectedIndex);
      }
    } else if (e.key === "Tab") {
      // Tab leaves the search field for the result list; the list forwards
      // Tab again into the selected row's quick actions.
      e.preventDefault();
      listRef.current?.focus();
    } else if (e.key === "Delete" && e.shiftKey) {
      if (currentItem?.isRecent && currentItem.onDeleteRecent) {
        e.preventDefault();
        currentItem.onDeleteRecent();
      }
    } else if (e.key === "Backspace" && rawQuery === "" && scope !== "all") {
      e.preventDefault();
      setScope("all");
    } else if (e.altKey && /^[1-9]$/.test(e.key)) {
      const nextScope = SCOPE_ORDER[Number(e.key) - 1];
      if (nextScope) {
        e.preventDefault();
        setScope(nextScope);
        setSelectedIndex(0);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
      e.preventDefault();
      setCheatSheetOpen((prev) => !prev);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      currentItem?.onTogglePin?.();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      setRandomGameKey((k) => k + 1);
      showToast(t("commandPalette.rerolledGameToast"), "info");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      if (currentItem?.gameData?.path) {
        e.preventDefault();
        invoke("open_folder", { path: currentItem.gameData.path }).catch(() => {
          showToast(t("commandPalette.folderNotFound"), "error");
        });
      }
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      if (currentItem?.gameData?.name) {
        e.preventDefault();
        navigator.clipboard.writeText(currentItem.gameData.name);
        showToast(t("commandPalette.copiedToClipboard"), "info");
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      if (currentItem) {
        e.preventDefault();
        const textToCopy =
          currentItem.calcData?.result || currentItem.gameData?.path || currentItem.title;
        navigator.clipboard.writeText(textToCopy);
        showToast(t("commandPalette.copiedToClipboard"), "info");
      }
    }
  };

  /**
   * Keyboard handler for the list itself, so arrows/Enter keep working once
   * focus has moved off the input. Tab walks into the selected row's buttons.
   */
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      const list = listRef.current;
      const selectedButton = list?.querySelector<HTMLElement>(
        ".cp-row.is-selected .cp-row-action"
      );
      if (!e.shiftKey && selectedButton) {
        e.preventDefault();
        selectedButton.focus();
      } else if (e.shiftKey) {
        e.preventDefault();
        inputRef.current?.focus();
      } else {
        e.preventDefault();
        inputRef.current?.focus();
      }
      return;
    }

    // Events from a quick-action button belong to the button: let Enter/Space
    // activate it instead of also running the row's primary action.
    if (e.target !== e.currentTarget) return;

    handleInputKeyDown(e);
  };

  return { handleInputKeyDown, handleListKeyDown };
}
