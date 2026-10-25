import type { PaletteItem } from "./commandPaletteTypes";
import { itemHasDrawerActions } from "./commandPaletteUtils";

interface CommandPaletteFooterProps {
  selectedItem: PaletteItem | null;
  itemCount: number;
  canPeek: boolean;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="cp-hint">
      <kbd className="cp-kbd">{keys}</kbd>
      <span>{label}</span>
    </span>
  );
}

export default function CommandPaletteFooter({
  selectedItem,
  itemCount,
  canPeek,
  t,
}: CommandPaletteFooterProps) {
  const canOpenActions = itemHasDrawerActions(selectedItem);

  return (
    <footer className="cp-footer">
      <div className="cp-hints">
        <Hint keys="↑↓" label={t("commandPalette.hintNavigate")} />
        <Hint keys="↵" label={t("commandPalette.hintSelect")} />
        {canPeek && <Hint keys="Ctrl+↵" label={t("commandPalette.hintPreview")} />}
        {canOpenActions && <Hint keys="Alt+↵" label={t("commandPalette.hintActions")} />}
        {selectedItem?.pinnable && <Hint keys="Ctrl+P" label={t("commandPalette.hintPin")} />}
        <Hint keys="Esc" label={t("commandPalette.hintClose")} />
      </div>

      <span className="cp-footer-count">
        {t("commandPalette.itemCount", { count: itemCount })}
      </span>
    </footer>
  );
}
