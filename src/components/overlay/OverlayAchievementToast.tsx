import { Sparkles, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { OverlayAchievementNotice } from "./useOverlayAchievementToasts";

/**
 * The achievement banner shown inside the HUD. While the ticker is collapsed
 * it replaces the chip row for its duration (and the window auto-fits); in the
 * panel it floats over the top edge without stealing the section layout.
 */
export default function OverlayAchievementToast({
  notice,
  floating = false,
  onDismiss,
  pending = 0,
}: {
  notice: OverlayAchievementNotice;
  floating?: boolean;
  onDismiss: () => void;
  pending?: number;
}) {
  const { t } = useLanguage();

  return (
    <div
      className={`overlay-achievement${floating ? " overlay-achievement--floating" : ""}`}
      data-testid="overlay-achievement-toast"
      role="status"
      aria-live="polite"
    >
      <span className="overlay-achievement__art" aria-hidden>
        {notice.icon ? (
          <img src={notice.icon} alt="" decoding="async" />
        ) : (
          <Sparkles size={22} />
        )}
      </span>

      <span className="overlay-achievement__copy">
        <span className="overlay-achievement__eyebrow">
          <Sparkles size={11} aria-hidden />
          {t("overlay.achievement.unlocked")}
          {notice.isRare ? (
            <span className="overlay-achievement__rare">
              {t("overlay.achievement.rare")}
            </span>
          ) : null}
        </span>
        <strong className="overlay-achievement__name">{notice.displayName}</strong>
        {notice.description ? (
          <span className="overlay-achievement__desc">{notice.description}</span>
        ) : null}
        <span className="overlay-achievement__meta">
          {notice.gameName}
          {notice.percent > 0
            ? ` · ${t("overlay.achievement.percent", {
                percent: Math.round(notice.percent * 10) / 10,
              })}`
            : ""}
        </span>
      </span>

      {pending > 0 ? (
        <span className="overlay-achievement__pending">+{pending}</span>
      ) : null}

      <button
        type="button"
        className="overlay-achievement__close"
        onClick={onDismiss}
        aria-label={t("overlay.achievement.dismiss")}
        title={t("overlay.achievement.dismiss")}
        data-tauri-drag-region="false"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
