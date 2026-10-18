import { useLanguage } from "../../context/LanguageContext";

interface EditImageSlotProps {
  label: string;
  subtitle: string;
  imageUrl: string;
  previewSize: { w: number; h: number };
  /** Render the preview on a checkerboard so transparent art (icons/logos)
   *  is visibly see-through instead of flattened onto a solid background. */
  transparent?: boolean;
  isFetching: boolean;
  onChooseFile: () => void;
  onFetchWeb: () => void;
  onRemove: () => void;
}

/** Pinned "current artwork" panel for one media slot in the Edit Game modal's
 *  Media tab. Shows the image that is set right now with its File / Fetch /
 *  Remove actions; the live candidate gallery sits underneath it. */
export function EditImageSlot({
  label,
  subtitle,
  imageUrl,
  previewSize,
  transparent,
  isFetching,
  onChooseFile,
  onFetchWeb,
  onRemove,
}: EditImageSlotProps) {
  const { t } = useLanguage();
  return (
    <div className={`edit-image-panel ${imageUrl ? "has-image" : "is-empty"}`}>
      <div
        className={`edit-image-panel-preview${transparent ? " transparent" : ""}`}
        style={{
          width: previewSize.w,
          height: previewSize.h,
          aspectRatio: `${previewSize.w} / ${previewSize.h}`,
        }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={label} loading="lazy" />
        ) : (
          <div className="edit-image-panel-placeholder">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
      </div>

      <div className="edit-image-panel-info">
        <div className="edit-image-panel-head">
          <span className="edit-image-panel-label">{label}</span>
          {imageUrl ? (
            <span className="edit-image-panel-status active">Set</span>
          ) : (
            <span className="edit-image-panel-status empty">Empty</span>
          )}
        </div>
        <span className="edit-image-panel-subtitle">{subtitle}</span>

        <div className="edit-image-panel-actions">
          <button
            className="game-edit-btn edit-img-btn"
            onClick={onChooseFile}
            type="button"
            title="Choose a file from your computer"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {t("editImage.file")}
          </button>
          <button
            className="game-edit-btn edit-img-btn edit-img-fetch"
            onClick={onFetchWeb}
            type="button"
            disabled={isFetching}
            title="Fetch image automatically from metadata"
          >
            {isFetching ? (
              <div className="edit-slot-spinner" />
            ) : (
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            )}
            {isFetching ? "..." : t("editImage.fetch")}
          </button>
          {imageUrl && (
            <button
              className="game-edit-btn edit-img-btn edit-img-remove"
              onClick={onRemove}
              type="button"
              title="Clear this image slot"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
