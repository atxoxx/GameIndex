import { useState, type CSSProperties } from "react";
import { Layers } from "lucide-react";

import { ArtworkImage } from "../../../components/ui/ArtworkImage";
import { useLanguage } from "../../../context/LanguageContext";
import { formatCount, initials, platformAccent, shortPlatform } from "../portFormat";
import { useReveal } from "../usePortCover";
import type { VrModGameGroup } from "../../../types/vrMod";
import { vrKindLabelKey, vrKindTone } from "./vrModFormat";

interface VrModCardProps {
  group: VrModGameGroup;
  onOpen: (group: VrModGameGroup) => void;
}

/** One card per game, laid out like the Ports card so the virtual grid matches. */
export default function VrModCard({ group, onOpen }: VrModCardProps) {
  const { t } = useLanguage();
  const { ref, revealed } = useReveal<HTMLButtonElement>();
  const [failed, setFailed] = useState(false);
  const primaryKind = group.kinds[0] ?? "unknown";
  const modCount = group.entries.length;
  const platform = group.platforms[0] ?? "PCVR";
  const cardPlatforms = group.platforms.filter((value) =>
    ["Windows", "macOS", "Linux", "PCVR", "Quest", "Pico"].includes(value),
  );
  const repoCount = group.githubLinks.length;
  const title = `${group.title} - ${t("ports.vrMods.modCount", { count: modCount })}`;

  return (
    <button
      ref={ref}
      type="button"
      className="ports-card vrmod-card"
      onClick={() => onOpen(group)}
      title={title}
    >
      <span
        className="ports-card__art"
        style={{ "--port-accent": platformAccent(platform) } as CSSProperties}
      >
        {group.image && !failed ? (
          <ArtworkImage
            className="ports-card__img"
            src={group.image}
            alt=""
            fetchPriority={revealed ? "high" : undefined}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="ports-card__placeholder" aria-hidden>
            <span className="ports-card__initials">{initials(group.title)}</span>
          </span>
        )}
        <span className="ports-card__platform" title={group.platforms.join(" / ")}>
          {platform}
        </span>
        <span className={`ports-card__status is-${vrKindTone(primaryKind)}`}>
          {t(vrKindLabelKey(primaryKind))}
        </span>
        {repoCount > 0 ? (
          <span className="ports-card__signals">
            <span className="ports-card__signal" title={t("ports.vrMods.githubLinks")}>
              <span aria-hidden>⌥</span> {formatCount(repoCount)}
            </span>
          </span>
        ) : null}
      </span>

      <span className="ports-card__body">
        <span className="ports-card__game">{group.title}</span>
        <span className="ports-card__projects">
          <Layers size={11} aria-hidden /> {t("ports.vrMods.modCount", { count: modCount })}
        </span>
        {cardPlatforms.length > 0 ? (
          <span className="ports-card__platforms">
            {cardPlatforms.slice(0, 3).map((value) => (
              <span key={value} className="ports-card__os">
                {shortPlatform(value)}
              </span>
            ))}
          </span>
        ) : null}
        <span className="ports-card__meta">
          <span className={`ports-chip is-${vrKindTone(primaryKind)}`}>
            {t(vrKindLabelKey(primaryKind))}
          </span>
          {group.author ? <span className="ports-card__lang">{group.author}</span> : null}
        </span>
      </span>
    </button>
  );
}
