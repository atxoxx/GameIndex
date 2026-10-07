// Standalone "Discover Mods" Page (/mods/discover).
// Provides an aggregated, multi-source mod browser across all popular mod repositories.

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Boxes } from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button, PageHeader } from "../../components/ui";
import ModsDiscoverView from "../../components/mods/discover/ModsDiscoverView";
import { gameDisplayName } from "../../types/game";
import "../../styles/page-mods.css";
import "../../components/mods/discover/mods-discover.css";

export default function ModsDiscoverPage() {
  const { games } = useGames();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlGameId = searchParams.get("gameId");
  const candidates = useMemo(
    () =>
      games
        .filter((g) => g.installed !== false)
        .sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b))),
    [games],
  );

  const [activeGameId, setActiveGameId] = useState<string | null>(
    urlGameId || (candidates[0]?.id ?? null),
  );

  useEffect(() => {
    if (urlGameId && urlGameId !== activeGameId) {
      setActiveGameId(urlGameId);
    }
  }, [urlGameId]);

  const handleGameSelect = (newGameId: string) => {
    setActiveGameId(newGameId);
    setSearchParams({ gameId: newGameId }, { replace: true });
  };

  const selectedGame = useMemo(
    () => candidates.find((g) => g.id === activeGameId) ?? candidates[0] ?? null,
    [candidates, activeGameId],
  );

  return (
    <div className="mods-discover-page">
      <PageHeader
        eyebrow={t("mods.eyebrow")}
        title={t("mods.discover.title")}
        description={t("mods.discover.subtitle")}
        actions={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Boxes size={14} />}
            onClick={() => navigate("/mods")}
          >
            {t("mods.discover.openManager")}
          </Button>
        }
      />

      <ModsDiscoverView
        game={selectedGame}
        games={candidates}
        onSelectGame={handleGameSelect}
        variant="page"
      />
    </div>
  );
}
