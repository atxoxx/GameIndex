// "Mods" tab on the game detail page — thin wrapper around the
// shared dual-pane ModManager so the main Mods page renders the
// exact same surface.

import type { Game } from "../../types/game";
import ModManager from "./ModManager";

export default function ModsTab({
  game,
  onModsSized,
}: {
  game: Game;
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
}) {
  return (
    <div className="mods-tab">
      <ModManager game={game} onModsSized={onModsSized} />
    </div>
  );
}
