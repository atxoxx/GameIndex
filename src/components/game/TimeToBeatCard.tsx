import { useState } from "react";
import { KpiTile } from "../ui";
import type { Game } from "../../types/game";
import { IconClock, IconInfo, IconStar } from "./icons";
import { TimeToBeatRow } from "./shared";
import { useLanguage } from "../../context/LanguageContext";
import { useBigScreen } from "../../context/BigScreenContext";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenModal from "../bigscreen/BigScreenModal";
import HltbDetailsModal, { HltbDetailsContent } from "./HltbDetailsModal";

/**
 * TimeToBeatCard
 *
 *  Right-sidebar card showing HowLongToBeat milestones for a game.
 *  Renders as a row of small KPI tiles (Main Story / Main + Extra /
 *  Completionist / All Styles) with a per-row progress bar below each
 *  so the user can see at a glance how far their playtime has carried
 *  them. A details button opens the full HLTB stat sheet — per-style
 *  medians and extremes, submission counts, community tallies and the
 *  per-platform breakdown.
 *
 *  Legacy rows that still only carry the old IGDB values keep the
 *  previous Main / Completionist / Rushed presentation.
 */

interface TimeToBeatCardProps {
  game: Game;
}

interface TierRow {
  label: string;
  seconds: number;
  intent: "default" | "accent" | "info" | "success";
  icon: typeof IconClock;
  subtext?: string;
}

function formatHours(seconds: number): string {
  return `${Math.round(seconds / 3600)}h`;
}

function submissionSubtext(count: number | undefined, t: (key: string, vars?: Record<string, string | number>) => string): string | undefined {
  if (count == null || count <= 0) return undefined;
  return t("hltb.submissions", { count: count.toLocaleString() });
}

export default function TimeToBeatCard({ game }: TimeToBeatCardProps) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsFocus = useFocusable(() => setDetailsOpen(true));

  const ttb = game.timeToBeat;
  if (!ttb) return null;

  const isHltb = !!ttb.hltb;
  const hasAny =
    (ttb.normally && ttb.normally > 0) ||
    (ttb.mainExtra && ttb.mainExtra > 0) ||
    (ttb.completely && ttb.completely > 0) ||
    (ttb.allStyles && ttb.allStyles > 0) ||
    (ttb.hastily && ttb.hastily > 0);
  if (!hasAny) return null;

  const tiers: TierRow[] = [];
  if (ttb.normally !== undefined && ttb.normally > 0) {
    tiers.push({
      label: t("gameInfo.mainStory"),
      seconds: ttb.normally,
      intent: "accent",
      icon: IconStar,
      subtext: submissionSubtext(ttb.hltb?.mainStory?.count, t),
    });
  }
  if (ttb.mainExtra !== undefined && ttb.mainExtra > 0) {
    tiers.push({
      label: t("gameInfo.mainExtra"),
      seconds: ttb.mainExtra,
      intent: "info",
      icon: IconClock,
      subtext: submissionSubtext(ttb.hltb?.mainExtra?.count, t),
    });
  }
  if (ttb.completely !== undefined && ttb.completely > 0) {
    tiers.push({
      label: t("gameInfo.completionist"),
      seconds: ttb.completely,
      intent: "success",
      icon: IconStar,
      subtext: submissionSubtext(ttb.hltb?.completionist?.count, t),
    });
  }
  if (ttb.allStyles !== undefined && ttb.allStyles > 0) {
    tiers.push({
      label: t("hltb.allStyles"),
      seconds: ttb.allStyles,
      intent: "default",
      icon: IconClock,
      subtext: submissionSubtext(ttb.hltb?.allStyles?.count, t),
    });
  }
  // Legacy IGDB "rushed" data has no HLTB equivalent.
  if (!isHltb && ttb.hastily !== undefined && ttb.hastily > 0) {
    tiers.push({
      label: t("gameInfo.rushed"),
      seconds: ttb.hastily,
      intent: "default",
      icon: IconClock,
    });
  }

  return (
    <section className="game-section time-to-beat-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconClock size={16} />
        </span>
        {isHltb ? t("gameInfo.hltbTitle") : t("game.timeToBeatTitle")}
        {isHltb && ttb.hltb && (
          <span className="ttb-title-actions">
            <span className="ttb-source-badge">{t("gameInfo.hltb")}</span>
            <button
              type="button"
              className="ttb-details-btn"
              ref={detailsFocus.ref}
              tabIndex={detailsFocus.tabIndex}
              onClick={detailsFocus.onClick}
              onKeyDown={detailsFocus.onKeyDown}
            >
              <IconInfo size={13} />
              {t("common.details")}
            </button>
          </span>
        )}
      </h2>

      <div className="ttb-kpi-grid">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          return (
            <KpiTile
              key={tier.label}
              size="sm"
              label={tier.label}
              icon={<Icon size={12} />}
              value={formatHours(tier.seconds)}
              subtext={tier.subtext}
              intent={tier.intent}
            />
          );
        })}
      </div>

      <div className="ttb-progress-list">
        {tiers.map((tier) => (
          <TimeToBeatRow
            key={tier.label}
            label={tier.label}
            targetSeconds={tier.seconds}
            currentPlayTime={game.playTime}
          />
        ))}
      </div>

      {detailsOpen && ttb.hltb && (
        isBigScreen ? (
          <BigScreenModal
            open
            title={t("gameInfo.hltbTitle")}
            onClose={() => setDetailsOpen(false)}
            width="960px"
            maxHeight="88%"
          >
            <HltbDetailsContent stats={ttb.hltb} playTime={game.playTime} />
          </BigScreenModal>
        ) : (
          <HltbDetailsModal
            stats={ttb.hltb}
            playTime={game.playTime}
            onClose={() => setDetailsOpen(false)}
          />
        )
      )}
    </section>
  );
}
