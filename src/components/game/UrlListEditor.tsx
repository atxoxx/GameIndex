import { type ReactNode } from "react";
import { UrlAddRow } from "./UrlAddRow";
import "./EditGameModal.css";

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
      <h4 className="edit-modal-section-title">{title} ({items.length})</h4>
      {items.length === 0 ? (
        <p className="array-editor-empty">{emptyText}</p>
      ) : (
        <div className="url-list">
          {items.map((url, idx) => {
            const thumb = thumbnail?.(url);
            return (
              <div key={idx} className="url-list-row">
                {thumb ? <img className="url-list-thumb" src={thumb} alt="" /> : <div className="url-list-thumb url-list-thumb--empty" />}
                <span className="url-list-url">{url}</span>
                {primaryActions?.(url)}
                <button className="lb-apply-btn url-list-remove" onClick={() => onChange(items.filter((_, i) => i !== idx))}>Remove</button>
              </div>
            );
          })}
        </div>
      )}
      <UrlAddRow placeholder={placeholder} onAdd={(v) => onChange([...items, v])} />
    </div>
  );
}
