import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useTheme } from "../../context/ThemeContext";
import { cssColorStringToHex, contrastRatio, textColorFor } from "../../utils/color";

/**
 * AccentPreview
 *
 * A modern, zero-gradient Precision UI Theme Inspector showcasing the
 * active accent family and game palette adaptation in real time.
 * Styled with pure CSS custom properties (`--color-accent`, `-hover`,
 * `-active`, `-contrast`, `-soft`, `-surface`, `-border`, `-glow`).
 */

interface AccentPreviewProps {
  /** Raw stored accent (hex or `rgb(...)`), `null` = no override. */
  accentColor: string | null;
  /** Whether the palette is currently driven by the active game. */
  autoGameAccent: boolean;
}

export default function AccentPreview({
  accentColor,
  autoGameAccent,
}: AccentPreviewProps) {
  const { t } = useLanguage();
  const { currentTheme } = useTheme();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setRevision((n) => n + 1);
  }, [accentColor, autoGameAccent, currentTheme]);

  const metrics = useMemo(() => {
    if (typeof document === "undefined") {
      return { base: null, contrast: "#ffffff", ratio: 4.5 };
    }
    const root = document.documentElement;
    const read = (name: string): string => {
      const inline = root.style.getPropertyValue(name).trim();
      if (inline) return inline;
      return getComputedStyle(root).getPropertyValue(name).trim();
    };
    const base = cssColorStringToHex(read("--color-accent"));
    const contrast = base ? textColorFor(base) : "#ffffff";
    const ratio = base ? Math.round(contrastRatio(base, contrast) * 10) / 10 : 4.5;

    return { base, contrast, ratio };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const hasOverride = accentColor != null;

  return (
    <div className={`accent-preview${hasOverride ? "" : " accent-preview--idle"}`}>
      <div className="accent-preview__head">
        <div className="accent-preview__title-group">
          <span className="accent-preview__pip" aria-hidden="true" />
          <span className="accent-preview__title">
            {t("settings.accent.previewTitle")}
          </span>
        </div>
        <div className="accent-preview__badges">
          <span className="accent-preview__badge-contrast">
            {metrics.ratio >= 7 ? "WCAG AAA" : "WCAG AA"} · {metrics.ratio}:1
          </span>
          <span className="accent-preview__hex" aria-hidden="true">
            {metrics.base ?? ""}
          </span>
        </div>
      </div>

      <div className="accent-preview__stage">
        {/* Modern Solid Surface Showcase Card */}
        <div className="accent-preview__card">
          <div className="accent-preview__card-laser" aria-hidden="true" />
          <div className="accent-preview__card-header">
            <div className="accent-preview__card-title">
              <span className="accent-preview__dot" aria-hidden="true" />
              <span>Precision Solid System</span>
            </div>
            {autoGameAccent && (
              <span className="accent-preview__live">
                <span className="accent-preview__live-dot" aria-hidden="true" />
                {t("settings.accent.liveFromGame")}
              </span>
            )}
          </div>

          <div className="accent-preview__actions">
            <button
              type="button"
              tabIndex={-1}
              className="accent-preview__btn-primary"
            >
              {t("settings.accent.previewBtn")}
            </button>
            <span className="accent-preview__chip-soft">
              {t("settings.accent.softSample")}
            </span>
            <span className="accent-preview__chip-laser">
              Laser Edge
            </span>
          </div>
        </div>

        {/* Tonal Precision Ramp */}
        <div className="accent-preview__ramp-wrap">
          <span className="accent-preview__ramp-label">Tonal Ramp</span>
          <div className="accent-preview__ramp">
            <div
              className="accent-preview__ramp-step accent-preview__ramp-step--base"
              title="100% Base Accent"
            />
            <div
              className="accent-preview__ramp-step accent-preview__ramp-step--hover"
              title="85% Elevated Hover"
            />
            <div
              className="accent-preview__ramp-step accent-preview__ramp-step--active"
              title="70% Pressed Active"
            />
            <div
              className="accent-preview__ramp-step accent-preview__ramp-step--soft"
              title="12% Translucent Soft"
            />
            <div
              className="accent-preview__ramp-step accent-preview__ramp-step--surface"
              title="6% Ambient Surface"
            />
            <div
              className="accent-preview__ramp-step accent-preview__ramp-step--glow"
              title="28% Luminescent Halo"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
