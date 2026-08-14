import { useState, useEffect, useCallback, useRef, type MouseEvent } from "react";
import { useLanguage } from "../../context/LanguageContext";

export interface ImageLightboxProps {
  images: string[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
  title?: string;
}

export default function ImageLightbox({
  images,
  currentIndex,
  isOpen,
  onClose,
  onSelectIndex,
  title,
}: ImageLightboxProps) {
  const { t } = useLanguage();
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0, startPanX: 0, startPanY: 0 });
  const thumbStripRef = useRef<HTMLDivElement | null>(null);

  const total = images.length;
  const safeIndex = Math.max(0, Math.min(currentIndex, total - 1));
  const currentSrc = images[safeIndex] || "";

  // Reset zoom on image change
  useEffect(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, [safeIndex]);

  // Scroll active thumbnail into view
  useEffect(() => {
    if (!isOpen || !thumbStripRef.current) return;
    const strip = thumbStripRef.current;
    const activeThumb = strip.children[safeIndex] as HTMLElement | undefined;
    if (activeThumb) {
      activeThumb.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [safeIndex, isOpen]);

  const handlePrev = useCallback(() => {
    if (total === 0) return;
    onSelectIndex((safeIndex - 1 + total) % total);
  }, [safeIndex, total, onSelectIndex]);

  const handleNext = useCallback(() => {
    if (total === 0) return;
    onSelectIndex((safeIndex + 1) % total);
  }, [safeIndex, total, onSelectIndex]);

  const handleToggleZoom = useCallback(() => {
    setZoom((prev) => {
      if (prev > 1) {
        setPanOffset({ x: 0, y: 0 });
        return 1;
      }
      return 2;
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "Home") {
        e.preventDefault();
        onSelectIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        onSelectIndex(total - 1);
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(z + 0.5, 3));
      } else if (e.key === "-") {
        setZoom((z) => {
          const next = Math.max(z - 0.5, 1);
          if (next === 1) setPanOffset({ x: 0, y: 0 });
          return next;
        });
      } else if (e.key === "0") {
        handleResetZoom();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext, onSelectIndex, total, handleResetZoom]);

  // Pan handlers when zoomed
  const handleMouseDown = (e: MouseEvent) => {
    if (zoom <= 1) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: panOffset.x,
      startPanY: panOffset.y,
    };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isPanning || zoom <= 1) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPanOffset({
      x: panStartRef.current.startPanX + dx,
      y: panStartRef.current.startPanY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  if (!isOpen || total === 0) return null;

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title || t("gamePage.fullscreenScreenshot")}
      onClick={onClose}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div className="image-lightbox__backdrop" />

      {/* Top bar controls */}
      <div
        className="image-lightbox__topbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="image-lightbox__info">
          {title && <span className="image-lightbox__title">{title}</span>}
          <span className="image-lightbox__counter">
            {safeIndex + 1} / {total}
          </span>
        </div>

        <div className="image-lightbox__tools">
          <button
            type="button"
            className="image-lightbox__tool-btn"
            onClick={handleToggleZoom}
            title={zoom > 1 ? t("common.resetZoom") : t("common.zoomIn")}
            aria-label={zoom > 1 ? t("common.resetZoom") : t("common.zoomIn")}
          >
            {zoom > 1 ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            )}
          </button>

          <button
            type="button"
            className="image-lightbox__tool-btn"
            onClick={() => window.open(currentSrc, "_blank")}
            title={t("common.openInBrowser")}
            aria-label={t("common.openInBrowser")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>

          <button
            type="button"
            className="image-lightbox__close-btn"
            onClick={onClose}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main image viewer stage */}
      <div
        className="image-lightbox__stage"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        style={{
          cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "zoom-in",
        }}
      >
        <div
          className="image-lightbox__image-wrap"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transition: isPanning ? "none" : "transform var(--transition-normal) ease-out",
          }}
          onClick={handleToggleZoom}
        >
          <img
            src={currentSrc}
            alt={title || t("gamePage.fullscreenScreenshot")}
            className="image-lightbox__image"
            draggable={false}
          />
        </div>
      </div>

      {/* Navigation arrows */}
      {total > 1 && (
        <>
          <button
            type="button"
            className="image-lightbox__nav-btn image-lightbox__nav-btn--prev"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            aria-label={t("gamePage.prevScreenshot")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <button
            type="button"
            className="image-lightbox__nav-btn image-lightbox__nav-btn--next"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            aria-label={t("gamePage.nextScreenshot")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* Bottom thumbnail strip */}
      {total > 1 && (
        <div
          className="image-lightbox__bottom"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="image-lightbox__thumb-strip" ref={thumbStripRef}>
            {images.map((src, idx) => (
              <button
                key={idx}
                type="button"
                className={`image-lightbox__thumb ${idx === safeIndex ? "active" : ""}`}
                onClick={() => onSelectIndex(idx)}
                aria-label={t("screenshots.openAria", { n: idx + 1 })}
                aria-pressed={idx === safeIndex}
              >
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
