// Full-screen viewer for description images/videos and the gallery.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { MediaItem } from "./description";
import "./mods-discover.css";

interface ModMediaLightboxProps {
  items: MediaItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export default function ModMediaLightbox({
  items,
  index,
  onIndexChange,
  onClose,
}: ModMediaLightboxProps) {
  const { t } = useLanguage();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Move focus into the viewer while it is open and hand it back to the
  // gallery item afterwards, so keyboard users are never stranded.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => restoreRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndexChange((index + 1) % items.length);
      else if (e.key === "ArrowLeft")
        onIndexChange((index - 1 + items.length) % items.length);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [index, items.length, onClose, onIndexChange]);

  const item = items[index];
  if (!item) return null;
  const many = items.length > 1;

  return createPortal(
    <div
      className="mods-media-lightbox"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={item.type === "video" ? t("mods.discover.video") : t("mods.discover.image")}
    >
      <button
        ref={closeRef}
        type="button"
        className="mods-media-lightbox-close"
        onClick={onClose}
        aria-label={t("mods.source.close")}
      >
        <X size={20} />
      </button>

      {many && (
        <button
          type="button"
          className="mods-media-lightbox-nav mods-media-lightbox-nav--prev"
          onClick={() => onIndexChange((index - 1 + items.length) % items.length)}
          aria-label={t("mods.discover.previous")}
        >
          <ChevronLeft size={26} />
        </button>
      )}

      <div className="mods-media-lightbox-stage">
        {item.type === "image" ? (
          <img src={item.url} alt="" />
        ) : item.embedUrl ? (
          <iframe
            src={item.embedUrl}
            title={t("mods.discover.video")}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <video src={item.url} controls autoPlay />
        )}
      </div>

      {many && (
        <button
          type="button"
          className="mods-media-lightbox-nav mods-media-lightbox-nav--next"
          onClick={() => onIndexChange((index + 1) % items.length)}
          aria-label={t("mods.discover.next")}
        >
          <ChevronRight size={26} />
        </button>
      )}

      <div className="mods-media-lightbox-bar">
        {many && (
          <span className="mods-media-lightbox-count">
            {index + 1} / {items.length}
          </span>
        )}
        <button
          type="button"
          className="mods-media-lightbox-external"
          onClick={() => void openUrl(item.url)}
        >
          <ExternalLink size={14} /> {t("mods.discover.openPage")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
