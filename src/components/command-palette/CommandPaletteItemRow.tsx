import { useMemo, type ReactNode } from "react";
import type { PaletteItem } from "./commandPaletteTypes";
import { getMatchRanges } from "./commandPaletteUtils";

interface CommandPaletteItemRowProps {
  item: PaletteItem;
  isSelected: boolean;
  cleanQuery: string;
  optionId?: string;
  onSelect: () => void;
  onMouseEnter: () => void;
}

/** Highlights matched query tokens without re-splitting the whole string. */
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

  ranges.forEach((range, index) => {
    if (range.start > lastIndex) {
      parts.push(text.slice(lastIndex, range.start));
    }
    parts.push(
      <mark key={index} className="cp-match">
        {text.slice(range.start, range.end)}
      </mark>
    );
    lastIndex = range.end;
  });

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts}</span>;
}

const MAX_QUICK_ACTIONS = 5;

export default function CommandPaletteItemRow({
  item,
  isSelected,
  cleanQuery,
  optionId,
  onSelect,
  onMouseEnter,
}: CommandPaletteItemRowProps) {
  const quickActions = (item.quickActions ?? []).slice(0, MAX_QUICK_ACTIONS);

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={isSelected}
      className={`cp-row${isSelected ? " is-selected" : ""}${item.pinned ? " is-pinned" : ""}`}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
    >
      <span className="cp-row-media" aria-hidden="true">
        {item.thumb ? (
          <img src={item.thumb} alt="" className="cp-row-thumb" loading="lazy" />
        ) : item.swatchColors ? (
          <span
            className="cp-row-swatch"
            style={{
              backgroundColor: item.swatchColors.bg,
              borderColor: item.swatchColors.accent,
            }}
          >
            <span
              className="cp-row-swatch-dot"
              style={{ backgroundColor: item.swatchColors.accent }}
            />
          </span>
        ) : item.icon ? (
          <span className="cp-row-icon">{item.icon}</span>
        ) : null}
      </span>

      <span className="cp-row-text">
        <HighlightedText text={item.title} query={cleanQuery} className="cp-row-title" />
        {item.badge && (
          <span
            className={`cp-badge${item.badgeType ? ` is-${item.badgeType}` : ""}`}
          >
            {item.badgeType === "success" && <span className="cp-pulse" aria-hidden="true" />}
            {item.badge}
          </span>
        )}
        {item.subtitle && (
          <HighlightedText
            text={item.subtitle}
            query={cleanQuery}
            className="cp-row-sub"
          />
        )}
      </span>

      <span className="cp-row-tail">
        {isSelected && quickActions.length > 0 && (
          <span className="cp-row-actions">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="cp-row-action"
                title={action.title}
                aria-label={action.title}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick(event);
                }}
              >
                {action.icon}
              </button>
            ))}
          </span>
        )}

        {isSelected && item.actionText && (
          <span className="cp-row-enter">
            <kbd className="cp-kbd">{item.shortcut || "↵"}</kbd>
            <span>{item.actionText}</span>
          </span>
        )}
      </span>
    </div>
  );
}
