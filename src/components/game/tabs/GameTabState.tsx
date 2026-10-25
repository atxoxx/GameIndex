import type { ReactNode } from "react";
import { Skeleton } from "../../ui";

export interface GameTabEmptyProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Dashed rim marks a real empty state; no rim marks a quiet "no matches". */
  variant?: "empty" | "filtered" | "error";
  className?: string;
}

/** Shared empty / no-match / error block for the detail tabs. */
export function GameTabEmpty({
  icon,
  title,
  description,
  actions,
  variant = "empty",
  className,
}: GameTabEmptyProps) {
  return (
    <div
      className={["game-tab-state", `game-tab-state--${variant}`, className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role={variant === "error" ? "alert" : "status"}
    >
      {icon && (
        <span className="game-tab-state__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h3 className="game-tab-state__title">{title}</h3>
      {description && <p className="game-tab-state__desc">{description}</p>}
      {actions && <div className="game-tab-state__actions">{actions}</div>}
    </div>
  );
}

export interface GameTabSkeletonProps {
  /** Number of placeholder cards in the content area. */
  count?: number;
  /** Height of each card. */
  height?: number;
  className?: string;
}

/** Loading placeholders that use the tab's real layout metrics. */
export function GameTabSkeleton({
  count = 6,
  height = 210,
  className,
}: GameTabSkeletonProps) {
  return (
    <div
      className={["game-tab-skeleton", className ?? ""].filter(Boolean).join(" ")}
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} width="100%" height={`${height}px`} />
      ))}
    </div>
  );
}

export default GameTabEmpty;
