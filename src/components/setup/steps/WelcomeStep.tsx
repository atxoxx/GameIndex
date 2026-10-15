import { Gamepad2, Library, MonitorPlay, ShieldCheck } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { FlagIcon } from "../../ui";
import { SetupSection } from "../SetupControls";

/** First step: what GameIndex is, plus the display-language picker. */
export default function WelcomeStep() {
  const { t, language, setLanguage, languages } = useLanguage();

  const bullets = [
    { icon: Library, title: t("setup.welcome.f1"), desc: t("setup.welcome.f1Desc") },
    { icon: Gamepad2, title: t("setup.welcome.f2"), desc: t("setup.welcome.f2Desc") },
    { icon: MonitorPlay, title: t("setup.welcome.f3"), desc: t("setup.welcome.f3Desc") },
    { icon: ShieldCheck, title: t("setup.welcome.f4"), desc: t("setup.welcome.f4Desc") },
  ];

  return (
    <div className="setup-step">
      <h3 className="setup-step__lead">{t("setup.welcome.heading")}</h3>
      <p className="setup-step__intro">{t("setup.welcome.intro")}</p>

      <ul className="setup-bullets">
        {bullets.map((bullet) => {
          const Icon = bullet.icon;
          return (
            <li key={bullet.title} className="setup-bullet">
              <span className="setup-bullet__icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="setup-bullet__text">
                <span className="setup-bullet__title">{bullet.title}</span>
                <span className="setup-bullet__desc">{bullet.desc}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <SetupSection
        title={t("setup.welcome.language")}
        desc={t("setup.welcome.languageDesc")}
        tip={t("setup.welcome.languageTip")}
      >
        <div className="setup-lang-grid">
          {languages.map((l) => (
            <button
              key={l.code}
              type="button"
              className={`setup-lang${l.code === language ? " is-selected" : ""}`}
              aria-pressed={l.code === language}
              onClick={() => void setLanguage(l.code)}
            >
              <FlagIcon code={l.flag} size={20} />
              <span className="setup-lang__label">{l.label}</span>
              <span className="setup-lang__code">{l.code.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </SetupSection>
    </div>
  );
}
