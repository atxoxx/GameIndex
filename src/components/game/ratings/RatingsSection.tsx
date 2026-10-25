import type { ReactNode } from "react";

interface RatingsSectionProps {
  title: string;
  note?: ReactNode;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Titled section inside a ratings tab; keeps the head markup consistent. */
export function RatingsSection({
  title,
  note,
  icon,
  className,
  children,
}: RatingsSectionProps) {
  return (
    <section className={["rt-section", className ?? ""].filter(Boolean).join(" ")}>
      <div className="rt-section__head">
        <h3 className="rt-section__title">
          {icon && (
            <span className="rt-section__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h3>
        {note && <span className="rt-section__note">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export default RatingsSection;
