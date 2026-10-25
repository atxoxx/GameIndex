import { useId, useState, type RefObject } from "react";
import type {
  Game,
  MetacriticScore,
  SteamGameReviews,
} from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { SubTabs } from "../../ui";
import type { SubTabItem } from "../../ui/SubTabs";
import { IconOverview, IconStar, IconUsers } from "../icons";
import RatingsCommunityTab from "./RatingsCommunityTab";
import RatingsCriticsTab from "./RatingsCriticsTab";
import RatingsHero from "./RatingsHero";
import RatingsOverviewTab from "./RatingsOverviewTab";
import RatingsScoreboard, { type RatingsScoreboardCell } from "./RatingsScoreboard";
import {
  criticRows,
  hasHltbCommunity,
  hasRows,
  scoreTone,
  sentimentKey,
  steamPositivePercent,
  userRows,
  type RatingsTabId,
} from "./ratingsShared";
import "./RatingsDetails.css";

export interface RatingsDetailsContentProps {
  game: Game;
  metacritic: MetacriticScore | null;
  steam?: SteamGameReviews | null;
  /** Desktop tabbed sheet, or a stacked document for Big Screen. */
  variant?: "tabbed" | "stacked";
  /** Heading id owned by the modal for `aria-labelledby`. */
  headingId?: string;
  onClose?: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Shared ratings body. Desktop gets the tabbed sheet (Overview / Critics /
 * Community); Big Screen stacks the detail sections because a tab strip
 * and a gamepad are a poor match.
 */
export function RatingsDetailsContent({
  game,
  metacritic,
  steam,
  variant = "tabbed",
  headingId,
  onClose,
  closeButtonRef,
}: RatingsDetailsContentProps) {
  const { t } = useLanguage();
  const fallbackId = useId();
  const titleId = headingId ?? fallbackId;
  const [activeTab, setActiveTab] = useState<RatingsTabId>("overview");

  const hltb = game.timeToBeat?.hltb ?? null;
  const metascore = metacritic?.metascore ?? null;
  const userScore = metacritic?.userScore ?? null;
  const steamPercent = steamPositivePercent(steam);
  const hltbScore = hltb?.community?.reviewScore ?? null;
  const igdbScore = game.igdbRating ?? null;

  const criticSplit = criticRows(metacritic, t);
  const playerSplit = userRows(metacritic, t);
  const hasCritics = metascore != null || hasRows(criticSplit);
  const hasPlayers = userScore != null || hasRows(playerSplit);
  const hasSteam = steamPercent != null && (steam?.totalReviews ?? 0) > 0;
  const hasHltb = hasHltbCommunity(hltb);
  const hasAny = hasCritics || hasPlayers || hasSteam || hasHltb || igdbScore != null;

  const canNavigate = variant === "tabbed";

  const sources = [
    hasCritics || hasPlayers ? t("ratings.metacritic") : null,
    hasSteam ? t("ratings.steam") : null,
    hasHltb ? t("gameInfo.hltb") : null,
    igdbScore != null ? t("ratings.igdb") : null,
  ].filter((source): source is string => Boolean(source));

  const criticSentiment = sentimentKey(metascore);
  const userSentiment = sentimentKey(userScore, 10);

  const cells: RatingsScoreboardCell[] = [];
  if (metascore != null) {
    cells.push({
      id: "metacritic",
      label: t("ratings.metascore"),
      value: String(Math.round(metascore)),
      meta: criticSentiment ? t(criticSentiment) : undefined,
      tone: scoreTone(metascore),
      onSelect: canNavigate && hasCritics ? () => setActiveTab("critics") : undefined,
    });
  }
  if (userScore != null) {
    cells.push({
      id: "players",
      label: t("ratings.userScore"),
      value: userScore.toFixed(1),
      meta: userSentiment ? t(userSentiment) : undefined,
      tone: scoreTone(userScore, 10),
      onSelect: canNavigate && hasPlayers ? () => setActiveTab("community") : undefined,
    });
  }
  if (steamPercent != null && hasSteam) {
    cells.push({
      id: "steam",
      label: t("ratings.steam"),
      value: `${steamPercent}%`,
      meta: steam?.scoreDesc ?? t("ratings.recommended"),
      tone: scoreTone(steamPercent),
      onSelect: canNavigate ? () => setActiveTab("community") : undefined,
    });
  }
  if (hltbScore != null) {
    cells.push({
      id: "hltb",
      label: t("ratings.hltb"),
      value: String(hltbScore),
      meta: t("hltb.communityScore"),
      tone: scoreTone(hltbScore),
      onSelect: canNavigate && hasHltb ? () => setActiveTab("community") : undefined,
    });
  }
  if (igdbScore != null) {
    cells.push({
      id: "igdb",
      label: t("ratings.igdb"),
      value: String(Math.round(igdbScore)),
      meta: "/ 100",
      tone: scoreTone(igdbScore),
    });
  }

  const allTabs: SubTabItem<RatingsTabId>[] = [
    { id: "overview", label: t("ratings.tabOverview"), icon: IconOverview },
    { id: "critics", label: t("ratings.tabCritics"), icon: IconStar },
    { id: "community", label: t("ratings.tabCommunity"), icon: IconUsers },
  ];
  const tabItems = allTabs.filter((tab) => {
    if (tab.id === "overview") return hasAny;
    if (tab.id === "critics") return hasCritics;
    return hasPlayers || hasSteam || hasHltb;
  });

  const safeTab: RatingsTabId = tabItems.some((tab) => tab.id === activeTab)
    ? activeTab
    : tabItems[0]?.id ?? "overview";

  const tabContent =
    safeTab === "critics" ? (
      <RatingsCriticsTab score={metacritic} />
    ) : safeTab === "community" ? (
      <RatingsCommunityTab metacritic={metacritic} steam={steam ?? null} hltb={hltb} />
    ) : (
      <RatingsOverviewTab
        metacritic={metacritic}
        steam={steam ?? null}
        hltb={hltb}
        igdbScore={igdbScore}
      />
    );

  return (
    <div className={`rt-details rt-details--${variant}`}>
      <RatingsHero
        game={game}
        headingId={titleId}
        sources={sources}
        onClose={variant === "tabbed" ? onClose : undefined}
        closeButtonRef={closeButtonRef}
      />

      <RatingsScoreboard cells={cells} ariaLabel={t("ratings.scoreboard")} />

      {!hasAny ? (
        <div className="rt-empty rt-empty--sheet">
          <IconStar size={22} />
          <p>{t("ratings.noRatings")}</p>
        </div>
      ) : variant === "tabbed" ? (
        <>
          {tabItems.length > 1 && (
            <div className="rt-tabbar">
              <SubTabs
                items={tabItems}
                value={safeTab}
                onChange={setActiveTab}
                ariaLabel={t("ratings.tabsLabel")}
              />
            </div>
          )}
          <div
            className="rt-panel"
            role="tabpanel"
            aria-label={
              tabItems.find((tab) => tab.id === safeTab)?.label ?? t("ratings.tabsLabel")
            }
          >
            {tabContent}
          </div>
        </>
      ) : (
        <div className="rt-sections rt-sections--stacked">
          {!(hasCritics || hasPlayers || hasSteam || hasHltb) ? (
            <RatingsOverviewTab
              metacritic={metacritic}
              steam={steam ?? null}
              hltb={hltb}
              igdbScore={igdbScore}
            />
          ) : (
            <>
              {hasCritics && <RatingsCriticsTab score={metacritic} />}
              {(hasPlayers || hasSteam || hasHltb) && (
                <RatingsCommunityTab
                  metacritic={metacritic}
                  steam={steam ?? null}
                  hltb={hltb}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default RatingsDetailsContent;
