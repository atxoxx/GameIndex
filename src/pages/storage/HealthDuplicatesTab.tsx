import { useState } from "react";
import { gameDisplayName } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import type { DuplicateGroup } from "./health";
import { HealthEmptyState } from "./HealthEmptyState";

interface Props {
  groups: DuplicateGroup[];
  onRemove: (ids: string[]) => void;
}

export function HealthDuplicatesTab({ groups, onRemove }: Props) {
  const { t } = useLanguage();
  const [keepers, setKeepers] = useState<Record<string, string>>({});

  if (groups.length === 0) {
    return (
      <HealthEmptyState
        titleKey="storage.health.duplicates.emptyTitle"
        descKey="storage.health.duplicates.emptyDesc"
      />
    );
  }

  return (
    <ul className="health-duplicate-list">
      {groups.map((group) => {
        const keepId = keepers[group.key] ?? group.keepId;
        const removeIds = group.games.filter((g) => g.id !== keepId).map((g) => g.id);
        return (
          <li key={group.key} className="health-duplicate-group">
            <div className="health-duplicate-header">
              <span className="health-badge health-badge--warning">
                {group.reason === "samePath"
                  ? t("storage.health.duplicates.samePath")
                  : t("storage.health.duplicates.sameName")}
              </span>
              <span className="health-duplicate-count">
                {t("storage.health.duplicates.count", { count: group.games.length })}
              </span>
            </div>
            <ul className="health-duplicate-games">
              {group.games.map((game) => (
                <li key={game.id} className="health-duplicate-game">
                  <label className="health-duplicate-pick">
                    <input
                      type="radio"
                      name={`health-dupe-${group.key}`}
                      checked={keepId === game.id}
                      onChange={() => setKeepers((prev) => ({ ...prev, [group.key]: game.id }))}
                    />
                    <span className="health-duplicate-pick-label">
                      {t("storage.health.duplicates.keep")}
                    </span>
                  </label>
                  <div className="health-duplicate-info">
                    <span className="health-issue-name">{gameDisplayName(game)}</span>
                    <span className="health-issue-path" title={game.sizeRootPath || game.path}>
                      {game.sizeRootPath || game.path || t("storage.health.duplicates.noPath")}
                    </span>
                    <span className="health-duplicate-meta">
                      {game.platform || t("storage.section.unknown")}
                      {game.installed ? ` · ${t("storage.health.duplicates.installed")}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="health-duplicate-actions">
              <Button variant="danger" size="sm" onClick={() => onRemove(removeIds)}>
                {t("storage.health.duplicates.remove", {
                  count: removeIds.length,
                  plural: removeIds.length === 1 ? "" : "s",
                })}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
