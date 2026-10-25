import { useMemo } from "react";
import { ArrowRight, Camera } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { readRecentCaptures } from "./mediaUtils";
import { MediaThumb } from "./MediaThumb";

interface CapturePreviewStripProps {
  onOpenGallery: () => void;
}

/**
 * Latest four captures for the Overview digest. Reads the cached scan only,
 * so opening the profile never triggers a filesystem walk.
 */
export function CapturePreviewStrip({ onOpenGallery }: CapturePreviewStripProps) {
  const { t } = useLanguage();
  const recent = useMemo(() => readRecentCaptures(4), []);

  if (recent.length === 0) return null;

  return (
    <section className="profile-card profile-captures" aria-label={t("profile.tab.gallery")}>
      <div className="profile-card__head">
        <h3>
          <Camera size={15} aria-hidden="true" /> {t("profile.recentCaptures")}
        </h3>
        <button type="button" className="profile-link" onClick={onOpenGallery}>
          {t("profile.openGallery")} <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>

      <div className="profile-captures__grid">
        {recent.map((media) => (
          <MediaThumb
            key={media.path}
            media={media}
            label={t("profile.openGallery")}
            onOpen={onOpenGallery}
          />
        ))}
      </div>
    </section>
  );
}
