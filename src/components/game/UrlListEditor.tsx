import { type ReactNode } from "react";
import { UrlAddRow } from "./UrlAddRow";
import "./EditGameModal.css";

function getUrlDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function UrlListEditor({
  title,
  items,
  onChange,
  placeholder,
  emptyText,
  thumbnail,
  primaryActions,
}: {
  title: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  emptyText: string;
  thumbnail?: (url: string) => string | undefined;
  primaryActions?: (url: string) => ReactNode;
}) {
  return (
    <div className="url-list-editor">
      <div className="url-list-header">
        <h4 className="edit-modal-section-title">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          {title} ({items.length})
        </h4>
      </div>
      {items.length === 0 ? (
        <div className="url-list-empty">
          <span className="url-list-empty-icon" aria-hidden="true">∅</span>
          <p className="array-editor-empty">{emptyText}</p>
        </div>
      ) : (
        <div className="url-list">
          {items.map((url, idx) => {
            const thumb = thumbnail?.(url);
            const domain = getUrlDomain(url);
            return (
              <div key={idx} className="url-list-row">
                {thumb ? (
                  <img className="url-list-thumb" src={thumb} alt="" />
                ) : (
                  <div className="url-list-domain-badge">{domain}</div>
                )}
                <span className="url-list-url" title={url}>{url}</span>
                <div className="url-list-actions">
                  {primaryActions?.(url)}
                  <a
                    href={url.startsWith("http") ? url : `https://${url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="url-list-ext-btn"
                    title="Open link in browser"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                  <button
                    type="button"
                    className="lb-apply-btn url-list-remove"
                    onClick={() => onChange(items.filter((_, i) => i !== idx))}
                    title="Remove link"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <UrlAddRow placeholder={placeholder} onAdd={(v) => onChange([...items, v])} />
    </div>
  );
}
