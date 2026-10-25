import { useState } from "react";
import { KpiTile } from "../ui";
import type { Game, TimeToBeat } from "../../types/game";
import { formatPlayTime, parsePlayTime } from "../../types/game";
import { IconClock, IconInfo, IconStar } from "./icons";
import { useLanguage } from "../../context/LanguageContext";
import { useBigScreen } from "../../context/BigScreenContext";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenModal from "../bigscreen/BigScreenModal";
import HltbDetailsModal from "./hltb/HltbDetailsModal";
import { HltbDetailsContent } from "./hltb/HltbDetailsContent";

/**
 * TimeToBeatCard
 *
 *  Right-sidebar summary of HowLongToBeat milestones. Three headline
 *  playstyles carry the community average and submission count; a single
 *  personal bar underneath compares the user's playtime with Main Story,
 *  so the card answers "how long is this game and how far am I?" without
 *  repeating a progress bar inside every tile. The full stat sheet — all
 *  styles, ranges, community and platform data — lives behind Details.
 *
 *  Legacy rows that still only carry the old IGDB values keep their extra
 *  All Styles / Rushed tiles and skip the details affordance.
 */

interface TimeToBeatCardProps {
  game: Game;
  /** Optional HLTB refetch; wired only where the game lives in the library. */
  onRefresh?: () => void | Promise<void>;
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
  add(
    t("gameInfo.completionist"),
    ttb.completely,
    "success",
    IconStar,
    ttb.hltb?.completionist?.count
  );

  if (!isHltb) {
    add(t("hltb.allStyles"), ttb.allStyles, "default", IconClock);
    // Legacy IGDB "rushed" data has no HLTB equivalent.
    add(t("gameInfo.rushed"), ttb.hastily, "default", IconClock);
  }

  return tiers;
}

export default function TimeToBeatCard({ game, onRefresh }: TimeToBeatCardProps) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsFocus = useFocusable(() => setDetailsOpen(true));

  const ttb = game.timeToBeat;
  if (!ttb) return null;

  const isHltb = !!ttb.hltb;
  const tiers = buildTiers(ttb, isHltb, t);
  if (tiers.length === 0) return null;

  const playMinutes = parsePlayTime(game.playTime || "");
  const playHours = playMinutes / 60;
  const targetSeconds = ttb.normally ?? tiers[0]?.seconds ?? 0;
  const targetHours = targetSeconds / 3600;
  const percent =
    targetHours > 0 && playHours > 0
      ? Math.round((playHours / targetHours) * 100)
      : 0;
  const remainingSeconds = Math.max(0, targetSeconds - playMinutes * 60);
  const showProgress = playMinutes > 0 && targetSeconds > 0;

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
            />
          );
        })}
      </div>

      {showProgress && (
        <div className="ttb-summary">
          <div className="ttb-summary__head">
            <span className="ttb-summary__label">{t("hltb.yourPlaytime")}</span>
            <span className="ttb-summary__value">{formatPlayTime(playMinutes)}</span>
          </div>
          <div className="ttb-progress__track">
            <div
              className={`ttb-progress__fill${percent >= 100 ? " ttb-progress__fill--done" : ""}`}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
          <div className="ttb-summary__meta">
            <span
              className={`ttb-summary__pct${percent >= 100 ? " ttb-summary__pct--done" : ""}`}
            >
              {t("hltb.percentOfStyle", {
                percent,
                style: t("gameInfo.mainStory"),
              })}
            </span>
            <span>
              {percent >= 100
                ? t("hltb.targetReached")
                : t("hltb.toGo", { hours: formatHours(remainingSeconds) })}
            </span>
          </div>
        </div>
      )}

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
            onRefresh={onRefresh}
          />
        )
      )}
    </section>
  );
}
