// BigScreenDocsPage — controller-first user guide for Big Screen Mode.
//
// Renders the SAME content as the desktop DocsPage (the `docs.*` i18n
// keys — each section is `docs.<id>.title` + `docs.<id>.body`), reusing
// the shared section model and block parser from
// `src/components/docs/docsContent.tsx` so the two pages can never drift.
//
// Controller model: every guide section is a registered focusable, so
// pressing down/down moves the focus section to section while the
// spatial-nav engine scrolls the focused section into view. The
// previous render had literally zero focusables in the content area —
// the D-pad had no hook to scroll anything, and the page could only
// be read with a mouse.

import { useLanguage } from "../../context/LanguageContext";
import { useDocsDictionary } from "../../hooks/useDocsDictionary";
import { DOC_SECTIONS, DocBody, type DocSectionDef } from "../docs/docsContent";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenBackHeader from "./BigScreenBackHeader";

function DocsSection({ section }: { section: DocSectionDef }) {
  const { t } = useLanguage();
  // Activation is a no-op on purpose — the registration is what makes
  // the section a D-pad stop and a scroll anchor.
  const sectionField = useFocusable(() => {});

  return (
    <section className="bigscreen-docs-section" {...sectionField}>
      <h2>{t(`docs.${section.id}.title`)}</h2>
      <DocBody text={t(`docs.${section.id}.body`)} />
    </section>
  );
}

export default function BigScreenDocsPage() {
  const { t } = useLanguage();
  const docsReady = useDocsDictionary();

  // Guide strings load per-locale; hold the view so it never renders keys.
  if (!docsReady) return null;

  return (
    <div className="bigscreen-library-dashboard">
      <BigScreenBackHeader
        title={t("bigscreen.docs.title")}
        subtitle={t("docs.subtitle")}
      />

      {/* Focusable section list — spatial navigation scrolls the
          focused section into view automatically. */}
      <div className="bigscreen-dashboard-scrollable-content bigscreen-docs-content">
        {DOC_SECTIONS.map((section) => (
          <DocsSection key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}
