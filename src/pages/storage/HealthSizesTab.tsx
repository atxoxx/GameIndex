import { useMemo, useState } from "react";
import type { Game } from "../../types/game";
import { gameDisplayName, formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import type { SizeIssue } from "./health";
import { HealthEmptyState } from "./HealthEmptyState";

interface Props {
  games: Game[];
  issues: SizeIssue[];
  onRemeasure: (game: Game) => Promise<void>;
  onRemeasureAll: (ids: string[]) => void;
}

export function HealthSizesTab({ games, issues, onRemeasure, onRemeasureAll }: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const [busyId, setBusyId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  if (issues.length === 0) {
    return (
      <HealthEmptyState
        titleKey="storage.health.sizes.emptyTitle"
        descKey="storage.health.sizes.emptyDesc"
      />
    );
  }

  const remeasure = async (game: Game) => {
    setBusyId(game.id);
    try {
      await onRemeasure(game);
    } finally {
      setBusyId(null);
    }
  };

  const reasonLabel = (issue: SizeIssue): string => {
    if (issue.reason === "neverMeasured") return t("storage.health.sizes.reasonNever");
    if (issue.reason === "missingTimestamp") return t("storage.health.sizes.reasonNoTimestamp");
    return t("storage.health.sizes.reasonOld", { days: issue.ageDays ?? 0 });
  };

  return (
    <div className="health-tab">
      <div className="health-tab-toolbar">
        <span className="health-tab-toolbar-text">
          {t("storage.health.sizes.lead", { count: issues.length })}
        </span>
        <Button variant="primary" size="sm" onClick={() => onRemeasureAll(issues.map((i) => i.gameId))}>
          {t("storage.health.sizes.remeasureAll")}
        </Button>
      </div>
      <ul className="health-issue-list">
        {issues.map((issue) => {
          const game = byId.get(issue.gameId);
          if (!game) return null;
          return (
            <li key={issue.gameId} className="health-issue">
              <span
                className={`health-issue-severity health-issue-severity--${
                  issue.reason === "neverMeasured" ? "warning" : "info"
                }`}
                aria-hidden="true"
              />
              <div className="health-issue-body">
                <div className="health-issue-headline">
                  <span className="health-issue-name">{gameDisplayName(game)}</span>
                  <span className="health-badge health-badge--muted">{reasonLabel(issue)}</span>
                </div>
                <span className="health-issue-path" title={game.sizeRootPath || game.path}>
                  {game.sizeRootPath || game.path || t("storage.health.duplicates.noPath")}
                </span>
              </div>
              {game.sizeBytes != null && game.sizeBytes > 0 && (
                <span className="health-issue-size">{formatSize(game.sizeBytes, unit)}</span>
              )}
              <div className="health-issue-actions">
                <Button variant="primary" size="sm" isLoading={busyId === game.id} onClick={() => void remeasure(game)}>
                  {t("storage.health.sizes.remeasure")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
