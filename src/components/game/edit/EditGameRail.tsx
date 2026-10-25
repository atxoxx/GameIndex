import { ChevronRight } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { EDIT_AREAS } from "./editRegistry";
import type { EditAreaKey, EditSectionKey } from "./draftKeys";

export function EditGameRail({
  activeArea,
  activeSection,
  onSelectArea,
  onSelectSection,
  showCompatibility,
  dirtyBySection,
}: {
  activeArea: EditAreaKey;
  activeSection: EditSectionKey;
  onSelectArea: (area: EditAreaKey) => void;
  onSelectSection: (section: EditSectionKey) => void;
  showCompatibility: boolean;
  dirtyBySection: Record<string, number>;
}) {
  const { t } = useLanguage();
  const areas = EDIT_AREAS.filter(
    (area) => area.key !== "compatibility" || showCompatibility,
  );

  return (
    <nav className="edit-rail" aria-label={t("edit.navAria")}>
      <div className="edit-rail-scroll">
        {areas.map((area) => {
          const isActive = area.key === activeArea;
          const areaDirty = area.sections.reduce(
            (total, section) => total + (dirtyBySection[section.key] ?? 0),
            0,
          );
          return (
            <div key={area.key} className="edit-rail-group">
              <button
                type="button"
                className={`edit-rail-area${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                aria-expanded={isActive}
                onClick={() => onSelectArea(area.key)}
              >
                <span className="edit-rail-icon">{area.icon}</span>
                <span className="edit-rail-area-label">{t(area.labelKey)}</span>
                {areaDirty > 0 && (
                  <span
                    className="edit-rail-dirty"
                    aria-label={t("edit.changedCount", { count: areaDirty })}
                  />
                )}
                <ChevronRight
                  size={14}
                  className="edit-rail-caret"
                  aria-hidden="true"
                />
              </button>

              {isActive && (
                <div className="edit-rail-sections" role="group" aria-label={t(area.labelKey)}>
                  {area.sections.map((section) => {
                    const isSectionActive = section.key === activeSection;
                    const changed = dirtyBySection[section.key] ?? 0;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        className={`edit-rail-section${isSectionActive ? " is-active" : ""}`}
                        aria-current={isSectionActive ? "page" : undefined}
                        onClick={() => onSelectSection(section.key)}
                      >
                        <span className="edit-rail-section-icon">{section.icon}</span>
                        <span className="edit-rail-section-label">{t(section.labelKey)}</span>
                        {changed > 0 && (
                          <span className="edit-rail-count" title={t("edit.changedCount", { count: changed })}>
                            {changed}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
