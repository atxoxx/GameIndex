import type { HTMLAttributes, ReactNode } from "react";

export type StatTone =
  | "default"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface StatBandItem {
  /** Stable key for the metric. */
  id: string;
  /** Small uppercase label. */
  label: ReactNode;
  /** The headline figure. */
  value: ReactNode;
  /** Quiet line under the figure. */
  detail?: ReactNode;
  /** Optional leading glyph, tinted by `tone`. */
  icon?: ReactNode;
  /** Tints the figure and glyph. */
  tone?: StatTone;
  /** 0–100; draws a hairline progress track under the figure. */
  progress?: number;
  /** Makes the metric a button. */
  onClick?: () => void;
  /** Native tooltip, useful when the figure needs explaining. */
  hint?: string;
}

export interface StatBandProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  items: StatBandItem[];
  /** Accessible name for the group. */
  ariaLabel: string;
}

/**
 * StatBand — the shared "quick overview" row.
 *
 * Metrics are not tiles: no background, no border, no dividers. Figures
 * float on the page and are grouped by rhythm alone, which lets a header
 * summary read as part of the page instead of a row of widgets.
 *
 * Empty bands render nothing so a page never reserves space for data a
 * game does not have.
 */
export function StatBand({ items, ariaLabel, className, ...props }: StatBandProps) {
  if (items.length === 0) return null;

  return (
    <div
      className={["ui-statband", className ?? ""].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
      {...props}
    >
      {items.map((item) => {
        const content = (
          <>
            <span className="ui-statband__label">
              {item.icon && (
                <span className="ui-statband__icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.label}
            </span>
            <span className="ui-statband__value">{item.value}</span>
            {item.detail && <span className="ui-statband__detail">{item.detail}</span>}
            {item.progress !== undefined && (
              <span className="ui-statband__track" aria-hidden="true">
                <span
                  className="ui-statband__fill"
                  style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                />
              </span>
            )}
          </>
        );

        const toneClass = item.tone ? ` ui-statband__item--${item.tone}` : "";

        return item.onClick ? (
          <button
            key={item.id}
            type="button"
            className={`ui-statband__item ui-statband__item--action${toneClass}`}
            onClick={item.onClick}
            title={item.hint}
          >
            {content}
          </button>
        ) : (
          <div
            key={item.id}
            className={`ui-statband__item${toneClass}`}
            title={item.hint}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
