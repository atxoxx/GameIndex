import {
  AlertTriangle,
  ArrowRight,
  FolderSearch,
  HardDrive,
  HelpCircle,
  Package,
  Sparkles,
  X,
} from "lucide-react";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import type { Recommendation, RecommendationId } from "./recommendations";

interface Props {
  recommendations: Recommendation[];
  onAct: (recommendation: Recommendation) => void;
  onDismiss: (id: RecommendationId) => void;
  onDismissStrip: () => void;
  onOpenHealth: () => void;
}

const ICONS: Record<RecommendationId, typeof AlertTriangle> = {
  stale: AlertTriangle,
  unmeasured: HelpCircle,
  bigUnplayed: HardDrive,
  modsBloat: Package,
  lowSpace: HardDrive,
  leftovers: FolderSearch,
};

const MAX_VISIBLE = 3;

/**
 * RecommendationStrip — one line of "here is what to do next".
 *
 * Lives above the table only while there is something to act on, and can be
 * dismissed per item or entirely. Nothing here is a permanent widget.
 */
export function RecommendationStrip({
  recommendations,
  onAct,
  onDismiss,
  onDismissStrip,
  onOpenHealth,
}: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();

  if (recommendations.length === 0) return null;

  const visible = recommendations.slice(0, MAX_VISIBLE);
  const hidden = recommendations.length - visible.length;

  return (
    <section className="rec-strip" aria-label={t("storageRec.aria")}>
      <span className="rec-strip__lead">
        <Sparkles aria-hidden="true" />
        {t("storageRec.lead")}
      </span>

      <ul className="rec-strip__items">
        {visible.map((rec) => {
          const Icon = ICONS[rec.id];
          return (
            <li key={rec.id} className={`rec-strip__item rec-strip__item--${rec.tone}`}>
              <Icon className="rec-strip__icon" aria-hidden="true" />
              <span className="rec-strip__text">
                {t(`storageRec.${rec.id}`, {
                  count: rec.count,
                  plural: rec.count === 1 ? "" : "s",
                  size: rec.bytes > 0 ? formatSize(rec.bytes, unit) : "",
                })}
              </span>
              <button
                type="button"
                className="rec-strip__action"
                onClick={() => onAct(rec)}
              >
                {t(`storageRec.${rec.id}.action`)}
                <ArrowRight aria-hidden="true" />
              </button>
              <button
                type="button"
                className="rec-strip__dismiss"
                onClick={() => onDismiss(rec.id)}
                aria-label={t("storageRec.dismissOne")}
                title={t("storageRec.dismissOne")}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <button type="button" className="rec-strip__more" onClick={onOpenHealth}>
          {t("storageRec.more", { count: hidden })}
        </button>
      )}

      <button
        type="button"
        className="rec-strip__close"
        onClick={onDismissStrip}
        aria-label={t("storageRec.dismiss")}
        title={t("storageRec.dismiss")}
      >
        <X aria-hidden="true" />
      </button>
    </section>
  );
}
