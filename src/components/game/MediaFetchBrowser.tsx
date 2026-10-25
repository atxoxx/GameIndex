import { createPortal } from "react-dom";
import { Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import { MediaCandidateGallery, type MediaSlot } from "./MediaCandidateGallery";
import "./edit/EditGameModal.css";

export type { MediaSlot };

const SLOT_LABEL_KEY: Record<MediaSlot, string> = {
  icon: "edit.label.icon",
  cover: "edit.label.cover",
  hero: "edit.label.hero",
  logo: "edit.label.logo",
};

interface MediaFetchBrowserProps {
  slot: MediaSlot;
  gameName: string;
  steamAppId?: number;
  onApply: (url: string) => Promise<void>;
  onClose: () => void;
}

/** Focused media-browse modal. Opened from the edit modal's pinned artwork
 *  panel to search every source by title; the results body is the shared
 *  `MediaCandidateGallery`, so the standalone modal and the inline gallery
 *  stay in lockstep. */
export function MediaFetchBrowser({
  slot,
  gameName,
  steamAppId,
  onApply,
  onClose,
}: MediaFetchBrowserProps) {
  const { t } = useLanguage();
  const slotLabel = t(SLOT_LABEL_KEY[slot]);
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal lb-browser-modal media-fetch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M3 3h2v2M21 3h-2v2M3 21h2v-2M21 21h-2v-2" /><path d="M12 1v2M12 21v2M1 12h2M21 12h2" /></svg>
          </div>
          <div className="modal-header-text">
            <h3 className="modal-title">{t("editImage.fetchSlot", { slot: slotLabel })}</h3>
            <p className="modal-subtitle">
              {t("editImage.fetchSlotDesc")}
            </p>
          </div>
          <Button variant="ghost" size="sm" iconOnly leftIcon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}  onClick={onClose} aria-label={t("common.close")}></Button>
        </div>

        <MediaCandidateGallery
          slot={slot}
          gameName={gameName}
          steamAppId={steamAppId}
          onApply={onApply}
          onApplied={onClose}
          variant="modal"
        />

        <div className="modal-footer">
          <span className="modal-footer-count">{t("editImage.pickImage")}</span>
          <div className="modal-footer-actions">
            <Button variant="secondary" onClick={onClose}>{t("common.done")}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
