import { useMemo } from "react";
import type { Game } from "../../types/game";
import { gameDisplayName, formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import type { BacklogIssue } from "./health";
import { HealthEmptyState } from "./HealthEmptyState";

interface Props {
  games: Game[];
  issues: BacklogIssue[];
  onLaunch: (game: Game) => void;
  onOpenFolder: (game: Game) => void;
  onUninstall: (game: Game) => void;
}

export function HealthBacklogTab({ games, issues, onLaunch, onOpenFolder, onUninstall }: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  if (issues.length === 0) {
    return (
      <HealthEmptyState
        titleKey="storage.health.backlog.emptyTitle"
        descKey="storage.health.backlog.emptyDesc"
      />
    );
  }

  return (
    <ul className="health-issue-list">
      {issues.map((issue) => {
        const game = byId.get(issue.gameId);
        if (!game) return null;
        return (
          <li key={issue.gameId} className="health-issue">
            <span
              className={`health-issue-severity health-issue-severity--${
                issue.reason === "hugeUnplayed" ? "critical" : "info"
              }`}
              aria-hidden="true"
            />
            <div className="health-issue-body">
              <div className="health-issue-headline">
                <span className="health-issue-name">{gameDisplayName(game)}</span>
                <span
                  className={`health-badge health-badge--${
                    issue.reason === "hugeUnplayed" ? "critical" : "muted"
                  }`}
                >
                  {issue.reason === "hugeUnplayed"
                    ? t("storage.health.backlog.huge")
                    : t("storage.health.backlog.never")}
                </span>
              </div>
              <span className="health-issue-path" title={game.sizeRootPath || game.path}>
                {game.platform || t("storage.section.unknown")}
              </span>
            </div>
            {issue.sizeBytes > 0 && (
              <span className="health-issue-size">{formatSize(issue.sizeBytes, unit)}</span>
            )}
            <div className="health-issue-actions">
              <Button variant="primary" size="sm" onClick={() => onLaunch(game)}>
                {t("storage.health.backlog.play")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onOpenFolder(game)}>
                {t("downloadRow.openFolder")}
              </Button>
              <Button variant="danger" size="sm" onClick={() => onUninstall(game)}>
                {t("storage.uninstall")}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
