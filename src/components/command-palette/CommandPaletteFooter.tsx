import type { PaletteItem } from "./commandPaletteTypes";

interface CommandPaletteFooterProps {
  selectedItem: PaletteItem | null;
  itemCount: number;
  isSimpleMode: boolean;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function CommandPaletteFooter({
  selectedItem,
  itemCount,
  isSimpleMode,
  t,
}: CommandPaletteFooterProps) {
  const isGame = !!selectedItem?.gameData;
  const hasDrawerActions = isGame || !!selectedItem?.storeData || !!selectedItem?.calcData;

  return (
    <footer className="command-palette-footer">
      <div className="command-palette-hints">
        <span className="command-palette-hint">
          <kbd className="command-palette-key-pill">↑↓</kbd>
          <span>{t("commandPalette.hintNavigate")}</span>
        </span>

        <span className="command-palette-hint">
          <kbd className="command-palette-key-pill">↵</kbd>
          <span>{t("commandPalette.hintSelect")}</span>
        </span>

        {isGame && (
          <span className="command-palette-hint">
            <kbd className="command-palette-key-pill">Ctrl+↵</kbd>
            <span>{t("commandPalette.hintDetails")}</span>
          </span>
        )}

        {hasDrawerActions && (
          <span className="command-palette-hint">
            <kbd className="command-palette-key-pill">Ctrl+K</kbd>
            <span>{t("commandPalette.actionsMenu")}</span>
          </span>
        )}

        {!isSimpleMode && (
          <span className="command-palette-hint">
            <kbd className="command-palette-key-pill">Tab</kbd>
            <span>{t("commandPalette.hintScope")}</span>
          </span>
        )}

        <span className="command-palette-hint">
          <kbd className="command-palette-key-pill">Ctrl+H</kbd>
          <span>{t("commandPalette.hintHelp")}</span>
        </span>

        <span className="command-palette-hint">
          <kbd className="command-palette-key-pill">Esc</kbd>
          <span>{t("commandPalette.hintClose")}</span>
        </span>
      </div>

      <div className="cmd-footer-right">
        {itemCount > 0 && (
          <span className="cmd-footer-counter">{itemCount}</span>
        )}
        <span className="cmd-footer-brand">GameIndex HUD</span>
      </div>
    </footer>
  );
}
