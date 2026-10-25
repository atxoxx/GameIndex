import type { ReactNode } from "react";
import type { ScoreTone } from "./ratingsShared";

interface RatingsScoreBlockProps {
  label: string;
  value: ReactNode;
  /** Small suffix after the figure, e.g. "/ 100". */
  unit?: string;
  /** Localized verdict, e.g. "Generally favorable". */
  sentiment?: string | null;
  /** Source / sample line, e.g. "Based on 79 critic reviews". */
  meta?: ReactNode;
  icon?: ReactNode;
  tone: ScoreTone | null;
  className?: string;
}

/**
 * The large score + verdict block used by the critics, player and HLTB
 * sections. Tone tints the frame and the figure through tokens so every
 * theme keeps a readable score without per-source CSS.
 */
export function RatingsScoreBlock({
  label,
  value,
  unit,
  sentiment,
  meta,
  icon,
  tone,
  className,
}: RatingsScoreBlockProps) {
  return (
    <div
      className={[
        "rt-scoreblock",
        tone ? `rt-scoreblock--${tone}` : "rt-scoreblock--none",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="rt-scoreblock__label">
        {icon && (
          <span className="rt-scoreblock__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {label}
      </span>
      <span className="rt-scoreblock__figures">
        <span className="rt-scoreblock__value">{value}</span>
        {unit && <span className="rt-scoreblock__unit">{unit}</span>}
      </span>
      {sentiment && <span className="rt-scoreblock__sentiment">{sentiment}</span>}
      {meta && <span className="rt-scoreblock__meta">{meta}</span>}
    </div>
  );
}

export default RatingsScoreBlock;
