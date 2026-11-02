import type { JSX } from "react";
import {
  Bookmark,
  Flame,
  Gamepad2,
  Monitor,
  MousePointerClick,
  Sliders,
  Sparkles,
  ToggleRight,
  Tv,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { BUILTIN_PRESETS } from "./layoutPresets";
import type { LayoutPreset } from "./types";
import "./StudioGuide.css";

export interface StudioGuideProps {
  onApplyPreset: (preset: LayoutPreset) => void;
  onDismiss: () => void;
}

const PRESET_ICONS: Record<string, LucideIcon> = {
  balanced: Sparkles,
  minimal: Sliders,
  deck: Gamepad2,
  power: Flame,
  streamer: Tv,
};

const GUIDE_STEPS: { icon: LucideIcon; titleKey: string; descKey: string }[] = [
  {
    icon: MousePointerClick,
    titleKey: "settings.studio.guideStep1Title",
    descKey: "settings.studio.guideStep1Desc",
  },
  {
    icon: ToggleRight,
    titleKey: "settings.studio.guideStep2Title",
    descKey: "settings.studio.guideStep2Desc",
  },
  {
    icon: Monitor,
    titleKey: "settings.studio.guideStep3Title",
    descKey: "settings.studio.guideStep3Desc",
  },
];

export function StudioGuide({ onApplyPreset, onDismiss }: StudioGuideProps): JSX.Element {
  const { t } = useLanguage();
  const balanced = BUILTIN_PRESETS[0];

  return (
    <section className="studio-guide" aria-labelledby="studio-guide-title">
      <div className="studio-guide__head">
        <span className="studio-guide__icon">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        <div className="studio-guide__text">
          <h3 className="studio-guide__title" id="studio-guide-title">
            {t("settings.studio.guideTitle")}
          </h3>
          <p className="studio-guide__intro">{t("settings.studio.guideIntro")}</p>
        </div>
        <button
          type="button"
          className="studio-guide__close"
          onClick={onDismiss}
          aria-label={t("settings.studio.guideDismiss")}
          title={t("settings.studio.guideDismiss")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <ol className="studio-guide__steps">
        {GUIDE_STEPS.map((step, position) => {
          const StepIcon = step.icon;
          return (
            <li className="studio-guide__step" key={step.titleKey}>
              <span className="studio-guide__step-num">{position + 1}</span>
              <StepIcon size={16} aria-hidden="true" />
              <div>
                <span className="studio-guide__step-title">{t(step.titleKey)}</span>
                <span className="studio-guide__step-desc">{t(step.descKey)}</span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="studio-guide__presets">
        <h4 className="studio-guide__presets-title">
          {t("settings.studio.guidePresetTitle")}
        </h4>
        <div className="studio-guide__preset-grid">
          {BUILTIN_PRESETS.map((preset) => {
            const PresetIcon = PRESET_ICONS[preset.id] ?? Bookmark;
            return (
              <button
                type="button"
                className="studio-guide__preset"
                key={preset.id}
                onClick={() => onApplyPreset(preset)}
              >
                <PresetIcon size={15} className="studio-guide__preset-icon" aria-hidden="true" />
                <span className="studio-guide__preset-name">{t(preset.nameKey)}</span>
                <span className="studio-guide__preset-desc">{t(preset.descKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="studio-guide__actions">
        {balanced && (
          <button type="button" className="is-primary" onClick={() => onApplyPreset(balanced)}>
            {t("settings.studio.guideStartBalanced")}
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          {t("settings.studio.guideDismiss")}
        </button>
      </div>
    </section>
  );
}
