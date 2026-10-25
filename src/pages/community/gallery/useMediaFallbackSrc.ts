import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

// Map a capture extension to a MIME type so the Blob URL renders in
// `<img>`/`<video>` without relying on content sniffing.
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Resolve a capture file to a displayable URL.
 *
 * `convertFileSrc` (the asset protocol) is tried first. Capture folders live
 * outside its scope, so a media element error falls back to `read_media_file`
 * and a Blob URL that is revoked when the path changes or the component
 * unmounts — memory stays bounded by what is mounted.
 */
export function useMediaFallbackSrc(path: string) {
  const [src, setSrc] = useState<string>(() => convertFileSrc(path));
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const inflightRef = useRef(false);
  // Bumped on every path change/unmount so a late-resolving fetch for a
  // previous path can't install a Blob URL that is never revoked.
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    setFailed(false);
    inflightRef.current = false;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setSrc(convertFileSrc(path));
    return () => {
      genRef.current = gen + 1;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [path]);

  const handleError = useCallback(() => {
    if (inflightRef.current || blobUrlRef.current) return;
    inflightRef.current = true;
    const gen = genRef.current;
    invoke<ArrayBuffer>("read_media_file", { filePath: path })
      .then((bytes) => {
        if (gen !== genRef.current) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeFromPath(path) }));
        blobUrlRef.current = url;
        setSrc(url);
      })
      .catch(() => {
        if (gen === genRef.current) setFailed(true);
      })
      .finally(() => {
        inflightRef.current = false;
      });
  }, [path]);

  return { src, failed, handleError };
}
