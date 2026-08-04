// BigScreenLightbox — portal-based fullscreen preview overlay.
//
// Used by `BigScreenGamePage` for screenshot / video preview. Renders
// nothing when `src` is `null`. Click-outside-the-frame dismisses
// the preview; click-on-the-frame swallows propagation so users
// can interact with the media without dismissing.
//
// Decoupled from the page-level `<ScreenshotsSection>` so future
// callers (e.g. a future Wishlist detail view) can reuse the same
// preview surface without re-implementing the modal pattern.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import { isVideoUrl } from "./bigscreenFormat";

export interface BigScreenLightboxProps {
  /** URL of the image / video to preview. `null` = closed. */
  src: string | null;
  /** Invoked when the user dismisses the preview. */
  onClose: () => void;
  /** Accessible label for the dialog. Defaults to "Preview". */
  ariaLabel?: string;
}

export default function BigScreenLightbox({
  src,
  onClose,
  ariaLabel,
}: BigScreenLightboxProps) {
  const { t } = useLanguage();

  // Controller B / Escape closes the preview. Capture-phase so it runs
  // before the page's back handler and the BigScreenContext shell
  // handler; the page back handler also defers to open dialogs, and
  // this dialog's role="dialog" makes the shell back off.
  useEffect(() => {
    if (!src) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    }
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [src, onClose]);

  if (typeof document === "undefined") return null;
  if (!src) return null;

  const dialogLabel = ariaLabel ?? t("bigscreen.lightbox.preview");

  return createPortal(
    <div
      className="bigscreen-lightbox-mask"
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      onClick={onClose}
    >
      {/* Inner frame swallows click-propagation so a click on the
       *  media itself doesn't dismiss the preview. */}
      <div
        className="bigscreen-lightbox-frame"
        onClick={(e) => e.stopPropagation()}
      >
        {isVideoUrl(src) ? (
          <video src={src} controls autoPlay />
        ) : (
          <img
            src={src}
            alt={t("bigscreen.lightbox.fullscreenPreview")}
            style={{
              maxWidth: "100%",
              maxHeight: "85vh",
              objectFit: "contain",
              display: "block",
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}