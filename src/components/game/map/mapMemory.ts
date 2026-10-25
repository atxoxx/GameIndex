/**
 * Per-game map selections.
 *
 * A provider can expose several maps for the same game (MapGenie's regions,
 * Wand's sub-maps). Reopening the launchpad should land on the map the reader
 * chose last time, per provider — not reset to the provider's default.
 */

export interface MapMemory {
  /** provider id → chosen map URL */
  maps: Record<string, string>;
  /** provider opened most recently */
  provider: string | null;
}

function storageKey(gameId: string | undefined): string | null {
  return gameId ? `gamelib.maps.selection.${gameId}` : null;
}

export function readMapMemory(gameId: string | undefined): MapMemory {
  const key = storageKey(gameId);
  if (!key) return { maps: {}, provider: null };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { maps: {}, provider: null };
    const parsed = JSON.parse(raw) as Partial<MapMemory>;
    return {
      maps:
        parsed.maps && typeof parsed.maps === "object" ? parsed.maps : {},
      provider: typeof parsed.provider === "string" ? parsed.provider : null,
    };
  } catch {
    return { maps: {}, provider: null };
  }
}

export function writeMapMemory(gameId: string | undefined, memory: MapMemory): void {
  const key = storageKey(gameId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(memory));
  } catch {
    // Storage unavailable — the launchpad simply starts from defaults.
  }
}

export function rememberMapChoice(
  gameId: string | undefined,
  providerId: string,
  mapUrl: string,
): void {
  const memory = readMapMemory(gameId);
  writeMapMemory(gameId, {
    maps: { ...memory.maps, [providerId]: mapUrl },
    provider: providerId,
  });
}
