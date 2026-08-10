import { Button } from "../ui";
import { UrlAddRow } from "./UrlAddRow";
import "./EditGameModal.css";

interface IgdbMediaBrowserProps {
  screenshots: string[];
  videos: string[];
  fetchingKey: string | null;
  onScreenshotsChange: (next: string[]) => void;
  onVideosChange: (next: string[]) => void;
  onApplyImage: (slot: "icon" | "cover" | "hero" | "banner" | "logo", url: string) => void;
  onClose: () => void;
}

/** IGDB screenshots/videos media browser used in the Edit Game modal's Media tab. */
export function IgdbMediaBrowser({
  screenshots,
  videos,
  fetchingKey,
  onScreenshotsChange,
  onVideosChange,
  onApplyImage,
  onClose,
}: IgdbMediaBrowserProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal lb-browser-modal" style={{ maxWidth: "820px", maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
          </div>
          <div className="modal-header-text">
            <h3 className="modal-title">IGDB Media Browser</h3>
            <p className="modal-subtitle">Browse screenshots, manage trailers, and download high-resolution game media</p>
          </div>
          <button className="metadata-panel-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="lb-browser-body" style={{ padding: "var(--space-xl)", overflowY: "auto" }}>
          <div style={{ marginBottom: "var(--space-xl)" }}>
            <h4 style={{ margin: "0 0 var(--space-sm) 0", color: "var(--color-text-primary)" }}>Screenshots ({screenshots.length})</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "var(--space-md)" }}>
              {screenshots.map((url, idx) => (
                <div key={idx} style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <img src={url} alt={`Screenshot ${idx + 1}`} style={{ width: "100%", height: "110px", objectFit: "cover" }} />
                  <div style={{ padding: "var(--space-xs)", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                    <button className="lb-apply-btn" style={{ padding: "4px 8px", fontSize: "10px" }} onClick={() => onApplyImage("cover", url)} disabled={fetchingKey !== null}>{fetchingKey === "cover" ? "Downloading..." : "Set as Cover Art"}</button>
                    <button className="lb-apply-btn" style={{ padding: "4px 8px", fontSize: "10px" }} onClick={() => onApplyImage("hero", url)} disabled={fetchingKey !== null}>{fetchingKey === "hero" ? "Downloading..." : "Set as Hero Banner"}</button>
                    <button className="lb-apply-btn" style={{ padding: "4px 8px", fontSize: "10px", background: "var(--color-danger-opacity)", color: "var(--color-danger)" }} onClick={() => onScreenshotsChange(screenshots.filter((_, i) => i !== idx))}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <UrlAddRow placeholder="Add custom screenshot URL..." onAdd={(v) => onScreenshotsChange([...screenshots, v])} />
          </div>
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-lg)" }}>
            <h4 style={{ margin: "0 0 var(--space-sm) 0", color: "var(--color-text-primary)" }}>Videos & Trailers ({videos.length})</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {videos.map((url, idx) => {
                const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1];
                return (
                  <div key={idx} style={{ display: "flex", gap: "var(--space-md)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-sm)", alignItems: "center" }}>
                    {videoId ? <img src={`https://img.youtube.com/vi/${videoId}/default.jpg`} alt="Video Thumbnail" style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "var(--radius-sm)" }} /> : <div style={{ width: "80px", height: "60px", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-sm)" }} />}
                    <div style={{ flex: 1, overflow: "hidden" }}><span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-primary)", wordBreak: "break-all", display: "block" }}>{url}</span></div>
                    <button className="lb-apply-btn" style={{ background: "var(--color-danger-opacity)", color: "var(--color-danger)", whiteSpace: "nowrap" }} onClick={() => onVideosChange(videos.filter((_, i) => i !== idx))}>Remove</button>
                  </div>
                );
              })}
            </div>
            <UrlAddRow placeholder="Add custom YouTube video URL..." onAdd={(v) => onVideosChange([...videos, v])} />
          </div>
        </div>
        <div className="modal-footer">
          <span className="modal-footer-count"></span>
          <div className="modal-footer-actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
        </div>
      </div>
    </div>
  );
}
