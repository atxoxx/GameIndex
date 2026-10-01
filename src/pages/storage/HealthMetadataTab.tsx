import { useMemo, useState } from "react";
import type { Game } from "../../types/game";
import { gameDisplayName } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import type { ArtGap, MetadataGap, MetadataIssue } from "./health";
import { HealthEmptyState } from "./HealthEmptyState";

interface Props {
  games: Game[];
  issues: MetadataIssue[];
  onEnrich: (game: Game) => Promise<void>;
  onEnrichAll: (ids: string[]) => void;
}

const METADATA_GAP_KEYS: Record<MetadataGap, string> = {
  description: "storage.health.metadata.gap.description",
  developer: "storage.health.metadata.gap.developer",
  publisher: "storage.health.metadata.gap.publisher",
  genres: "storage.health.metadata.gap.genres",
};

const ART_GAP_KEYS: Record<ArtGap, string> = {
  cover: "storage.health.metadata.gap.cover",
  icon: "storage.health.metadata.gap.icon",
  banner: "storage.health.metadata.gap.banner",
  logo: "storage.health.metadata.gap.logo",
};

export function HealthMetadataTab({ games, issues, onEnrich, onEnrichAll }: Props) {
  const { t } = useLanguage();
  const [busyId, setBusyId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  if (issues.length === 0) {
    return (
      <HealthEmptyState
        titleKey="storage.health.metadata.emptyTitle"
        descKey="storage.health.metadata.emptyDesc"
      />
    );
  }

  const enrich = async (game: Game) => {
    setBusyId(game.id);
    try {
      await onEnrich(game);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="health-tab">
      <div className="health-tab-toolbar">
        <span className="health-tab-toolbar-text">
          {t("storage.health.metadata.lead", { count: issues.length })}
        </span>
        <Button variant="primary" size="sm" onClick={() => onEnrichAll(issues.map((i) => i.gameId))}>
          {t("storage.health.metadata.fetchAll")}
        </Button>
      </div>
      <ul className="health-issue-list">
        {issues.map((issue) => {
          const game = byId.get(issue.gameId);
          if (!game) return null;
          return (
            <li key={issue.gameId} className="health-issue">
              <span className="health-issue-severity health-issue-severity--info" aria-hidden="true" />
              <div className="health-issue-body">
                <div className="health-issue-headline">
                  <span className="health-issue-name">{gameDisplayName(game)}</span>
                </div>
                <div className="health-gap-badges">
                  {issue.metadataGaps.map((gap) => (
                    <span key={gap} className="health-badge health-badge--info">
                      {t(METADATA_GAP_KEYS[gap])}
                    </span>
                  ))}
                  {issue.artGaps.map((gap) => (
                    <span key={gap} className="health-badge health-badge--warning">
                      {t(ART_GAP_KEYS[gap])}
                    </span>
                  ))}
                </div>
              </div>
              <div className="health-issue-actions">
                <Button variant="primary" size="sm" isLoading={busyId === game.id} onClick={() => void enrich(game)}>
                  {t("storage.health.metadata.fetch")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
