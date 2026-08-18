import type { ReactNode } from "react";

export function SectionPanel({
  icon,
  title,
  sub,
  tools,
  children,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`act-panel ${className}`.trim()}>
      {(icon || title || sub || tools) && (
        <header className="act-panel__header">
          <div className="act-panel__titles">
            {icon && (
              <span className="act-panel__icon" aria-hidden="true">
                {icon}
              </span>
            )}
            <div className="act-panel__text">
              <h3 className="act-panel__title">{title}</h3>
              {sub && <div className="act-panel__sub">{sub}</div>}
            </div>
          </div>
          {tools && <div className="act-panel__tools">{tools}</div>}
        </header>
      )}
      <div className="act-panel__body">{children}</div>
    </section>
  );
}
