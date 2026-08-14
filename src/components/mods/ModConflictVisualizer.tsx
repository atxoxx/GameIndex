import { useLanguage } from "../../context/LanguageContext";
import type { GameMod, ModConflict } from "../../types/mods";

interface ModConflictVisualizerProps {
  selectedMod: GameMod;
  conflicts: ModConflict[];
  mods: GameMod[];
}

export default function ModConflictVisualizer({
  selectedMod,
  conflicts,
  mods,
}: ModConflictVisualizerProps) {
  const { t } = useLanguage();
  const modMap = new Map(mods.map((m) => [m.id, m]));
  const currentOrder = mods.indexOf(selectedMod);

  if (conflicts.length === 0) {
    return <p className="mods-nexus-hint">{t("mods.noConflicts")}</p>;
  }

  return (
    <div className="mods-conflict-container">
      <div className="mods-conflict-precedence-banner">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>{t("mods.precedenceNotice")}</span>
      </div>

      <div className="mods-conflict-panel">
        <ul className="mods-conflict-list">
          {conflicts.slice(0, 50).map((c) => {
            // Find highest order index among all conflicting mods
            const conflictingMods = c.modIds
              .map((id) => modMap.get(id))
              .filter((m): m is GameMod => m !== undefined);

            const highestOrderMod = conflictingMods.reduce((highest, curr) => {
              const order = mods.indexOf(curr);
              const highestIdx = mods.indexOf(highest);
              return order > highestIdx ? curr : highest;
            }, selectedMod);

            const isWinner = highestOrderMod.id === selectedMod.id;
            const highestOrder = mods.indexOf(highestOrderMod) + 1;

            return (
              <li key={c.relativePath} className="mods-conflict-item">
                <div className="mods-conflict-file-row">
                  <code>{c.relativePath}</code>
                  <span
                    className={`mods-conflict-status-pill ${
                      isWinner ? "winner" : "loser"
                    }`}
                  >
                    {isWinner
                      ? t("mods.precedenceWinner", { order: String(currentOrder + 1) })
                      : t("mods.precedenceLoser", { order: String(highestOrder) })}
                  </span>
                </div>
                <div className="mods-conflict-mods-row">
                  <span className="mods-conflict-label">{t("mods.filter.conflicts")}:</span>
                  {conflictingMods
                    .filter((m) => m.id !== selectedMod.id)
                    .map((m) => {
                      const order = mods.indexOf(m) + 1;
                      return (
                        <span key={m.id} className="mods-conflict-mod-chip">
                          #{order} {m.name}
                        </span>
                      );
                    })}
                </div>
              </li>
            );
          })}
        </ul>
        {conflicts.length > 50 && (
          <div className="mods-conflict-more">
            +{conflicts.length - 50} more file collisions
          </div>
        )}
      </div>
    </div>
  );
}
