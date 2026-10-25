import type { ReactNode } from "react";
import { StatBand, type StatBandItem } from "../../ui";

export interface GameTabShellProps {
  /** Small label above the title (the section, e.g. "Add-ons"). */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One quiet line under the title: counts, context, freshness. */
  description?: ReactNode;
  icon?: ReactNode;
  /** Primary actions, right-aligned in the header. */
  actions?: ReactNode;
  /** Live figures rendered as the shared StatBand. */
  stats?: StatBandItem[];
  statsLabel?: string;
  /** Command row: search, filter chips, sort, view switch. */
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The shared opening for every game-detail subtab.
 *
 * It gives the seven tabs one rhythm — identity, live figures, one command
 * row, then content — without wrapping anything in a card. Tabs that are
 * full-height workspaces (Notes, Map, WebLinks) simply omit `stats`; media
 * tabs stay compact by passing a short description instead.
 */
export default function GameTabShell({
  eyebrow,
  title,
  description,
  icon,
  actions,
  stats,
  statsLabel,
  toolbar,
  children,
  className,
}: GameTabShellProps) {
  return (
    <section className={["game-tab", className ?? ""].filter(Boolean).join(" ")}>
      <header className="game-tab__head">
        <div className="game-tab__identity">
          {icon && (
            <span className="game-tab__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="game-tab__heading">
            {eyebrow && <span className="game-tab__eyebrow">{eyebrow}</span>}
            <h2 className="game-tab__title">{title}</h2>
            {description && <p className="game-tab__desc">{description}</p>}
          </div>
        </div>
        {actions && <div className="game-tab__actions">{actions}</div>}
      </header>

      {stats && stats.length > 0 && (
        <StatBand
          items={stats}
          ariaLabel={statsLabel ?? "Tab figures"}
          className="game-tab__stats"
        />
      )}

      {toolbar && <div className="game-tab__toolbar">{toolbar}</div>}

      <div className="game-tab__body">{children}</div>
    </section>
  );
}
