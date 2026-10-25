import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";

export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`edit-field${className ? ` ${className}` : ""}`}>
      {label && (
        <label className="edit-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && <span className="edit-field-hint">{hint}</span>}
    </div>
  );
}

export function FieldGrid({
  columns = 2,
  className,
  children,
}: {
  columns?: 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`edit-form-grid${columns === 3 ? " edit-form-grid--3" : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  changed = 0,
  onReset,
  actions,
  id,
}: {
  title: string;
  description?: string;
  changed?: number;
  onReset?: () => void;
  actions?: ReactNode;
  id?: string;
}) {
  const { t } = useLanguage();
  return (
    <header className="edit-section-header">
      <div className="edit-section-heading">
        <h2 className="edit-section-title" id={id}>
          {title}
        </h2>
        {description && <p className="edit-section-desc">{description}</p>}
      </div>
      <div className="edit-section-header-actions">
        {changed > 0 && (
          <span className="edit-section-changed">
            {t("edit.changedCount", { count: changed })}
          </span>
        )}
        {onReset && (
          <button
            type="button"
            className="edit-section-reset"
            onClick={onReset}
            disabled={changed === 0}
            title={t("edit.resetSectionTitle")}
          >
            <RotateCcw size={13} aria-hidden="true" />
            <span>{t("edit.resetSection")}</span>
          </button>
        )}
        {actions}
      </div>
    </header>
  );
}

export function SettingCard({
  icon,
  title,
  description,
  actions,
  meta,
  id,
  className,
  children,
  tone,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
  tone?: "plain" | "accent" | "warning";
}) {
  return (
    <section
      id={id}
      className={[
        "edit-card",
        tone === "accent" ? "edit-card--accent" : "",
        tone === "warning" ? "edit-card--warning" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="edit-card-header">
        {icon && <span className="edit-card-icon">{icon}</span>}
        <div className="edit-card-heading">
          <div className="edit-card-title-row">
            <h3 className="edit-card-title">{title}</h3>
            {meta}
          </div>
          {description && <p className="edit-card-desc">{description}</p>}
        </div>
        {actions && <div className="edit-card-actions">{actions}</div>}
      </header>
      {children && <div className="edit-card-body">{children}</div>}
    </section>
  );
}

export function ToggleSwitch({
  checked,
  className,
}: {
  checked: boolean;
  className?: string;
}) {
  return (
    <span
      className={`edit-toggle-switch${checked ? " is-on" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      <span className="edit-toggle-knob" />
    </span>
  );
}

export function ToggleCard({
  icon,
  title,
  description,
  checked,
  onChange,
  badge,
  id,
  disabled,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  badge?: ReactNode;
  id?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`edit-card edit-toggle-card${checked ? " is-on" : ""}${disabled ? " is-disabled" : ""}`}
    >
      <button
        type="button"
        className="edit-toggle-card-hit"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        {icon && <span className="edit-card-icon">{icon}</span>}
        <span className="edit-card-heading">
          <span className="edit-card-title-row">
            <span className="edit-card-title">{title}</span>
            {badge}
          </span>
          {description && <span className="edit-card-desc">{description}</span>}
        </span>
        <ToggleSwitch checked={checked} />
      </button>
      {children && <div className="edit-card-body">{children}</div>}
    </section>
  );
}

export function EmptyState({
  icon,
  text,
  action,
}: {
  icon?: ReactNode;
  text: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="edit-empty-state">
      {icon && <span className="edit-empty-icon">{icon}</span>}
      <p className="edit-empty-text">{text}</p>
      {action}
    </div>
  );
}

export function InlineActions({ children }: { children: ReactNode }) {
  return <div className="edit-inline-actions">{children}</div>;
}
