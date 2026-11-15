// Big Screen game detail - dispatcher.
//
// Every interface layout owns a genuinely different game page (hero
// composition, section navigation and information order). This module
// resolves the game and mounts the active layout's page; the shared
// controller in `layouts/detail/shared` keeps launch/install/favourite,
// tab cycling and focus landing identical everywhere.

import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useGames } from "../../context/GameContext";
import { useActivePreset } from "../../context/BigScreenPrefsContext";
import { usePublishGameArtwork } from "../../utils/activeGameArtwork";
import { bigScreenParentOf } from "../../bigscreen/registry";
import { DetailNotFound } from "../bigscreen/layouts/detail/shared";
import GameIndexDetail from "../bigscreen/layouts/detail/GameIndexDetail";
import XboxDetail from "../bigscreen/layouts/detail/XboxDetail";
import SteamDetail from "../bigscreen/layouts/detail/SteamDetail";
import PlayStationDetail from "../bigscreen/layouts/detail/PlayStationDetail";
import SwitchDetail from "../bigscreen/layouts/detail/SwitchDetail";

export default function BigScreenGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { getGame } = useGames();
  const { id: layout } = useActivePreset();
  const game = gameId ? getGame(gameId) : undefined;

  usePublishGameArtwork(game?.coverArtUrl ?? game?.bannerUrl);

  const handleBack = useCallback(() => {
    navigate(bigScreenParentOf(location.pathname) ?? "/home");
  }, [location.pathname, navigate]);

  if (!game) {
    return (
      <div className="bstd bstd--missing" data-layout={layout}>
        <DetailNotFound onBack={handleBack} />
      </div>
    );
  }

  switch (layout) {
    case "xbox":
      return <XboxDetail game={game} />;
    case "steam":
      return <SteamDetail game={game} />;
    case "playstation":
      return <PlayStationDetail game={game} />;
    case "switch":
      return <SwitchDetail game={game} />;
    case "gameindex":
    default:
      return <GameIndexDetail game={game} />;
  }
}
