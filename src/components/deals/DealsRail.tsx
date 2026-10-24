import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

interface DealsRailProps {
  title: string;
  icon: ReactNode;
  count: number;
  onSeeAll?: () => void;
  children: ReactNode;
}

/**
 * One Overview section: heading, count, "see all" jump and a block grid.
 *
 * The block grid (rather than a scrolling rail) keeps every item reachable
 * without horizontal scrolling, which the mouse-first desktop layout needs.
 */
export default function DealsRail({
  title,
  icon,
  count,
  onSeeAll,
  children,
}: DealsRailProps) {
  const { t } = useLanguage();

  return (
    <section className="deals-rail" aria-label={title}>
      <header className="deals-rail__head">
        <h2 className="deals-rail__title">
          <span className="deals-rail__icon" aria-hidden="true">
            {icon}
          </span>
          {title}
          <span className="deals-rail__count">{count}</span>
        </h2>
        {onSeeAll && (
          <button type="button" className="deals-rail__more" onClick={onSeeAll}>
            {t("deals.seeAll")}
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="deals-rail__grid">{children}</div>
    </section>
  );
}
