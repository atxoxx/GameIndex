import { useState } from "react";
import { KpiTile } from "../ui";
import type { Game } from "../../types/game";
import {
  IconChevronRight,
  IconClock,
  IconStar,
  IconSteam,
  IconUsers,
} from "./icons";
import { useLanguage } from "../../context/LanguageContext";
import { useSteamGameStats } from "../../hooks/useSteamGameStats";
import { useMetacriticScore } from "../../hooks/useMetacriticScore";
import { useBigScreen } from "../../context/BigScreenContext";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenModal from "../bigscreen/BigScreenModal";
import RatingsDetailsContent from "./ratings/RatingsDetailsContent";
import RatingsDetailsModal from "./ratings/RatingsDetailsModal";

/**
 * RatingsKpiCard
 *
 *  Right-sidebar "Ratings" card. Shows the Metacritic Metascore, the IGDB
 *  community score, Steam user reviews and the HowLongToBeat community
 *  score, plus one sentiment bar summarising the critic split. The header
 *  button opens the full Ratings sheet: Overview / Critics / Community,
 *  with the HLTB community block folded in.
 */

interface RatingsKpiCardProps {
  game: Game;
}

function scoreIntent(score: number) {
  if (score >= 75) return "success" as const;
  if (score >= 50) return "warning" as const;
  return "danger" as const;
}

interface BreakdownItem {
  key: "positive" | "mixed" | "negative";
  label: string;
  tone: "positive" | "mixed" | "negative";
  percent: number;
}

export default function RatingsKpiCard({ game }: RatingsKpiCardProps) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const { data: steamStats } = useSteamGameStats(game.steamAppId);
  const { data: metacritic } = useMetacriticScore(game.name);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsFocus = useFocusable(() => setDetailsOpen(true));

  const steamReviews = steamStats?.reviews;
  const steamPositivePercent =
    steamReviews && steamReviews.totalReviews > 0
      ? Math.round(
          (steamReviews.totalPositive / steamReviews.totalReviews) * 100,
        )
      : null;

  // Metacritic is the headline score; the IGDB community score stays as a
  // second tile whenever it is available.
  const metascore = metacritic?.metascore ?? null;
  const hasMetascore = metascore != null;
  const igdbScore = game.igdbRating ?? null;
  const hasIgdb = igdbScore != null;
  const hasSteamReview = steamPositivePercent != null;
  const hltbScore = game.timeToBeat?.hltb?.community?.reviewScore ?? null;
  const hasHltb = hltbScore != null;

  if (!hasMetascore && !hasIgdb && !hasSteamReview && !hasHltb) return null;

  // Metacritic's own critic repartition (positive / mixed / negative).
  const criticPositive = metacritic?.positiveCount ?? 0;
  const criticNeutral = metacritic?.neutralCount ?? 0;
  const criticNegative = metacritic?.negativeCount ?? 0;
  const criticTotal = criticPositive + criticNeutral + criticNegative;
  const breakdownItems: BreakdownItem[] =
    criticTotal > 0
      ? (["positive", "mixed", "negative"] as const).map((tone) => {
          const count =
            tone === "positive"
              ? criticPositive
              : tone === "mixed"
                ? criticNeutral
                : criticNegative;
          return {
            key: tone,
            label: t(`ratings.${tone}`),
            tone,
            percent: Math.round((count / criticTotal) * 100),
          };
        })
      : [];

  return (
    <section className="game-section ratings-kpi-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconStar size={16} />
        </span>
        {t("ratings.title")}
        <span className="ratings-card__actions">
          <button
            type="button"
            className="ratings-card__cta"
            ref={detailsFocus.ref}
            tabIndex={detailsFocus.tabIndex}
            onClick={detailsFocus.onClick}
            onKeyDown={detailsFocus.onKeyDown}
          >
            {t("ratings.openAll")}
            <IconChevronRight size={13} />
          </button>
        </span>
      </h2>

      <div className="ratings-kpi-grid">
        {hasMetascore && (
          <KpiTile
            size="md"
            label={t("ratings.metacritic")}
            icon={<IconStar size={12} />}
            value={Math.round(metascore)}
            subtext={`/ 100`}
            intent={scoreIntent(metascore)}
            className="ratings-kpi-tile"
          />
        )}
        {hasIgdb && (
          <KpiTile
            size="md"
            label={t("ratings.igdb")}
            icon={<IconUsers size={12} />}
            value={Math.round(igdbScore)}
            subtext={`/ 100`}
            intent={scoreIntent(igdbScore)}
            className="ratings-kpi-tile"
          />
        )}
        {steamPositivePercent != null && (
          <KpiTile
            size="md"
            label={t("ratings.steam")}
            icon={<IconSteam size={12} />}
            value={`${steamPositivePercent}%`}
            subtext={steamReviews?.scoreDesc || t("ratings.recommended")}
            intent={scoreIntent(steamPositivePercent)}
            className="ratings-kpi-tile"
          />
        )}
        {hasHltb && (
          <KpiTile
            size="md"
            label={t("ratings.hltb")}
            icon={<IconClock size={12} />}
            value={Math.round(hltbScore)}
            subtext={t("hltb.communityScore")}
            intent={scoreIntent(hltbScore)}
            className="ratings-kpi-tile"
          />
        )}
      </div>

      {breakdownItems.length > 0 && (
        <div className="ratings-breakdown">
          <div className="ratings-breakdown__head">
            <span className="ratings-breakdown__title">
              {t("ratings.scoreBreakdown")}
            </span>
            <span className="ratings-breakdown__note">{t("ratings.critics")}</span>
          </div>
          <div className="ratings-breakdown__bar" aria-hidden="true">
            {breakdownItems.map((item) =>
              item.percent > 0 ? (
                <span
                  key={item.key}
                  className={`ratings-breakdown__seg ratings-breakdown__seg--${item.tone}`}
                  style={{ width: `${item.percent}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="ratings-breakdown__legend">
            {breakdownItems.map((item) => (
              <li
                key={item.key}
                className={`ratings-breakdown__legend-item ratings-breakdown__legend-item--${item.tone}`}
              >
                <span
                  className={`ratings-breakdown__dot ratings-breakdown__dot--${item.tone}`}
                  aria-hidden="true"
                />
                <span className="ratings-breakdown__legend-label">{item.label}</span>
                <span className="ratings-breakdown__legend-value">{item.percent}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detailsOpen &&
        (isBigScreen ? (
          <BigScreenModal
            open
            title={t("ratings.modalTitle")}
            onClose={() => setDetailsOpen(false)}
            width="960px"
            maxHeight="88%"
          >
            <RatingsDetailsContent
              game={game}
              metacritic={metacritic}
              steam={steamReviews}
              variant="stacked"
            />
          </BigScreenModal>
        ) : (
          <RatingsDetailsModal
            game={game}
            metacritic={metacritic}
            steam={steamReviews}
            onClose={() => setDetailsOpen(false)}
          />
        ))}
    </section>
  );
}
