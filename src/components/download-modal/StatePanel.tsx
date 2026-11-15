import type { ReactNode } from "react";
import "../../styles/download-modal-states.css";

export type StateTone = "neutral" | "accent" | "success" | "warning" | "danger";

/**
 * Shared chrome for the modal's loading / empty / error screens.
 *
 * Every state uses the same card so the modal never jumps between unrelated
 * layouts: one icon tile, one heading block, one optional well for detail, and
 * one action row. The card is intentionally compact — it sits inside the
 * results area, so it must not push the footer or the header around.
 */
export function StatePanel({
  tone = "neutral",
  icon,
  eyebrow,
  title,
  description,
  actions,
  children,
  role = "status",
  ariaLive,
  busy = false,
  className,
}: {
  tone?: StateTone;
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  role?: "status" | "alert" | "region";
  ariaLive?: "polite" | "assertive" | "off";
  busy?: boolean;
  className?: string;
}) {
  return (
    <section
      className={[
        "dlm-state-card",
        `dlm-state-card--${tone}`,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={role}
      aria-live={ariaLive ?? (role === "alert" ? "assertive" : "polite")}
      aria-busy={busy || undefined}
    >
      <header className="dlm-state-head">
        {icon && (
          <div className="dlm-state-icon" aria-hidden>
            {icon}
          </div>
        )}
        <div className="dlm-state-heading">
          {eyebrow && <span className="dlm-state-eyebrow">{eyebrow}</span>}
          <h3 className="dlm-state-title">{title}</h3>
          {description && <p className="dlm-state-desc">{description}</p>}
        </div>
      </header>

      {children}

      {actions && <div className="dlm-state-actions">{actions}</div>}
    </section>
  );
}
