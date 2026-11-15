import { useId, useState, type ReactNode } from "react";

/**
 * Small presentational building blocks for the selected-release dossier.
 *
 * These components only lay out data the modal already has — they never
 * derive, guess or label a value themselves. All copy arrives as translated
 * strings from `DetailPanel`, so the panel stays the single owner of i18n and
 * of the release facts.
 */

export type DetailFactTone =
  | "default"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface DetailFact {
  key: string;
  label: string;
  value: ReactNode;
  title?: string;
  tone?: DetailFactTone;
  /** Render the value in the monospace face (hashes, URLs, identifiers). */
  mono?: boolean;
}

/**
 * Compact label/value grid used by the summary and the raw-metadata block.
 * The hairline is the grid gap showing through, so cells never need borders.
 */
export function DetailFactGrid({
  facts,
  className = "",
}: {
  facts: DetailFact[];
  className?: string;
}) {
  if (facts.length === 0) return null;
  return (
    <dl className={`dl-dossier-facts ${className}`.trim()}>
      {facts.map((fact) => (
        <div className="dl-dossier-fact" key={fact.key}>
          <dt className="dl-dossier-fact-label">{fact.label}</dt>
          <dd
            className="dl-dossier-fact-value"
            data-tone={fact.tone ?? "default"}
            data-mono={fact.mono ? "true" : undefined}
            title={fact.title}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Titled section inside the inspector. The heading gets a stable id so the
 * `<section>` is announced with its own label in screen readers.
 */
export function DetailSection({
  title,
  meta,
  children,
  className = "",
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `dl-dossier-section-${useId()}`;
  return (
    <section
      className={`dl-dossier-section ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <div className="dl-dossier-section-head">
        <h3 id={headingId} className="dl-dossier-section-title">
          {title}
        </h3>
        {meta != null && <span className="dl-dossier-section-meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * Collapsible "technical details" region. A real button owns the expanded
 * state so keyboard users get `aria-expanded`/`aria-controls` semantics; the
 * body stays mounted (and `hidden`) so the control target always exists.
 */
export function DetailDisclosure({
  title,
  expandLabel,
  collapseLabel,
  hint,
  children,
  className = "",
}: {
  title: string;
  expandLabel: string;
  collapseLabel: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `dl-dossier-disclosure-${useId()}`;
  const actionLabel = open ? collapseLabel : expandLabel;

  return (
    <div className={`dl-dossier-disclosure ${className}`.trim()}>
      <button
        type="button"
        className="dl-dossier-disclosure-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${title} — ${actionLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          className={`dl-dossier-chevron${open ? " is-open" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="dl-dossier-disclosure-title">{title}</span>
        {hint != null && (
          <span className="dl-dossier-disclosure-hint">{hint}</span>
        )}
      </button>
      <div
        id={panelId}
        className="dl-dossier-disclosure-body"
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

export interface DetailChecksum {
  algo: string;
  value: string;
}

/**
 * Checksum rows keep the original click-to-copy behaviour: the whole row is
 * the button, the algorithm is the accessible name, and the copied state is
 * announced inline.
 */
export function DetailChecksumList({
  checksums,
  copiedKey,
  onCopy,
  copyLabel,
  copiedLabel,
}: {
  checksums: DetailChecksum[];
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void;
  copyLabel: string;
  copiedLabel: string;
}) {
  if (checksums.length === 0) return null;
  return (
    <div className="dl-dossier-checksums">
      {checksums.map((sum, index) => {
        const key = `checksum:${sum.algo}:${index}`;
        const copied = copiedKey === key;
        return (
          <button
            type="button"
            key={`${sum.algo}-${index}`}
            className={`dl-dossier-checksum${copied ? " is-copied" : ""}`}
            title={`${sum.algo}: ${sum.value}`}
            onClick={() => onCopy(sum.value, key)}
            aria-label={`${copyLabel}: ${sum.algo}`}
          >
            <span className="dl-dossier-checksum-algo">{sum.algo}</span>
            <span className="dl-dossier-checksum-value">{sum.value}</span>
            <span className="dl-dossier-checksum-state" aria-live="polite">
              {copied ? copiedLabel : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
