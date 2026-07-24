import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { type Game } from "../types/game";
import LibraryHero from "../components/library/LibraryHero";
import ContinuePlayingRail from "../components/library/ContinuePlayingRail";
import RecentlyAddedRail from "../components/library/RecentlyAddedRail";

/**
 * Home — the app's "wow" first-run surface.
 *
 * Layers a bold brand-gradient hero (the signature violet→cyan→magenta
 * mesh) over the personalized library overview: the greeting + quick
 * actions live in the gradient hero, the aggregate stats reuse
 * `LibraryHero`, and the editorial rails (Continue Playing / Recently
 * Added) carry the everyday browsing into the same screen.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { games } = useGames();

  const isEmpty = games.length === 0;

  const openGame = (game: Game) => navigate(`/library/${game.id}`);

  return (
    <div className="home-page">
      {!isEmpty && <LibraryHero games={games} />}
      {!isEmpty && <ContinuePlayingRail games={games} onCardClick={openGame} />}
      {!isEmpty && games.length >= 4 && <RecentlyAddedRail games={games} onCardClick={openGame} />}
    </div>
  );
}
