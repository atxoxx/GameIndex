// BigScreenSelectionPreview — the "focused game" panel, one
// composition per layout preset.
//
// The pages own the data: they resolve the card the controller is on
// with `useFocusedGame` and hand this component a set of slots
// (identity, meta pills, facts, actions, artwork, an optional games
// row). What changes per preset is only how those slots read on
// screen, so Home, Store and Library share one visual language per
// console instead of three drifting copies of a hero.
//
// Two colour families meet here and never swap jobs: `--bs-brand*` is
// the console's furniture (eyebrow, veils, the poster glow) and
// `--bs-accent*` stays the user's focus ring, which the shell draws
// from `useFocusable`. Nothing in this file invents a colour.
//
// Sizing rule: every composition reserves its height (a per-preset
// min-height) and clamps its copy. The panel sits above rails that
// must not move when the controller browses, so a long description or
// a logo/title swap may never reflow the page.
//
// The `row` slot is the PlayStation home's square games carousel: it
// lives inside the hero so the art reads as one screen, not as a hero
// plus a strip below it.

import { useEffect, useState, type ReactNode } from "react";
import type { BigScreenPresetId } from "../../../bigscreen/presets";
import BigScreenSpotlight from "../BigScreenSpotlight";
import "../../../styles/bigscreen/pages/selection.css";

export interface SelectionInfo {
  id: string;
  title: string;
  logoUrl?: string | null;
  description?: string | null;
  coverUrl?: string | null;
}

export interface BigScreenSelectionPreviewProps {
  preset: BigScreenPresetId;
  variant: "hero" | "band" | "inline";
  info: SelectionInfo | null;
  eyebrow?: string;
  meta?: ReactNode;
  facts?: Array<{ label: string; value: string }>;
  actions?: ReactNode;
  backdrop?: {
    staticUrl?: string | null;
    animatedUrl?: string | null;
    artKey?: string | number | null;
  };
  /** Only used by the PlayStation home: the square games row lives inside the hero. */
  row?: ReactNode;
  empty?: { title: string; description?: string; actions?: ReactNode };
  className?: string;
}

export default function BigScreenSelectionPreview({
  preset,
  variant,
  info,
  eyebrow,
  meta,
  facts,
  actions,
  backdrop,
  row,
  empty,
  className,
}: BigScreenSelectionPreviewProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  // A new game means a new logo. Clearing the failure on URL change
  // keeps one broken logo from hiding every title for the session.
  useEffect(() => {
    setLogoFailed(false);
  }, [info?.logoUrl]);

  const centered = preset === "playstation" || preset === "switch";
  const rootClass = ["bs-sel", `bs-sel--${preset}`, `bs-sel--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  // No game to show: the same box renders the welcome copy so the page
  // keeps its height and its entry point instead of collapsing.
  if (!info) {
    return (
      <section
        className={`${rootClass} bs-sel--empty`}
        data-empty="true"
        aria-label={empty?.title}
      >
        <div className={`bs-sel-body${centered ? " bs-sel-body--center" : ""}`}>
          <div className={`bs-sel-copy${centered ? " bs-sel-copy--center" : ""}`}>
            {eyebrow ? <span className="bs-sel-eyebrow">{eyebrow}</span> : null}
            {empty?.title ? <h1 className="bs-sel-title">{empty.title}</h1> : null}
            {empty?.description ? (
              <p className="bs-sel-description">{empty.description}</p>
            ) : null}
            {empty?.actions ? <div className="bs-sel-actions">{empty.actions}</div> : null}
          </div>
        </div>
      </section>
    );
  }

  const showLogo = !!info.logoUrl && !logoFailed;
  const staticUrl = backdrop?.staticUrl ?? null;
  const animatedUrl = backdrop?.animatedUrl ?? null;
  const artKey =
    backdrop?.artKey != null ? String(backdrop.artKey) : (staticUrl ?? "");

  const eyebrowLine = eyebrow ? (
    <span className="bs-sel-eyebrow">{eyebrow}</span>
  ) : null;

  const identity = (
    <div className="bs-sel-identity">
      {showLogo ? (
        <img
          className="bs-sel-logo"
          src={info.logoUrl!}
          alt={info.title}
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <h1 className="bs-sel-title">{info.title}</h1>
      )}
    </div>
  );

  const metaRow = meta ? <div className="bs-sel-meta">{meta}</div> : null;
  const descriptionRow = info.description ? (
    <p className="bs-sel-description">{info.description}</p>
  ) : null;
  const actionsRow = actions ? <div className="bs-sel-actions">{actions}</div> : null;

  // Two flavours of the same facts: the card next to an Xbox band and
  // the inline strip under a PlayStation hero.
  const factsCard =
    facts && facts.length > 0 ? (
      <aside className="bigscreen-facts bs-sel-facts-card">
        {facts.map((fact) => (
          <div className="bigscreen-fact" key={fact.label}>
            <span className="bigscreen-fact__label">{fact.label}</span>
            <span className="bigscreen-fact__value" title={fact.value}>
              {fact.value}
            </span>
          </div>
        ))}
      </aside>
    ) : null;

  const factsRow =
    facts && facts.length > 0 ? (
      <dl className="bs-sel-facts">
        {facts.map((fact) => (
          <div className="bs-sel-fact" key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    ) : null;

  const factsChips =
    facts && facts.length > 0 ? (
      <div className="bs-sel-chips">
        {facts.map((fact) => (
          <span className="bs-sel-chip" key={fact.label}>
            {fact.label}
            <b>{fact.value}</b>
          </span>
        ))}
      </div>
    ) : null;

  // The Switch / Classic one-liner: title, meta and actions on a single
  // 44px row so the grid below never moves.
  const line = (
    <div className="bs-sel-line">
      <span className="bs-sel-line-title" title={info.title}>
        {info.title}
      </span>
      {meta ? <span className="bs-sel-line-meta">{meta}</span> : null}
      {actions ? <span className="bs-sel-line-actions">{actions}</span> : null}
    </div>
  );

  const artLayer = (withAnimated: boolean) => (
    <>
      {/* Re-keyed per game so the panel's art settles in over the page
          instead of hard-cutting while the controller browses. */}
      <div
        key={`art-${artKey}`}
        className="bs-sel-art"
        style={staticUrl ? { backgroundImage: `url("${staticUrl}")` } : undefined}
        aria-hidden="true"
      />
      {withAnimated && animatedUrl ? (
        <img
          key={artKey}
          className="bs-sel-art-animated"
          src={animatedUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
        />
      ) : null}
      <div className="bs-sel-veil" aria-hidden="true" />
    </>
  );

  if (preset === "playstation") {
    return (
      <section className={rootClass} aria-label={eyebrow ?? info.title}>
        {artLayer(variant === "hero")}
        <div className={`bs-sel-body${variant === "hero" ? " bs-sel-body--center" : ""}`}>
          {variant === "hero" ? (
            <>
              {row ? <div className="bs-sel-row">{row}</div> : null}
              <div className="bs-sel-copy bs-sel-copy--center">
                {eyebrowLine}
                {identity}
                {metaRow}
                {descriptionRow}
                {actionsRow}
                {factsRow}
              </div>
            </>
          ) : (
            <div className="bs-sel-copy">
              {eyebrowLine}
              {identity}
              {metaRow}
              {descriptionRow}
              {actionsRow}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (preset === "xbox") {
    return (
      <section className={rootClass} aria-label={eyebrow ?? info.title}>
        {artLayer(false)}
        <div className="bs-sel-body bs-sel-body--split">
          <div className="bs-sel-copy">
            {eyebrowLine}
            {identity}
            {metaRow}
            {descriptionRow}
            {actionsRow}
          </div>
          {factsCard}
        </div>
      </section>
    );
  }

  if (preset === "steam") {
    return (
      <section className={rootClass} aria-label={eyebrow ?? info.title}>
        <div className="bs-sel-body bs-sel-body--spotlight">
          <div className="bs-sel-poster">
            {info.coverUrl ? (
              <img
                src={info.coverUrl}
                alt={info.title}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="bs-sel-poster-fallback" aria-hidden="true" />
            )}
          </div>
          <div className="bs-sel-copy">
            {eyebrowLine}
            {identity}
            {metaRow}
            {descriptionRow}
            {factsChips}
            {actionsRow}
          </div>
        </div>
      </section>
    );
  }

  if (preset === "switch") {
    if (variant === "hero") {
      return (
        <section className={rootClass} aria-label={eyebrow ?? info.title}>
          <div className="bs-sel-body bs-sel-body--center">
            {row ? <div className="bs-sel-row">{row}</div> : null}
            <div className="bs-sel-copy bs-sel-copy--center">
              {eyebrowLine}
              {identity}
              {metaRow}
              {actionsRow}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className={rootClass} aria-label={eyebrow ?? info.title}>
        {line}
      </section>
    );
  }

  // GameIndex keeps the app's shipped spotlight, two columns and all, so
  // the layout that is "the app's own look" cannot drift from it.
  if (variant === "hero") {
    return (
      <div className={`${rootClass} bs-sel--delegate`}>
        <BigScreenSpotlight
          eyebrow={eyebrow}
          title={info.title}
          logoUrl={info.logoUrl}
          meta={meta}
          description={info.description}
          actions={actions}
          facts={facts}
          ariaLabel={eyebrow ?? info.title}
        />
      </div>
    );
  }

  return (
    <section className={rootClass} aria-label={eyebrow ?? info.title}>
      {line}
    </section>
  );
}
