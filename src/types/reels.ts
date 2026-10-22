/** Highlight-reel registry types (clips domain, v1). Mirrors
 *  `src-tauri/src/db/clips.rs` after serde camelCase rename. */

export interface Clip {
  id: string;
  path: string;
  gameId?: string;
  gameName?: string;
  title: string;
  /** `record` | `replay` | `import` */
  kind?: string;
  durationMs?: number;
  sizeBytes?: number;
  favorite: boolean;
  /** Unix ms when the footage was recorded. */
  createdAt: number;
  /** Unix ms when it entered the registry. */
  addedAt: number;
}

export interface Reel {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** Clip ids in playback order. */
  clipIds: string[];
}

export interface ReelsSnapshot {
  clips: Clip[];
  reels: Reel[];
}
