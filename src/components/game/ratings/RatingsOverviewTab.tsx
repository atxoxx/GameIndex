import type { HltbStats, MetacriticScore, SteamGameReviews } from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { IconStar, IconSteam, IconUsers } from "../icons";
import RatingsDistribution from "./RatingsDistribution";
import RatingsScoreBlock from "./RatingsScoreBlock";
import {
  criticRows,
  formatCount,
  hasRows,
  scoreTone,
  sentimentKey,
  steamPositivePercent,
  steamRows,
  userRows,
} from "./ratingsShared";

interface RatingsOverviewTabProps {
  metacritic: MetacriticScore | null;
  steam: SteamGameReviews | null;
  hltb: HltbStats | null;
  igdbScore: number | null;
}

/**
 * One-screen answer to "how is this game received?": critic and player
 * verdicts with their splits, then compact Steam and HowLongToBeat cards.
 */
export function RatingsOverviewTab({
  metacritic,
  steam,
  hltb,
  igdbScore,
}: RatingsOverviewTabProps) {
  const { t } = useLanguage();

  const metascore = metacritic?.metascore ?? null;
  const userScore = metacritic?.userScore ?? null;
  const playerRows = userRows(metacritic, t);
  const hasPlayerBreakdown = hasRows(playerRows);
  const criticSplit = criticRows(metacritic, t);

  const steamPercent = steamPositivePercent(steam);
  const hasSteam = steamPercent != null && (steam?.totalReviews ?? 0) > 0;

  const hltbCommunity = hltb?.community;
  const hltbScore = hltbCommunity?.reviewScore ?? null;
  const hltbTone = scoreTone(hltbScore);
  const hltbTallies = [
    { key: "completed", value: hltbCommunity?.completed, label: t("hltb.completed") },
    { key: "backlog", value: hltbCommunity?.backlog, label: t("hltb.backlog") },
    { key: "playing", value: hltbCommunity?.playing, label: t("hltb.playing") },
  ].filter((item) => item.value != null);

  const hasCritics = metascore != null || hasRows(criticSplit);
  const hasPlayers = userScore != null || hasPlayerBreakdown;
  const hasHltb =
    hltbScore != null ||
    hltbTallies.length > 0 ||
    hltbCommunity?.reviews != null;
  const hasOtherSources = hasCritics || hasPlayers || hasSteam || hasHltb;

  if (!hasCritics && !hasPlayers && !hasSteam && !hasHltb && igdbScore == null) {
    return (
      <div className="rt-empty">
        <IconStar size={22} />
        <p>{t("ratings.noRatings")}</p>
      </div>
    );
  }

  const criticSentiment = sentimentKey(metascore);
  const userSentiment = sentimentKey(userScore, 10);

  return (
    <div className="rt-overview">
      <p className="rt-lead">{t("ratings.overviewLead")}</p>

      {(hasCritics || hasPlayers) && (
        <div className="rt-verdicts">
          {hasCritics && (
            <article className="rt-verdict">
              <RatingsScoreBlock
                label={t("ratings.criticsSource")}
                value={metascore != null ? Math.round(metascore) : "—"}
                unit={metascore != null ? "/ 100" : undefined}
                sentiment={criticSentiment ? t(criticSentiment) : null}
                meta={
                  metacritic?.criticReviewCount != null
                    ? t("ratings.basedOnCritics", {
                        count: formatCount(metacritic.criticReviewCount),
                      })
                    : undefined
                }
                icon={<IconStar size={12} />}
                tone={scoreTone(metascore)}
                className="rt-verdict__score"
              />
              <RatingsDistribution rows={criticSplit} ariaLabel={t("ratings.critics")} />
            </article>
          )}

          {hasPlayers && (
            <article className="rt-verdict">
              <RatingsScoreBlock
                label={t("ratings.playersSource")}
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
                className="rt-verdict__score"
              />
              <RatingsDistribution rows={playerRows} ariaLabel={t("ratings.userScore")} />
            </article>
          )}
        </div>
      )}

      {(hasSteam || hasHltb) && (
        <div className="rt-quicks">
          {hasSteam && steamPercent != null && (
            <article className="rt-quick">
              <div className="rt-quick__head">
                <span className="rt-quick__title">
                  <IconSteam size={14} />
                  {t("ratings.steamReviews")}
                </span>
                <span className="rt-quick__note">{t("ratings.steam")}</span>
              </div>
              <div className="rt-quick__figures">
                <span className={`rt-quick__value rt-quick__value--${scoreTone(steamPercent) ?? "success"}`}>
                  {steamPercent}%
                </span>
                <span className="rt-quick__sentiment">
                  {steam?.scoreDesc ?? t("ratings.recommended")}
                </span>
              </div>
              {steam && (
                <RatingsDistribution
                  rows={steamRows(steam, t)}
                  ariaLabel={t("ratings.steamReviews")}
                />
              )}
            </article>
          )}

          {hasHltb && (
            <article className="rt-quick">
              <div className="rt-quick__head">
                <span className="rt-quick__title">
                  <IconStar size={14} />
                  {t("ratings.hltbSource")}
                </span>
                <span className="rt-quick__note">{t("gameInfo.hltb")}</span>
              </div>
              <div className="rt-quick__figures">
                <span
                  className={`rt-quick__value${
                    hltbTone ? ` rt-quick__value--${hltbTone}` : " rt-quick__value--none"
                  }`}
                >
                  {hltbScore != null ? hltbScore : "—"}
                  {hltbScore != null && <span className="rt-quick__unit">/ 100</span>}
                </span>
                {hltbCommunity?.reviews != null && (
                  <span className="rt-quick__sentiment">
                    {t("hltb.basedOnReviews", {
                      count: formatCount(hltbCommunity.reviews),
                    })}
                  </span>
                )}
              </div>
              {hltbTallies.length > 0 && (
                <div className="rt-quick__stats">
                  {hltbTallies.map((item) => (
                    <span key={item.key} className="rt-quick__stat">
                      <b>{formatCount(item.value)}</b>
                      {item.label}
                    </span>
                  ))}
                </div>
              )}
            </article>
          )}
        </div>
      )}

      {igdbScore != null && !hasOtherSources && (
        <div className="rt-fineprint">
          <span className="rt-fineprint__label">{t("ratings.igdbCommunity")}</span>
          <span className={`rt-fineprint__value rt-quick__value--${scoreTone(igdbScore) ?? "success"}`}>
            {Math.round(igdbScore)}
          </span>
          <span className="rt-fineprint__unit">/ 100</span>
        </div>
      )}
    </div>
  );
}

export default RatingsOverviewTab;
