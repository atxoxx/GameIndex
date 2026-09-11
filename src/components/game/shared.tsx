import type { ReactNode } from "react";
import { formatPlayTime, parsePlayTime } from "../../types/game";

/**
 * Shared helpers for the Game page card components.
 *
 * Anything that's reused across >= 2 cards lives here:
 *   - the section header (`SectionTitle`)
 *   - the time-to-beat progress row
 *   - the play-status dot
 *   - the click-to-edit size cell
 *
 * Keeping these here means the individual card files stay focused
 * on their own JSX and don't grow a forest of inline helpers.
 */

export function SectionTitle({
  icon,
  children,
  trailing,
}: {
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="game-section-title">
      <span className="game-section-title__icon" aria-hidden>
        {icon}
      </span>
      <span className="game-section-title__text">{children}</span>
      {trailing && (
        <span className="game-section-title__trailing">{trailing}</span>
      )}
    </div>
  );
}

/**
 * Small colored dot used to indicate play status in the dropdown
 * and any card that surfaces the current play status.
 */
export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      className="status-dot"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: color,
        boxShadow: `0 0 ${size}px ${color}`,
      }}
      aria-hidden
    />
  );
}

/**
 * Format a playtime string for KPI display. Trims trailing units
 * for very short sessions (e.g. "5m" instead of "0h 5m").
 */
export function formatPlayTimeCompact(playTime: string): string {
  const minutes = parsePlayTime(playTime);
  if (minutes <= 0) return "0h";
  return formatPlayTime(minutes);
}
