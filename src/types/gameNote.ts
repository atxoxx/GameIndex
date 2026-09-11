/**
 * Per-game user notes / guides, persisted in the `game_notes` domain
 * (mirrors `src-tauri/src/db/game_notes.rs::GameNote`).
 *
 * `content` is Markdown. Timestamps are unix milliseconds.
 */
export interface GameNote {
  id: string;
  gameId: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}
