import { useState } from "react";
import { KpiTile } from "../ui";
import type { Game, TimeToBeat } from "../../types/game";
import { parsePlayTime } from "../../types/game";
import { IconClock, IconInfo, IconStar } from "./icons";
import { useLanguage } from "../../context/LanguageContext";
import { useBigScreen } from "../../context/BigScreenContext";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenModal from "../bigscreen/BigScreenModal";
import HltbDetailsModal, { HltbDetailsContent } from "./HltbDetailsModal";

/**
 * TimeToBeatCard
 *
 *  Right-sidebar card showing HowLongToBeat milestones for a game.
 *  Each play style is a compact KPI tile carrying its headline hours,
 *  the HLTB submission count and an inline progress bar comparing the
 *  user's playtime to that target — so the card answers "how long is
 *  this game and how much have I done?" without repeating every label
 *  twice. A details button opens the full HLTB stat sheet.
 *
 *  Legacy rows that still only carry the old IGDB values render the
 *  same tile grid, minus submissions and the details button.
 */

interface TimeToBeatCardProps {
  game: Game;
}

type TierIntent = "default" | "accent" | "info" | "success";

interface Tier {
  label: string;
  seconds: number;
  intent: TierIntent;
  icon: typeof IconClock;
  count?: number;
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${Math.round(hours * 10) / 10}h`;
}

function buildTiers(
  ttb: TimeToBeat,
  isHltb: boolean,
  t: (key: string, vars?: Record<string, string | number>) => string
): Tier[] {
  const tiers: Tier[] = [];
  const add = (
    label: string,
    seconds: number | undefined,
    intent: TierIntent,
    icon: typeof IconClock,
    count?: number
  ) => {
    if (seconds !== undefined && seconds > 0) {
      tiers.push({ label, seconds, intent, icon, count });
    }
  };

  add(t("gameInfo.mainStory"), ttb.normally, "accent", IconStar, ttb.hltb?.mainStory?.count);
  add(t("gameInfo.mainExtra"), ttb.mainExtra, "info", IconClock, ttb.hltb?.mainExtra?.count);
  add(t("gameInfo.completionist"), ttb.completely, "success", IconStar, ttb.hltb?.completionist?.count);
  add(t("hltb.allStyles"), ttb.allStyles, "default", IconClock, ttb.hltb?.allStyles?.count);
  // Legacy IGDB "rushed" data has no HLTB equivalent.
  if (!isHltb) add(t("gameInfo.rushed"), ttb.hastily, "default", IconClock);

  return tiers;
}

/** Inline "played / target" bar shown in a tile footer. */
function TimeToBeatProgress({
  seconds,
  currentHours,
}: {
  seconds: number;
  currentHours: number;
}) {
  const targetHours = Math.max(1, seconds / 3600);
  const percent = Math.min(100, Math.round((currentHours / targetHours) * 100));
  const isDone = percent >= 100;

  return (
    <div className="ttb-progress">
      <div className="ttb-progress__meta">
        <span>
          {Math.round(currentHours * 10) / 10}h / {formatHours(seconds)}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="ttb-progress__track">
        <div
          className={`ttb-progress__fill${isDone ? " ttb-progress__fill--done" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function TimeToBeatCard({ game }: TimeToBeatCardProps) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsFocus = useFocusable(() => setDetailsOpen(true));

  const ttb = game.timeToBeat;
  if (!ttb) return null;

  const isHltb = !!ttb.hltb;
  const tiers = buildTiers(ttb, isHltb, t);
  if (tiers.length === 0) return null;

  const currentHours = parsePlayTime(game.playTime || "0h") / 60;

  return (
    <section className="game-section time-to-beat-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconClock size={16} />
        </span>
        {t("game.timeToBeatTitle")}
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

      <div className="ttb-tiles">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          return (
            <KpiTile
              key={tier.label}
              size="sm"
              label={tier.label}
              icon={<Icon size={12} />}
              value={formatHours(tier.seconds)}
              subtext={
                tier.count != null && tier.count > 0
                  ? t("hltb.submissions", { count: tier.count.toLocaleString() })
                  : undefined
              }
              intent={tier.intent}
              footer={<TimeToBeatProgress seconds={tier.seconds} currentHours={currentHours} />}
            />
          );
        })}
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
