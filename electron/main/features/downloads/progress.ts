/**
 * Torrent per-file progress, clamped.
 *
 * WebTorrent computes `File.downloaded` by summing the bytes it holds for the
 * pieces that overlap the file, then subtracting the "irrelevant" bytes of the
 * first and last piece (data that belongs to the neighbouring files). For a
 * tiny file sharing a large piece — an .nfo or .url inside a multi-GB game
 * torrent — that subtraction can exceed the file's length, producing a
 * negative byte count and a percentage like "-201151 %".
 *
 * The UI only ever needs a 0..1 fraction, so clamp at the source.
 */
export interface ClampedFileProgress {
  length: number;
  downloaded: number;
  progress: number;
}

export function clampFileProgress(
  downloaded: unknown,
  length: unknown,
): ClampedFileProgress {
  const safeLength = Math.max(0, Number(length) || 0);
  const raw = Number(downloaded);
  const bytes = Number.isFinite(raw)
    ? Math.max(0, Math.min(safeLength, raw))
    : 0;
  return {
    length: safeLength,
    downloaded: bytes,
    progress: safeLength > 0 ? bytes / safeLength : 0,
  };
}
