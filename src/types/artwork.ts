/** Artwork files stored for one game, shown in the edit modal. */
export type GameArtworkSlot = "cover" | "hero" | "logo" | "icon";

export interface GameArtworkFile {
  /** Opaque key accepted by `delete_game_artwork`. */
  fileKey: string;
  fileName: string;
  /** Slot derived from the file stem; null for unrecognised names. */
  slot: GameArtworkSlot | null;
  /** Thumbnails are generated siblings of cover/hero artwork. */
  thumbnail: boolean;
  sizeBytes: number;
  /** Unix seconds. */
  modifiedAt: number;
  /** `file://` URL; the renderer converts it to the asset protocol. */
  url: string;
  /** True when one of the game's artwork columns points at this file. */
  referenced: boolean;
  /** Current store or a pre-Electron artwork folder. */
  location: "current" | "legacy";
}

export interface DeleteGameArtworkResult {
  deleted: boolean;
  freedBytes: number;
  /** Slots whose stored artwork pointed at the deleted file. */
  clearedSlots: GameArtworkSlot[];
}
