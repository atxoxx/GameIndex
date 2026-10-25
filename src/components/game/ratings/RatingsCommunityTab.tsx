import type { HltbStats, MetacriticScore, SteamGameReviews } from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { IconClock, IconSteam, IconUsers } from "../icons";
import RatingsDistribution from "./RatingsDistribution";
import RatingsHltbSection from "./RatingsHltbSection";
import RatingsScoreBlock from "./RatingsScoreBlock";
import RatingsSection from "./RatingsSection";
import {
  formatCount,
  hasHltbCommunity,
  hasRows,
  scoreTone,
  sentimentKey,
  steamPositivePercent,
  steamRows,
  userRows,
} from "./ratingsShared";

interface RatingsCommunityTabProps {
  metacritic: MetacriticScore | null;
  steam: SteamGameReviews | null;
  hltb: HltbStats | null;
}

/**
 * Everything the community thinks: Metacritic player ratings, Steam
 * reviews and the HowLongToBeat community block that used to live in the
 * HLTB sheet.
 */
export function RatingsCommunityTab({
  metacritic,
  steam,
  hltb,
}: RatingsCommunityTabProps) {
  const { t } = useLanguage();

  const userScore = metacritic?.userScore ?? null;
  const playerRows = userRows(metacritic, t);
  const hasPlayerBreakdown = hasRows(playerRows);
  const hasPlayers = userScore != null || hasPlayerBreakdown;

  const steamPercent = steamPositivePercent(steam);
  const hasSteam = steamPercent != null && (steam?.totalReviews ?? 0) > 0;
  const steamDistribution = steamRows(steam, t);
  const hasHltb = hasHltbCommunity(hltb);

  if (!hasPlayers && !hasSteam && !hasHltb) {
    return (
      <div className="rt-empty">
        <IconUsers size={22} />
        <p>{t("ratings.noCommunity")}</p>
      </div>
    );
  }

  const userSentiment = sentimentKey(userScore, 10);

  return (
    <>
      {hasPlayers && (
        <RatingsSection
          title={t("ratings.playersSource")}
          note={t("ratings.metacritic")}
          icon={<IconUsers size={14} />}
        >
          <div className="rt-detail">
            <RatingsScoreBlock
              label={t("ratings.userScore")}
              value={userScore != null ? userScore.toFixed(1) : "—"}
              unit={userScore != null ? "/ 10" : undefined}
              sentiment={userSentiment ? t(userSentiment) : null}
              meta={
                metacritic?.userRatingCount != null
                  ? t("ratings.basedOnUsers", {
                      count: formatCount(metacritic.userRatingCount),
                    })
                  : undefined
              }
              icon={<IconUsers size={12} />}
              tone={scoreTone(userScore, 10)}
            />

            <div className="rt-detail__main">
              <span className="rt-detail__caption">{t("ratings.scoreBreakdown")}</span>
              {hasPlayerBreakdown ? (
                <RatingsDistribution
                  rows={playerRows}
                  ariaLabel={t("ratings.userScore")}
                />
              ) : (
                <p className="rt-detail__hint">{t("ratings.noCommunity")}</p>
              )}
            </div>
          </div>
        </RatingsSection>
      )}

      {hasSteam && steamPercent != null && (
        <RatingsSection
          title={t("ratings.steamReviews")}
          note={t("ratings.steam")}
          icon={<IconSteam size={14} />}
        >
          <div className="rt-detail">
            <RatingsScoreBlock
              label={t("ratings.steam")}
              value={`${steamPercent}%`}
              sentiment={steam?.scoreDesc ?? t("ratings.recommended")}
              meta={
                steam
                  ? t("ratings.steamBasedOn", {
                      count: formatCount(steam.totalReviews),
                    })
                  : undefined
              }
              icon={<IconSteam size={12} />}
              tone={scoreTone(steamPercent)}
            />

            <div className="rt-detail__main">
              <span className="rt-detail__caption">{t("ratings.scoreBreakdown")}</span>
              <RatingsDistribution
                rows={steamDistribution}
                ariaLabel={t("ratings.steamReviews")}
              />
            </div>
          </div>
        </RatingsSection>
      )}

      {hltb && hasHltb && (
        <RatingsSection
          title={t("ratings.hltbSource")}
          note={t("gameInfo.hltb")}
          icon={<IconClock size={14} />}
        >
          <RatingsHltbSection stats={hltb} />
        </RatingsSection>
      )}
    </>
  );
}

export default RatingsCommunityTab;
