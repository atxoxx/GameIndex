import { useEffect, useState, type CSSProperties } from "react";
import { Layers } from "lucide-react";

import { ArtworkImage } from "../../components/ui/ArtworkImage";
import { useLanguage } from "../../context/LanguageContext";
import { initials, originTone, platformAccent, statusTone } from "./portFormat";
import type { PortGameGroup } from "./portGroups";
import { usePortCover, useReveal } from "./usePortCover";

interface PortCardProps {
  group: PortGameGroup;
  onOpen: (group: PortGameGroup) => void;
}

/**
 * One catalog card, representing every port of one game on one platform.
 * A single-project card shows the project name; a grouped card shows the
 * project count and the modal opens on a project switcher.
 */
export default function PortCard({ group, onOpen }: PortCardProps) {
  const { t } = useLanguage();
  const { ref, revealed } = useReveal<HTMLButtonElement>();
  const cover = usePortCover(group.game, revealed);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(cover?.thumbUrl || cover?.url || null);
    setFailed(false);
  }, [cover]);

  const project = group.primary;
  const status = group.status || t("ports.status.unknown");
  const origin = group.origin || t("ports.origin.mixed");
  const originKey = group.origin ? originTone(group.origin) : "default";
  const count = group.projects.length;
  const title =
    count > 1
      ? `${group.game} - ${t("ports.projectCount", { count })}`
      : `${group.game} - ${project.portName}`;

  return (
    <button
      ref={ref}
      type="button"
      className="ports-card"
      onClick={() => onOpen(group)}
      title={title}
    >
      <span
        className="ports-card__art"
        style={{ "--port-accent": platformAccent(group.platform) } as CSSProperties}
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
            <span className="ports-card__initials">{initials(group.game)}</span>
          </span>
        )}
        <span className="ports-card__platform">{group.platform}</span>
        <span className={`ports-card__status is-${statusTone(group.status)}`}>{status}</span>
      </span>

      <span className="ports-card__body">
        <span className="ports-card__game">{group.game}</span>
        {count > 1 ? (
          <span className="ports-card__projects">
            <Layers size={11} aria-hidden /> {t("ports.projectCount", { count })}
          </span>
        ) : (
          <span className="ports-card__port">{project.portName}</span>
        )}
        <span className="ports-card__meta">
          <span className={`ports-chip is-${originKey}`}>{origin}</span>
          {group.languages ? (
            <span className="ports-card__lang">{group.languages}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
