// "Mods" tab on the game detail page. Delegates to the shared ModWorkspace
// (variant="subtab") so it matches the main Mods page exactly.

import { useLanguage } from "../../context/LanguageContext";
import type { Game } from "../../types/game";
import ModWorkspace from "./workspace/ModWorkspace";
import "../../styles/page-mods.css";
import "./discover/mods-discover.css";

interface ModsTabProps {
  game: Game;
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
  defaultSubtab?: "installed" | "discover";
}

export default function ModsTab({
  game,
  onModsSized,
  defaultSubtab = "installed",
}: ModsTabProps) {
  const { t } = useLanguage();

  return (
    <div className="mods-tab" role="region" aria-label={t("mods.eyebrow")}>
      <ModWorkspace
        game={game}
        variant="subtab"
        onModsSized={onModsSized}
        initialTab={defaultSubtab}
      />
    </div>
  );
}
