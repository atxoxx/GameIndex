import { useLanguage } from "../../context/LanguageContext";

export interface HomeSectionsConfig {
  quickStats: boolean;
  quickLaunch: boolean;
  activity: boolean;
  achievements: boolean;
  friends: boolean;
  continuePlaying: boolean;
  recentlyAdded: boolean;
  downloads: boolean;
  wishlist: boolean;
  deals: boolean;
  news: boolean;
}

export const DEFAULT_HOME_SECTIONS: HomeSectionsConfig = {
  quickStats: true,
  quickLaunch: true,
  activity: true,
  achievements: true,
  friends: true,
  continuePlaying: true,
  recentlyAdded: true,
  downloads: true,
  wishlist: true,
  deals: true,
  news: true,
};

const LS_KEY = "gamelib:home:section-visibility:v1";

export function loadHomeSectionsConfig(): HomeSectionsConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_HOME_SECTIONS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_HOME_SECTIONS, ...parsed };
  } catch {
    return DEFAULT_HOME_SECTIONS;
  }
}

export function saveHomeSectionsConfig(cfg: HomeSectionsConfig): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

interface HomeCustomizeModalProps {
  isOpen: boolean;
  config: HomeSectionsConfig;
  onChange: (newConfig: HomeSectionsConfig) => void;
  onClose: () => void;
}

export default function HomeCustomizeModal({
  isOpen,
  config,
  onChange,
  onClose,
}: HomeCustomizeModalProps) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  const toggleSection = (key: keyof HomeSectionsConfig) => {
    const updated = { ...config, [key]: !config[key] };
    onChange(updated);
    saveHomeSectionsConfig(updated);
  };

  const handleReset = () => {
    onChange(DEFAULT_HOME_SECTIONS);
    saveHomeSectionsConfig(DEFAULT_HOME_SECTIONS);
  };

  const sections: { key: keyof HomeSectionsConfig; label: string }[] = [
    { key: "quickStats", label: t("home.customize.quickStats") },
    { key: "quickLaunch", label: t("home.customize.quickLaunch") },
    { key: "activity", label: t("home.customize.activity") },
    { key: "achievements", label: t("home.customize.achievements") },
    { key: "friends", label: t("home.customize.friends") },
    { key: "continuePlaying", label: t("home.customize.continuePlaying") },
    { key: "recentlyAdded", label: t("home.customize.recentlyAdded") },
    { key: "downloads", label: t("home.customize.downloads") },
    { key: "wishlist", label: t("home.customize.wishlist") },
    { key: "deals", label: t("home.customize.deals") },
    { key: "news", label: t("home.customize.news") },
  ];

  return (
    <div className="home-customize-overlay" onClick={onClose} role="presentation">
      <div
        className="home-customize-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-customize-title"
      >
        <div className="home-customize-modal__header">
          <div className="home-customize-modal__title-group">
            <h3 id="home-customize-title" className="home-customize-modal__title">
              {t("home.customize.title")}
            </h3>
            <p className="home-customize-modal__subtitle">
              {t("home.customize.subtitle")}
            </p>
          </div>
          <button
            type="button"
            className="home-customize-modal__close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="home-customize-modal__body">
          <div className="home-customize-modal__grid">
            {sections.map(({ key, label }) => {
              const checked = config[key];
              return (
                <label key={key} className="home-customize-toggle">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSection(key)}
                  />
                  <span className="home-customize-toggle__switch" aria-hidden />
                  <span className="home-customize-toggle__label">{label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="home-customize-modal__footer">
          <button
            type="button"
            className="home-customize-modal__reset-btn"
            onClick={handleReset}
          >
            {t("home.customize.reset")}
          </button>
          <button
            type="button"
            className="home-customize-modal__done-btn"
            onClick={onClose}
          >
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
