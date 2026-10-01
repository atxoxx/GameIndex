import { useMemo, useState } from "react";
import type { Game } from "../../types/game";
import { gameDisplayName } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import type { StalePathIssue } from "./health";
import { HealthEmptyState } from "./HealthEmptyState";

interface Props {
  games: Game[];
  issues: StalePathIssue[];
  onRelink: (game: Game) => Promise<void>;
  onLocate: (game: Game) => Promise<void>;
  onClear: (game: Game, field: StalePathIssue["field"]) => void;
  onOpenFolder: (game: Game) => void;
}

export function HealthPathsTab({ games, issues, onRelink, onLocate, onClear, onOpenFolder }: Props) {
  const { t } = useLanguage();
  const [busyId, setBusyId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  if (issues.length === 0) {
    return (
      <HealthEmptyState
        titleKey="storage.health.paths.emptyTitle"
        descKey="storage.health.paths.emptyDesc"
      />
    );
  }

  const run = async (game: Game, action: (g: Game) => Promise<void>) => {
    setBusyId(game.id);
    try {
      await action(game);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ul className="health-issue-list">
      {issues.map((issue) => {
        const game = byId.get(issue.gameId);
        if (!game) return null;
        const isExecutable = issue.field === "path";
        return (
          <li key={`${issue.gameId}:${issue.field}`} className="health-issue">
            <span className="health-issue-severity health-issue-severity--critical" aria-hidden="true" />
            <div className="health-issue-body">
              <div className="health-issue-headline">
                <span className="health-issue-name">{gameDisplayName(game)}</span>
                <span className="health-badge health-badge--critical">
                  {isExecutable
                    ? t("storage.health.paths.executable")
                    : t("storage.health.paths.installFolder")}
                </span>
              </div>
              <span className="health-issue-path" title={issue.path}>
                {issue.path}
              </span>
            </div>
            <div className="health-issue-actions">
              {isExecutable ? (
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={busyId === game.id}
                  onClick={() => void run(game, onLocate)}
                >
                  {t("storage.health.paths.locate")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={busyId === game.id}
                  onClick={() => void run(game, onRelink)}
                >
                  {t("storage.health.paths.relink")}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => onOpenFolder(game)}>
                {t("storage.health.paths.openContaining")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onClear(game, issue.field)}>
                {t("storage.health.paths.clear")}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
