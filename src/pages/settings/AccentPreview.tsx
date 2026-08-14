import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useTheme } from "../../context/ThemeContext";
import { cssColorStringToHex } from "../../utils/color";

/**
 * AccentPreview
 *
 * A live demo of the injected accent family — the panel is styled
 * entirely from CSS custom properties (`--color-accent`, `-2`,
 * `-contrast`, `-soft`, `-border`, `-glow`, `--brand-gradient-strong`),
 * so it always shows exactly what the rest of the app is running on:
 * the chosen preset, a custom pick, or the active game's palette when
 * auto-game accent is on (no re-sampling, no duplicated color math).
 *
 * The hex readouts are read from the root's inline override (the exact
 * values SettingsContext injected) and fall back to the computed theme
 * default when no override is active, so the panel stays informative
 * even in the "no override" state.
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

  // Re-read the live family whenever the accent, the auto toggle, or
  // the theme changes. The registered accent tokens interpolate for a
  // moment after a change, so we prefer the inline *specified* values
  // (the exact target colors) over mid-transition computed ones.
  useEffect(() => {
    setRevision((n) => n + 1);
  }, [accentColor, autoGameAccent, currentTheme]);

  const family = useMemo(() => {
    if (typeof document === "undefined") {
      return { base: null, partner: null };
    }
    const root = document.documentElement;
    const read = (name: string): string => {
      const inline = root.style.getPropertyValue(name).trim();
      if (inline) return inline;
      return getComputedStyle(root).getPropertyValue(name).trim();
    };
    return {
      base: cssColorStringToHex(read("--color-accent")),
      partner: cssColorStringToHex(read("--color-accent-2")),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const hasOverride = accentColor != null;

  return (
    <div className={`accent-preview${hasOverride ? "" : " accent-preview--idle"}`}>
      <div className="accent-preview__head">
        <span className="accent-preview__title">
          {t("settings.accent.previewTitle")}
        </span>
        <span className="accent-preview__hex" aria-hidden>
          {hasOverride && family.base && family.partner
            ? `${family.base} → ${family.partner}`
            : family.base ?? ""}
        </span>
      </div>

      <div className="accent-preview__stage">
        {/* Signature brand surface — the gradient banner re-tints live. */}
        <div className="accent-preview__banner">
          <span className="accent-preview__banner-orb" aria-hidden />
          <span className="accent-preview__banner-btn">
            {t("settings.accent.previewBtn")}
          </span>
          {autoGameAccent && (
            <span className="accent-preview__live">
              <span className="accent-preview__live-dot" aria-hidden />
              {t("settings.accent.liveFromGame")}
            </span>
          )}
        </div>

        {/* On-accent samples: solid (base + contrast text) and soft
            (soft wash + border tint). */}
        <div className="accent-preview__row">
          <span className="accent-preview__sample accent-preview__sample--solid">
            {t("settings.accent.solidSample")}
          </span>
          <span className="accent-preview__sample accent-preview__sample--soft">
            {t("settings.accent.softSample")}
          </span>
        </div>

        {/* Family chips — base, gradient partner, soft, glow. */}
        <div className="accent-preview__chips">
          <span
            className="accent-preview__chip accent-preview__chip--base"
            title={t("settings.accent.baseHexLabel")}
          />
          <span
            className="accent-preview__chip accent-preview__chip--partner"
            title={t("settings.accent.partnerHexLabel")}
          />
          <span
            className="accent-preview__chip accent-preview__chip--soft"
            title={t("settings.accent.softSample")}
          />
          <span
            className="accent-preview__chip accent-preview__chip--glow"
            title={t("settings.accent.glowSample")}
          />
        </div>
      </div>
    </div>
  );
}
