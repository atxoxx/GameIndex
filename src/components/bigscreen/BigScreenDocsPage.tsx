// BigScreenDocsPage — controller-first user guide for Big Screen Mode.
//
// Renders the SAME content as the desktop DocsPage (the `docs.*` i18n
// keys — each section is `docs.<id>.title` + `docs.<id>.body`), reusing
// the shared section model and block parser from
// `src/components/docs/docsContent.tsx` so the two pages can never drift.
//
// Layout: a BigScreenBackHeader on top + a fully focusable scroll region
// (`.bigscreen-dashboard-scrollable-content`) — the spatial-nav engine
// auto-scrolls the focused element into view inside it.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useGamepad } from "../../hooks/GamepadProvider";
import { DOC_SECTIONS, DocBody } from "../docs/docsContent";
import BigScreenBackHeader from "./BigScreenBackHeader";

export default function BigScreenDocsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { registerBackHandler } = useGamepad();

  // B button goes back to wherever the user came from (System hub,
  // home, …). No overlay claims B while none of our modals are open.
  useEffect(
    () => registerBackHandler(() => navigate(-1)),
    [registerBackHandler, navigate],
  );

  return (
    <div className="bigscreen-library-dashboard">
      <BigScreenBackHeader
        title={t("bigscreen.docs.title")}
        subtitle={t("docs.subtitle")}
      />

      {/* Fully focusable scroll region — spatial navigation scrolls the
          focused element into view automatically. */}
      <div className="bigscreen-dashboard-scrollable-content bigscreen-docs-content">
        {DOC_SECTIONS.map((section) => (
          <section key={section.id}>
            <h2>
              {t(`docs.${section.id}.title`)}
            </h2>
            <DocBody text={t(`docs.${section.id}.body`)} />
          </section>
        ))}
      </div>
    </div>
  );
}
