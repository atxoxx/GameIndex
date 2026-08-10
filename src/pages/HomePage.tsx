import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { type Game } from "../types/game";
import HomeHero from "../components/hero/HomeHero";
import ContinuePlayingRail from "../components/library/ContinuePlayingRail";
import RecentlyAddedRail from "../components/library/RecentlyAddedRail";

/**
 * Home — the app's "wow" first-run surface.
 *
 * A cinematic spotlight hero (trailer-backed featured game + friends
 * strip) leads the page; the editorial rails (Continue Playing / Recently
 * Added) carry everyday browsing into the same screen. The hero renders
 * its own welcome state when the library is empty, so the page is never
 * a blank wall.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { games } = useGames();

  const isEmpty = games.length === 0;

  const openGame = (game: Game) => navigate(`/library/${game.id}`);

  return (
    <div className="home-page">
      <HomeHero games={games} onOpenGame={openGame} />
      {!isEmpty && <ContinuePlayingRail games={games} onCardClick={openGame} />}
      {!isEmpty && games.length >= 4 && <RecentlyAddedRail games={games} onCardClick={openGame} />}
    </div>
  );
}
