import { useLanguage } from "../../context/LanguageContext";

interface Props {
  titleKey: string;
  descKey: string;
}

/** Shared "nothing to fix here" state for every health tab. */
export function HealthEmptyState({ titleKey, descKey }: Props) {
  const { t } = useLanguage();
  return (
    <div className="health-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <p className="health-empty-title">{t(titleKey)}</p>
      <p className="health-empty-desc">{t(descKey)}</p>
    </div>
  );
}
