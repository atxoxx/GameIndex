// BigScreenSpotlight — the featured-game panel that owns the top of the
// Home and Store dashboards in Big Screen Mode.
//
// Shared by both dashboards instead of each page rendering its own copy:
// the two panes had drifted apart while doing the same job, and the
// left-aligned version left half the screen empty. The layout here is
// two columns — identity + actions on the left, an at-a-glance fact card
// on the right — so the panel reads as a deliberate console hero and the
// dashboards below start under a stable, full-width band.
//
// Every slot is height-reserved (eyebrow, logo/title, meta row,
// description, actions) because the panel sits above the rails: a change
// in its height moves every rail with it, which reads as the whole
// dashboard jumping when the user navigates between games.

import { useEffect, useState, type ReactNode } from "react";

export interface SpotlightFact {
  label: string;
  value: string;
}

export interface BigScreenSpotlightProps {
  /** Small line above the title ("Featured game", "Continue playing"). */
  eyebrow?: string;
  /** Fallback title, used when there is no logo or the logo fails. */
  title: string;
  /** Transparent game logo; falls back to the title. */
  logoUrl?: string | null;
  /** Meta pills row. */
  meta?: ReactNode;
  /** Short summary; two lines are reserved. */
  description?: string | null;
  /** Action buttons (the page owns their focus props). */
  actions?: ReactNode;
  /** Label/value pairs for the fact card (Playtime, Score, …). */
  facts?: SpotlightFact[];
  ariaLabel?: string;
}

export default function BigScreenSpotlight({
  eyebrow,
  title,
  logoUrl,
  meta,
  description,
  actions,
  facts,
  ariaLabel,
}: BigScreenSpotlightProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  const showLogo = !!logoUrl && !logoFailed;

  return (
    <section className="bigscreen-spotlight animate-fade-in" aria-label={ariaLabel}>
      <div className="bigscreen-spotlight-info">
        {eyebrow ? (
          <span className="bigscreen-spotlight-eyebrow">{eyebrow}</span>
        ) : null}

        <div className="bigscreen-spotlight-logo-slot">
          {showLogo ? (
            <img
              src={logoUrl}
              alt={title}
              className="bigscreen-spotlight-logo"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <h1 className="bigscreen-spotlight-title">{title}</h1>
          )}
        </div>

        <div className="bigscreen-spotlight-meta">{meta}</div>

        <p className="bigscreen-spotlight-description">{description ?? ""}</p>

        <div className="bigscreen-spotlight-actions">{actions}</div>
      </div>

      {facts && facts.length > 0 ? (
        <aside className="bigscreen-facts">
          {facts.map((fact) => (
            <div className="bigscreen-fact" key={fact.label}>
              <span className="bigscreen-fact__label">
                {fact.label}
              </span>
              <span className="bigscreen-fact__value" title={fact.value}>
                {fact.value}
              </span>
            </div>
          ))}
        </aside>
      ) : null}
    </section>
  );
}
