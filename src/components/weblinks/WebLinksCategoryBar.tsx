import { useLanguage } from "../../context/LanguageContext";
import { SOURCE_CATEGORIES } from "./sources";
import type { SourceCategoryKey } from "./types";

interface WebLinksCategoryBarProps {
  activeCategory: SourceCategoryKey;
  onSelectCategory: (category: SourceCategoryKey) => void;
  counts: Record<SourceCategoryKey, number>;
}

export default function WebLinksCategoryBar({
  activeCategory,
  onSelectCategory,
  counts,
}: WebLinksCategoryBarProps) {
  const { t } = useLanguage();

  return (
    <div className="wl-categories-bar" role="navigation" aria-label="Web link categories">
      {SOURCE_CATEGORIES.map((cat) => {
        const isActive = activeCategory === cat.key;
        const count = counts[cat.key] ?? 0;

        return (
          <button
            key={cat.key}
            type="button"
            className={`wl-category-pill${isActive ? " active" : ""}`}
            onClick={() => onSelectCategory(cat.key)}
            aria-pressed={isActive}
          >
            <span>{t(cat.i18nKey)}</span>
            {count > 0 && <span className="wl-category-badge">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
