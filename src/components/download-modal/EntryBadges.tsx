/**
 * Small, presentational badges for one download result row.
 *
 * Everything here is deliberately data-in / markup-out: labels and tooltips
 * are resolved by `ResultRow` through the language context, so these helpers
 * never carry English copy of their own. All colour comes from theme tokens
 * (see `styles/download-modal-entries.css`), which keeps the row correct in
 * light, dark and every UI style.
 */

export type EntryTypeKind = "magnet" | "torrent" | "direct" | "web";

export type EntryFlagTone =
  | "plain"
  | "update"
  | "done"
  | "cache-cached"
  | "cache-uncached"
  | "cache-checking";

export type EntryFlagIcon = "up" | "check" | "bolt" | "sparkle";

/**
 * Source identity: the source name in a tinted capsule, plus a plugin mark
 * when the hit came from a plugin rather than a built-in source.
 */
export function EntrySourceBadge({
  name,
  isPlugin,
  pluginTitle,
}: {
  name: string;
  isPlugin: boolean;
  /** Localized explanation for the plugin mark. */
  pluginTitle: string;
}) {
  return (
    <span
      className={`dl-fact dl-fact--source dlm-entry-source${
        isPlugin ? " dl-fact--plugin dlm-entry-source--plugin" : ""
      }`}
      title={name}
    >
      {isPlugin ? (
        <span className="dlm-entry-plugin-mark" title={pluginTitle} aria-hidden>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        </span>
      ) : (
        <span className="dlm-entry-source-dot" aria-hidden />
      )}
      <span className="dlm-entry-source-name">{name}</span>
    </span>
  );
}

/**
 * Download kind: magnet, .torrent, direct file or a web/detail page that has
 * to be opened in the browser. The web variant is deliberately styled apart
 * from a direct link so the two cannot be confused at a glance.
 */
export function EntryTypeBadge({
  kind,
  label,
  title,
}: {
  kind: EntryTypeKind;
  label: string;
  title?: string;
}) {
  return (
    <span
      className={`dl-fact dl-fact--type dlm-entry-type dlm-entry-type--${kind}`}
      title={title ?? label}
    >
      <TypeIcon kind={kind} />
      <span className="dlm-entry-type-label">{label}</span>
    </span>
  );
}

function TypeIcon({ kind }: { kind: EntryTypeKind }) {
  if (kind === "web") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    );
  }

  if (kind === "direct") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    );
  }

  if (kind === "torrent") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 15a6 6 0 1 0 12 0c0-4.97-4-9-6-12-2 3-6 7.03-6 12z" />
      <path d="M9.5 15.5c0 1.38 1.12 2.5 2.5 2.5" />
    </svg>
  );
}

/** Platform capsule; the row's accent rail uses the same platform colour. */
export function EntryPlatformBadge({
  platform,
  title,
}: {
  platform: string;
  title?: string;
}) {
  return (
    <span
      className="dl-fact dl-fact--platform dl-platform-badge dlm-entry-platform"
      title={title ?? platform}
    >
      {platform}
    </span>
  );
}

/** One state flag (update / new / downloaded / verified / cache probe). */
export function EntryFlag({
  tone,
  label,
  title,
  icon,
}: {
  tone: EntryFlagTone;
  label: string;
  title?: string;
  icon?: EntryFlagIcon;
}) {
  const modifier =
    tone === "plain"
      ? ""
      : tone.startsWith("cache-")
        ? ` dl-flag--cache dl-flag--cache-${tone.slice("cache-".length)}`
        : ` dl-flag--${tone}`;

  return (
    <span className={`dl-flag${modifier}`} title={title ?? label}>
      {tone === "cache-checking" ? (
        <span className="dl-cache-spinner" aria-hidden />
      ) : icon ? (
        <FlagIcon icon={icon} />
      ) : null}
      {label}
    </span>
  );
}

function FlagIcon({ icon }: { icon: EntryFlagIcon }) {
  if (icon === "up") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    );
  }

  if (icon === "bolt") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    );
  }

  if (icon === "sparkle") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="none"
        aria-hidden
      >
        <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9z" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
