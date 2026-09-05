import { Search, X, Loader2, HelpCircle, Layers } from "lucide-react";
import type { PaletteCategory } from "./commandPaletteTypes";

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
  isSimpleMode: boolean;
  showInspector: boolean;
  onToggleInspector: () => void;
  onOpenCheatSheet: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
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
  isSimpleMode,
  showInspector,
  onToggleInspector,
  onOpenCheatSheet,
  t,
}: CommandPaletteHeaderProps) {
  return (
    <div className="command-palette-header">
      <div className="cmd-header-search-icon-wrapper">
        <Search className="command-palette-icon" aria-hidden="true" />
      </div>

      {scope !== "all" && (
        <div className="cmd-active-scope-pill" role="status">
          <span>{t(`commandPalette.scope${scope.charAt(0).toUpperCase() + scope.slice(1)}`)}</span>
          <button
            type="button"
            className="cmd-clear-scope-btn"
            onClick={onClearScope}
            title={t("commandPalette.clearScope")}
            aria-label={t("commandPalette.clearScope")}
          >
            <X size={11} />
          </button>
        </div>
      )}

      <input
        id={inputId}
        ref={inputRef}
        type="text"
        className="command-palette-input"
        placeholder={t("commandPalette.placeholder")}
        value={rawQuery}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />

      <div className="cmd-header-tools">
        {rawQuery.length > 0 && (
          <button
            type="button"
            className="cmd-clear-query-btn"
            onClick={onClearQuery}
            title={t("commandPalette.clear")}
            aria-label={t("commandPalette.clear")}
          >
            <X size={13} />
          </button>
        )}

        {isSearchingIgdb && (
          <div className="cmd-header-spinner-wrap" title={t("commandPalette.searchingIgdb")}>
            <Loader2 size={15} className="command-palette-spinner" />
          </div>
        )}

        <button
          type="button"
          className="cmd-cheatsheet-toggle-btn"
          onClick={onOpenCheatSheet}
          title={`${t("commandPalette.cheatSheet")} (Ctrl+H)`}
          aria-label={t("commandPalette.cheatSheet")}
        >
          <HelpCircle size={14} />
        </button>

        {!isSimpleMode && (
          <button
            type="button"
            className={`cmd-inspector-toggle-btn${showInspector ? " active" : ""}`}
            onClick={onToggleInspector}
            title={`${t("commandPalette.toggleInspector")} (Ctrl+P)`}
            aria-label={t("commandPalette.toggleInspector")}
          >
            <Layers size={14} />
          </button>
        )}

        <kbd className="command-palette-esc" title={t("commandPalette.hintClose")}>
          Esc
        </kbd>
      </div>
    </div>
  );
}
