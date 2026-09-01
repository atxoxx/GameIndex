import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Game } from "../types/game";

interface GameSelectorsValue {
  games: Game[];
  gamesHydrated: boolean;
  getGame: (id: string) => Game | undefined;
}

const GameSelectorsContext = createContext<GameSelectorsValue | null>(null);

export function GameSelectorsProvider({
  games,
  gamesHydrated,
  getGame,
  children,
}: GameSelectorsValue & { children: ReactNode }) {
  const value = useMemo(() => ({ games, gamesHydrated, getGame }), [games, gamesHydrated, getGame]);
  return <GameSelectorsContext.Provider value={value}>{children}</GameSelectorsContext.Provider>;
}

export function useGameSelectors(): GameSelectorsValue {
  const value = useContext(GameSelectorsContext);
  if (!value) throw new Error("useGameSelectors must be used within GameSelectorsProvider");
  return value;
}

export function useSelectedGames(): Game[] {
  return useGameSelectors().games;
}
