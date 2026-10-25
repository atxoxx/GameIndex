import { HelpCircle, Loader2, Search, X } from "lucide-react";
import type { PaletteCategory } from "./commandPaletteTypes";
import { PALETTE_SCOPES } from "./commandPaletteScopes";

interface CommandPaletteHeaderProps {
  inputId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  rawQuery: string;
  onQueryChange: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  scope: PaletteCategory;
  onClearScope: () => void;
  onClearQuery: () => void;
  isSearchingIgdb: boolean;
  onOpenCheatSheet: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  listId?: string;
  activeDescendantId?: string;
  itemCount?: number;
  compact?: boolean;
}

export default function CommandPaletteHeader({
  inputId,
  inputRef,
  rawQuery,
  onQueryChange,
  onKeyDown,
  scope,
  onClearScope,
  onClearQuery,
  isSearchingIgdb,
  onOpenCheatSheet,
  t,
  listId,
  activeDescendantId,
  itemCount,
  compact = false,
}: CommandPaletteHeaderProps) {
  const scopeDef = PALETTE_SCOPES.find((entry) => entry.id === scope);

  return (
    <div className="cp-header">
      <Search className="cp-header-icon" aria-hidden="true" />

      {compact && scopeDef && scope !== "all" && (
        <button
          type="button"
          className="cp-header-scope"
          onClick={onClearScope}
          title={t("commandPalette.clearScope")}
        >
          <span>{t(scopeDef.labelKey)}</span>
          <X size={11} aria-hidden="true" />
        </button>
      )}

      <input
        id={inputId}
        ref={inputRef}
        type="text"
        className="cp-input"
        placeholder={t("commandPalette.placeholder")}
        value={rawQuery}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={!!listId}
        aria-controls={listId}
        aria-activedescendant={activeDescendantId}
        aria-label={t("commandPalette.placeholder")}
      />

      <div className="cp-header-tools">
        {isSearchingIgdb && (
          <span className="cp-header-spinner" title={t("commandPalette.searchingIgdb")}>
            <Loader2 size={14} className="cp-spinner" aria-hidden="true" />
          </span>
        )}

        {itemCount !== undefined && rawQuery.length > 0 && (
          <span className="cp-header-count" title={t("commandPalette.itemCount", { count: itemCount })}>
            {itemCount}
          </span>
        )}

        {rawQuery.length > 0 && (
          <button
            type="button"
            className="cp-icon-btn"
            onClick={onClearQuery}
            title={`${t("commandPalette.clear")} (Esc)`}
            aria-label={t("commandPalette.clear")}
          >
            <X size={14} />
          </button>
        )}

        <button
          type="button"
          className="cp-icon-btn"
          onClick={onOpenCheatSheet}
          title={`${t("commandPalette.cheatSheet")} (Ctrl+H)`}
          aria-label={t("commandPalette.cheatSheet")}
        >
          <HelpCircle size={15} />
        </button>

        <kbd className="cp-kbd cp-header-esc" title={t("commandPalette.hintClose")}>
          Esc
        </kbd>
      </div>
    </div>
  );
}
