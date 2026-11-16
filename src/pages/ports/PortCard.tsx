import { useEffect, useState, type CSSProperties } from "react";

import { ArtworkImage } from "../../components/ui/ArtworkImage";
import { useLanguage } from "../../context/LanguageContext";
import type { PortProject } from "../../types/port";
import { initials, originTone, platformAccent, statusTone } from "./portFormat";
import { usePortCover, useReveal } from "./usePortCover";

interface PortCardProps {
  project: PortProject;
  onOpen: (project: PortProject) => void;
}

/**
 * One catalog card: art, the game it ports, the project name, origin and
 * language. Art loads when the card approaches the viewport - see
 * `usePortCover` for the queue and cache.
 */
export default function PortCard({ project, onOpen }: PortCardProps) {
  const { t } = useLanguage();
  const { ref, revealed } = useReveal<HTMLButtonElement>();
  const cover = usePortCover(project.game, revealed);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(cover?.thumbUrl || cover?.url || null);
    setFailed(false);
  }, [cover]);

  const status = project.status || t("ports.status.unknown");
  const origin = project.origin || t("ports.origin.unknown");

  return (
    <button
      ref={ref}
      type="button"
      className="ports-card"
      onClick={() => onOpen(project)}
      title={`${project.game} - ${project.portName}`}
    >
      <span
        className="ports-card__art"
        style={{ "--port-accent": platformAccent(project.platform) } as CSSProperties}
      >
        {src && !failed ? (
          <ArtworkImage
            className="ports-card__img"
            src={src}
            alt=""
            onError={() => {
              if (cover?.fallbackUrl && src !== cover.fallbackUrl) setSrc(cover.fallbackUrl);
              else setFailed(true);
            }}
          />
        ) : (
          <span className="ports-card__placeholder" aria-hidden>
            <span className="ports-card__initials">{initials(project.game)}</span>
          </span>
        )}
        <span className="ports-card__platform">{project.platform}</span>
        <span className={`ports-card__status is-${statusTone(project.status)}`}>{status}</span>
      </span>

      <span className="ports-card__body">
        <span className="ports-card__game">{project.game}</span>
        <span className="ports-card__port">{project.portName}</span>
        <span className="ports-card__meta">
          <span className={`ports-chip is-${originTone(project.origin)}`}>{origin}</span>
          {project.languages ? (
            <span className="ports-card__lang">{project.languages}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
