import type { ElementType, HTMLAttributes, ReactNode } from "react";

export type PanelTone = "plain" | "raised" | "sunken" | "accent" | "warning";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Element rendered as the panel root. Defaults to a section. */
  as?: ElementType;
  /** Tonal step; separation comes from tint, never from a border. */
  tone?: PanelTone;
  /** Optional heading block rendered as a header row. */
  heading?: ReactNode;
  /** Small label above the heading. */
  eyebrow?: ReactNode;
  /** Leading glyph beside the heading. */
  icon?: ReactNode;
  /** Right-aligned header slot (actions, counts, filters). */
  actions?: ReactNode;
  /** Drops the body padding for edge-to-edge media. */
  bleed?: boolean;
}

/**
 * Panel — the container primitive that replaces bordered cards.
 *
 * There is no stroke and no drop shadow: a panel is a tonal wash over the
 * page plus room to breathe, so a page reads as one surface with depth
 * instead of a grid of boxes. Tones are derived from `--panel-*` tokens,
 * which are themselves mixed from the active theme's text color, so every
 * theme (dark, light, high-contrast) gets the right direction of contrast
 * without a single hardcoded color.
 */
export function Panel({
  as: Component = "section",
  tone = "plain",
  heading,
  eyebrow,
  icon,
  actions,
  bleed = false,
  className,
  children,
  ...props
}: PanelProps) {
  const hasHeader = Boolean(heading || eyebrow || actions);

  return (
    <Component
      className={[
        "ui-panel",
        `ui-panel--${tone}`,
        bleed ? "ui-panel--bleed" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {hasHeader && (
        <header className="ui-panel__header">
          <div className="ui-panel__heading">
            {eyebrow && <span className="ui-panel__eyebrow">{eyebrow}</span>}
            {heading && (
              <h2 className="ui-panel__title">
                {icon && (
                  <span className="ui-panel__icon" aria-hidden="true">
                    {icon}
                  </span>
                )}
                <span className="ui-panel__title-text">{heading}</span>
              </h2>
            )}
          </div>
          {actions && <div className="ui-panel__actions">{actions}</div>}
        </header>
      )}
      <div className="ui-panel__body">{children}</div>
    </Component>
  );
}
