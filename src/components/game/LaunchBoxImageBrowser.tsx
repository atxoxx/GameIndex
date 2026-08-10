import { type LaunchBoxImageResult } from "../../types/game";
import "./EditGameModal.css";

interface LaunchBoxImageBrowserProps {
  gameName: string;
  images: LaunchBoxImageResult[];
  loading: boolean;
  selectedCategory: string;
  applyingUrl: string | null;
  onSelectCategory: (cat: string) => void;
  onApply: (slot: "icon" | "cover" | "hero" | "logo", url: string) => void;
  onClose: () => void;
}

function getLbCategories(images: LaunchBoxImageResult[]): string[] {
  return Array.from(new Set(images.map((i) => i.category)));
}

function getFilteredLbImages(images: LaunchBoxImageResult[], selectedCategory: string): LaunchBoxImageResult[] {
  if (selectedCategory === "all") return images;
  return images.filter((i) => i.category === selectedCategory);
}

/** LaunchBox Games Database image browser used in the Edit Game modal's Media tab. */
export function LaunchBoxImageBrowser({
  gameName,
  images,
  loading,
  selectedCategory,
  applyingUrl,
  onSelectCategory,
  onApply,
  onClose,
}: LaunchBoxImageBrowserProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal lb-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20" /><path d="M2 12h5" /><path d="M2 7h5" /><path d="M2 17h5" /></svg>
          </div>
          <div className="modal-header-text">
            <h3 className="modal-title">LaunchBox Image Browser</h3>
            <p className="modal-subtitle">Browse and apply images from LaunchBox Games Database for {gameName}</p>
          </div>
          <button className="metadata-panel-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="lb-category-tabs">
          <button className={`lb-cat-tab ${selectedCategory === "all" ? "active" : ""}`} onClick={() => onSelectCategory("all")}>All ({images.length})</button>
          {getLbCategories(images).map((cat) => (
            <button key={cat} className={`lb-cat-tab ${selectedCategory === cat ? "active" : ""}`} onClick={() => onSelectCategory(cat)}>{cat} ({images.filter((i) => i.category === cat).length})</button>
          ))}
        </div>
        <div className="lb-browser-body">
          {loading ? (
            <div className="metadata-loading"><div className="metadata-spinner" /><p>Searching LaunchBox for "{gameName}"...</p></div>
          ) : images.length === 0 ? (
            <div className="metadata-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
              <p>No images found. Try editing the game name and searching again.</p>
            </div>
          ) : (
            <div className="lb-image-grid">
              {getFilteredLbImages(images, selectedCategory).map((img, idx) => (
                <div key={idx} className="lb-image-card">
                  <div className="lb-image-thumb"><img src={img.url} alt={`${img.category} ${img.region || ""}`} loading="lazy" /></div>
                  <div className="lb-image-info">
                    <span className="lb-image-category">{img.category}</span>
                    <span className="lb-image-meta">
                      {img.region && <span className="lb-image-region">{img.region}</span>}
                      {img.resolution && <span className="lb-image-res">{img.resolution}</span>}
                    </span>
                  </div>
                  <div className="lb-image-actions">
                    {(["icon", "cover", "hero", "logo"] as const).map((slot) => (
                      <button key={slot} className="lb-apply-btn" onClick={() => onApply(slot, img.url)} disabled={applyingUrl === img.url}>{applyingUrl === img.url ? "..." : slot[0].toUpperCase() + slot.slice(1)}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
