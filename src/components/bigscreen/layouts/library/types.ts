import type { Game } from "../../../../types/game";

export interface LibraryLayoutProps {
  /** Filtered + sorted collection. */
  games: Game[];
  /** Unfiltered library size. */
  total: number;
  /** The game the controller is on; never null while `games` is non-empty. */
  focused: Game | null;
  isRunning: boolean;
  /** Recently played games, for layouts that open with a resume row. */
  recent: Game[];
  /** Shared filter bar, placed differently per layout. */
  filters: React.ReactNode;
  /** Grid/empty surface when the filtered list is empty. */
  empty: React.ReactNode;
  onSelect: (game: Game) => void;
  /** Launch the focused game. */
  onPlay: () => void;
  autoFocusFirst?: boolean;
}
