import { useMemo, type ReactNode } from "react";
import type { PaletteItem } from "./commandPaletteTypes";
import { getMatchRanges } from "./commandPaletteUtils";

interface CommandPaletteItemRowProps {
  item: PaletteItem;
  isSelected: boolean;
  cleanQuery: string;
  onSelect: () => void;
  onMouseEnter: () => void;
}

/**
 * Highlights matched query tokens in text
 */
function HighlightedText({
  text,
  query,
  className = "",
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const ranges = useMemo(() => getMatchRanges(text, query), [text, query]);

  if (ranges.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  ranges.forEach((r, i) => {
    if (r.start > lastIndex) {
      parts.push(text.slice(lastIndex, r.start));
    }
    parts.push(
      <mark key={i} className="cmd-match-highlight">
        {text.slice(r.start, r.end)}
      </mark>
    );
    lastIndex = r.end;
  });

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts}</span>;
}

export default function CommandPaletteItemRow({
  item,
  isSelected,
  cleanQuery,
  onSelect,
  onMouseEnter,
}: CommandPaletteItemRowProps) {
  return (
    <div
      role="option"
      aria-selected={isSelected}
      className={`command-palette-item cmd-item${isSelected ? " is-selected" : ""}`}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
    >
      {/* Visual media / icon / theme swatch */}
      <div className="cmd-item-visual-slot">
        {item.thumb ? (
          <img
            src={item.thumb}
            alt=""
            className="command-palette-item-thumb"
            loading="lazy"
          />
        ) : item.swatchColors ? (
          <div
            className="cmd-theme-swatch-badge"
            style={{
              backgroundColor: item.swatchColors.bg,
              borderColor: item.swatchColors.accent,
            }}
          >
            <span
              className="cmd-theme-swatch-dot"
              style={{ backgroundColor: item.swatchColors.accent }}
            />
          </div>
        ) : item.icon ? (
          <div className="command-palette-item-icon">{item.icon}</div>
        ) : null}
      </div>

      {/* Main information: title, badges, subtitle */}
      <div className="command-palette-item-body">
        <div className="cmd-item-title-row">
          <HighlightedText
            text={item.title}
            query={cleanQuery}
            className="command-palette-item-title"
          />
          {item.badge && (
            <span
              className={`command-palette-badge${
                item.badgeType ? ` badge--${item.badgeType}` : ""
              }`}
            >
              {item.badgeType === "success" && <span className="cmd-pulse-dot" />}
              {item.badge}
            </span>
          )}
        </div>

        {item.subtitle && (
          <HighlightedText
            text={item.subtitle}
            query={cleanQuery}
            className="command-palette-item-subtitle"
          />
        )}
      </div>

      {/* Action buttons & execution hint */}
      <div className="command-palette-item-actions">
        {/* Quick action buttons (revealed on hover or when selected) */}
        {item.quickActions && item.quickActions.length > 0 && (
          <div className="command-palette-quick-btns">
            {item.quickActions.map((qa) => (
              <button
                key={qa.id}
                type="button"
                className="command-palette-quick-btn"
                title={qa.title}
                aria-label={qa.title}
                onClick={(e) => {
                  e.stopPropagation();
                  qa.onClick(e);
                }}
              >
                {qa.icon}
              </button>
            ))}
          </div>
        )}

        {/* Primary Action Button / Hint: Highlighted on selected item */}
        {item.actionText && (
          <div className={`command-palette-item-action${isSelected ? " active-hint" : ""}`}>
            <span className="cmd-action-label">{item.actionText}</span>
            {isSelected && (
              <kbd className="command-palette-key-pill">{item.shortcut || "↵"}</kbd>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
