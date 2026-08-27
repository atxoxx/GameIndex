import type { DetailSectionKey } from "../../context/SettingsContext";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";

/**
 * DetailSectionsHiddenNote
 *
 *  When the user hides one or more detail sections (Settings → Appearance →
 *  Game & Store Detail Sections), this card appears at the top of the page's
 *  Overview tab to explain why content is missing and point back to where it
 *  can be restored. Renders nothing when every applicable section is visible.
 *
 *  `sections` lists the sections this page actually renders, so the card on
 *  the store page never mentions library-only tabs (Mods, News, Activity).
 */

interface DetailSectionsHiddenNoteProps {
  /** Sections rendered by this page, in display order. */
  sections: DetailSectionKey[];
}

export default function DetailSectionsHiddenNote({ sections }: DetailSectionsHiddenNoteProps) {
  const { t } = useLanguage();
  const { detailSectionVisible } = useSettings();

  const hidden = sections.filter((key) => !detailSectionVisible[key]);
  if (hidden.length === 0) return null;

  return (
    <section className="game-section detail-sections-note">
      <h2 className="detail-sections-note__title">
        {t("settings.detailSections.hiddenNoteTitle")}
      </h2>
      <p className="detail-sections-note__intro">
        {t("settings.detailSections.hiddenNoteIntro")}
      </p>
      <ul className="detail-sections-note__list">
        {hidden.map((key) => (
          <li key={key}>{t(`settings.detailSections.${key}.title`)}</li>
        ))}
      </ul>
      <p className="detail-sections-note__manage">
        {t("settings.detailSections.hiddenNoteManage")}
      </p>
    </section>
  );
}