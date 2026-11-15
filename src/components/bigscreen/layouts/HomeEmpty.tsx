// Welcome panel shared by the five home layouts when the library is
// empty. It is the page's only focus stop in that state, so it must be
// reachable with the controller (not just clickable).

import { useFocusable } from "../../../hooks/useFocusable";
import { useLanguage } from "../../../context/LanguageContext";

export default function HomeEmpty({ onBrowse }: { onBrowse: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onBrowse);

  return (
    <section className="bst-empty">
      <span className="bst-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 21h8M12 18v3" />
        </svg>
      </span>
      <h1>{t("bigscreen.home.welcome")}</h1>
      <p>{t("bigscreen.home.welcomeDesc")}</p>
      <button
        {...props}
        type="button"
        className="bst-btn bst-btn--primary"
        onClick={onBrowse}
        data-bs-autofocus="true"
      >
        {t("nav.library")}
      </button>
    </section>
  );
}
