import { useLanguage } from "../../context/LanguageContext";
import { type GamerPersona } from "./insights";
import * as Icons from "./Icons";

export function GamerPersonaCard({ persona }: { persona: GamerPersona }) {
  const { t } = useLanguage();

  const renderBadgeIcon = (icon: GamerPersona["badgeIcon"]) => {
    switch (icon) {
      case "moon":
        return <Icons.Moon size={20} />;
      case "swords":
        return <Icons.Swords size={20} />;
      case "flame":
        return <Icons.Flame size={20} />;
      case "target":
        return <Icons.Target size={20} />;
      case "compass":
        return <Icons.Compass size={20} />;
      case "trophy":
        return <Icons.Trophy size={20} />;
      case "sparkles":
      default:
        return <Icons.Sparkles size={20} />;
    }
  };

  return (
    <div className={`act-persona act-persona--${persona.archetype}`}>
      <div className="act-persona__glow" aria-hidden="true" />
      <div className="act-persona__badge">
        <div className="act-persona__icon">{renderBadgeIcon(persona.badgeIcon)}</div>
      </div>

      <div className="act-persona__content">
        <div className="act-persona__header">
          <span className="act-persona__eyebrow">{t("activityInsights.persona.badge")}</span>
          <h3 className="act-persona__title">{t(persona.titleKey)}</h3>
        </div>
        <p className="act-persona__desc">{t(persona.descriptionKey)}</p>
      </div>

      <div className="act-persona__highlight">
        <span className="act-persona__highlight-label">{t(persona.highlightStatKey)}</span>
        <span className="act-persona__highlight-val">{persona.highlightStatValue}</span>
      </div>
    </div>
  );
}
