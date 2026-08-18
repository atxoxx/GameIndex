import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`act-empty${compact ? " act-empty--compact" : ""}`}>
      <div className="act-empty__icon">{icon}</div>
      <div className="act-empty__title">{title}</div>
      {hint && <div className="act-empty__hint">{hint}</div>}
      {action && <div className="act-empty__action">{action}</div>}
    </div>
  );
}
