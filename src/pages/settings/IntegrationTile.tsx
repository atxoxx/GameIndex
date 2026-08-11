import type { ReactNode } from "react";
import { ChevronDownIcon } from "./settingsIcons";

interface IntegrationTileProps {
  /** Brand class on the tile (`steam`, `epic`, `gog`, ...) + anchor id. */
  brand: string;
  id: string;
  icon: ReactNode;
  name: ReactNode;
  description: ReactNode;
  /** True when the account is connected / client detected. */
  connected: boolean;
  /** Small uppercase badge next to the title (connected / detected). */
  badgeLabel: ReactNode;
  /** Green status line ("Connected as X") or grey connect prompt. */
  status: ReactNode;
  /** Optional muted note under the status (auth notes). */
  note?: ReactNode;
  /** Primary + secondary action buttons row. */
  actions: ReactNode;
  /** Optional sync-result banner. */
  result?: ReactNode;
  /** Optional "Last sync" line. */
  lastSync?: ReactNode;
  /** Extra controls (toggles / forms) below the actions. */
  children?: ReactNode;
  /** Bottom danger strip (disconnect) — only when connected. */
  dangerZone?: ReactNode;
  /** Whether the tile body is expanded. */
  open: boolean;
  onToggle: () => void;
  /** Screen-reader labels for the header toggle. */
  expandLabel?: string;
  collapseLabel?: string;
}

/**
 * IntegrationTile — the collapsible shell every store tile is built
 * from. The header (brand icon, name, badge, description) is a toggle
 * button: collapsed tiles show only the header so the six integrations
 * read as a scannable list; expanding reveals status, actions, forms
 * and the optional danger zone.
 */
export default function IntegrationTile({
  brand,
  id,
  icon,
  name,
  description,
  connected,
  badgeLabel,
  status,
  note,
  actions,
  result,
  lastSync,
  children,
  dangerZone,
  open,
  onToggle,
  expandLabel,
  collapseLabel,
}: IntegrationTileProps) {
  return (
    <div
      className={`integration-tile ${brand}${open ? "" : " is-collapsed"}`}
      id={id}
      data-connected={connected || undefined}
    >
      <button
        type="button"
        className="integration-tile-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? collapseLabel : expandLabel}
      >
        <span className="integration-tile-icon" aria-hidden>
          {icon}
        </span>
        <span className="integration-tile-info">
          <span className="integration-tile-name-row">
            <span className="integration-tile-name">{name}</span>
            {connected && (
              <span className="integration-badge active">{badgeLabel}</span>
            )}
          </span>
          <span className="integration-tile-desc">{description}</span>
        </span>
        <span
          className={`integration-tile-chevron${open ? " open" : ""}`}
          aria-hidden
        >
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <div className="integration-tile-body-wrap">
          <div className="integration-tile-body">
            {status}
            {note && <p className="auth-note">{note}</p>}
            <div className="integration-tile-actions">{actions}</div>
            {result}
            {lastSync}
            {children}
          </div>
        </div>
      )}
      {open && dangerZone}
    </div>
  );
}
