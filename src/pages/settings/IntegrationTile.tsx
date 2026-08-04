import type { ReactNode } from "react";

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
}

/**
 * IntegrationTile — the shared shell every store tile is built from.
 * Renders the brand accent bar, icon, name + badge, status, actions and
 * an optional danger zone so the six integrations render identically.
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
}: IntegrationTileProps) {
  return (
    <div className={`integration-tile ${brand}`} id={id}>
      <div className="integration-tile-body-wrap">
        <div className="integration-tile-header">
          <span className="integration-tile-icon">{icon}</span>
          <div className="integration-tile-info">
            <div className="integration-tile-name-row">
              <h3 className="integration-tile-name">{name}</h3>
              {connected && (
                <span className="integration-badge active">{badgeLabel}</span>
              )}
            </div>
            <p className="integration-tile-desc">{description}</p>
          </div>
        </div>

        <div className="integration-tile-body">
          {status}
          {note && <p className="auth-note">{note}</p>}
          <div className="integration-tile-actions">{actions}</div>
          {result}
          {lastSync}
          {children}
        </div>
      </div>
      {dangerZone}
    </div>
  );
}
