import { openUrl } from "@tauri-apps/plugin-opener";
import type { HltbStats } from "../../../types/game";
import { Badge } from "../../ui";
import { IconExternalLink, IconStar } from "../icons";
import { formatDuration, type Translate } from "./hltbShared";

/** DLC and other HLTB entries, each opening its own HLTB page. */
export function HltbRelatedSection({
  stats,
  t,
}: {
  stats: HltbStats;
  t: Translate;
}) {
  const related = stats.related ?? [];
  if (related.length === 0) return null;

  return (
    <section className="hltb-section">
      <div className="hltb-section__head">
        <h3 className="hltb-section__title">
          <IconStar size={14} />
          {t("hltb.related")}
        </h3>
        <span className="hltb-section__note">{t("hltb.relatedNote")}</span>
      </div>

      <div className="hltb-related">
        {related.map((item) => (
          <button
            type="button"
            className="hltb-related__item"
            key={item.gameId}
            onClick={() => {
              void openUrl(`https://howlongtobeat.com/game/${item.gameId}`);
            }}
            aria-label={t("hltb.openRelated", { name: item.gameName })}
          >
            <span className="hltb-related__name">{item.gameName}</span>
            <Badge variant={item.gameType === "dlc" ? "accent" : "default"}>
              {item.gameType === "dlc" ? t("hltb.dlc") : t("hltb.game")}
            </Badge>
            {item.gameId === stats.gameId && (
              <Badge variant="info">{t("hltb.thisGame")}</Badge>
            )}
            <span className="hltb-related__time" title={t("gameInfo.mainStory")}>
              {formatDuration(item.mainStory)}
            </span>
            {item.reviewScore != null && (
              <span className="hltb-related__score">
                <IconStar size={11} />
                {item.reviewScore}
              </span>
            )}
            <IconExternalLink size={13} className="hltb-related__open" />
          </button>
        ))}
      </div>
    </section>
  );
}

export default HltbRelatedSection;
