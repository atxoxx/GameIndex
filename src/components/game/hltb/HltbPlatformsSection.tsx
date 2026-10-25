import type { HltbStats } from "../../../types/game";
import { IconPlatform } from "../icons";
import { formatCount, formatDuration, type Translate } from "./hltbShared";

/** Per-platform averages, range and completion counts. */
export function HltbPlatformsSection({
  stats,
  t,
}: {
  stats: HltbStats;
  t: Translate;
}) {
  const platforms = stats.platformStats ?? [];
  if (platforms.length === 0) return null;

  return (
    <section className="hltb-section">
      <div className="hltb-section__head">
        <h3 className="hltb-section__title">
          <IconPlatform size={14} />
          {t("hltb.byPlatform")}
        </h3>
        <span className="hltb-section__note">{t("hltb.platformNote")}</span>
      </div>

      <div className="hltb-table-wrap">
        <table className="hltb-table">
          <thead>
            <tr>
              <th>{t("hltb.platform")}</th>
              <th>{t("gameInfo.mainStory")}</th>
              <th>{t("gameInfo.mainExtra")}</th>
              <th>{t("gameInfo.completionist")}</th>
              <th>{t("hltb.allStyles")}</th>
              <th>{t("hltb.rangeColumn")}</th>
              <th>{t("hltb.completed")}</th>
            </tr>
          </thead>
          <tbody>
            {platforms.map((platform) => (
              <tr key={platform.platform}>
                <td className="hltb-table__style">{platform.platform}</td>
                <td>{formatDuration(platform.mainStory)}</td>
                <td>{formatDuration(platform.mainExtra)}</td>
                <td>{formatDuration(platform.completionist)}</td>
                <td>{formatDuration(platform.allStyles)}</td>
                <td>
                  {platform.low || platform.high
                    ? t("hltb.rangeValue", {
                        low: formatDuration(platform.low),
                        high: formatDuration(platform.high),
                      })
                    : "—"}
                </td>
                <td>{formatCount(platform.completed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default HltbPlatformsSection;
