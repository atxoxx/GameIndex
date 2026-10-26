import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

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
};

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);

export function isVideoPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(ext);
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Overlay-local media URL resolver.
 *
 * The overlay chunk deliberately does not import the community gallery (it
 * would pull in page storage and the album code), so it carries its own small
 * version: asset protocol first, then a Blob URL from `read_media_file`.
 */
export function useOverlayMediaSrc(path: string) {
  const [src, setSrc] = useState<string>(() => convertFileSrc(path));
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const inflightRef = useRef(false);
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    inflightRef.current = false;
    setFailed(false);
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

  const onError = useCallback(() => {
    if (inflightRef.current || blobUrlRef.current) return;
    inflightRef.current = true;
    const gen = genRef.current;
    invoke<ArrayBuffer>("read_media_file", { filePath: path })
      .then((bytes) => {
        if (gen !== genRef.current) return;
        const url = URL.createObjectURL(
          new Blob([bytes], { type: mimeFromPath(path) })
        );
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

  return { src, onError, failed };
}
