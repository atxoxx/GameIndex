import { useMemo } from "react";
import {
  Camera,
  ChartColumn,
  Clock,
  Download,
  Flag,
  Flame,
  Gamepad2,
  Library,
  Share2,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { SchematicSparkline, Track } from "./StudioSchematics";
import type { OrderListItem } from "./types";

import "./CommunityPagePreview.css";

export interface CommunityPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

const GOAL_PCT = 80;
const GOAL_RING_RADIUS = 18;
const GOAL_RING_CIRCUMFERENCE = 2 * Math.PI * GOAL_RING_RADIUS;

const RANKED_GAMES = [
  { name: "Elden Ring", sessions: 38, hours: "142h", pct: 100 },
  { name: "Helldivers 2", sessions: 24, hours: "96h", pct: 68 },
  { name: "Hades II", sessions: 19, hours: "64h", pct: 45 },
  { name: "Baldur's Gate 3", sessions: 12, hours: "41h", pct: 29 },
];

const RECENT_UNLOCKS = [
  { title: "Ranni's Ending", meta: "Elden Ring · Oct 28" },
  { title: "Hell Dive", meta: "Helldivers 2 · Oct 26" },
  { title: "Night Owl", meta: "Hades II · Oct 21" },
];

export function CommunityPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: CommunityPagePreviewProps) {
  const { t } = useLanguage();
  const widgetDrag = useOrderDrag(onReorderWidgets);

  const byId = useMemo(
    () => new Map(widgetItems.map((item, index) => [item.id, { item, index }])),
    [widgetItems],
  );

  const renderCard = (id: string, variant: "card" | "slot" = "card", children?: React.ReactNode) => {
    const entry = byId.get(id);
    if (!entry) return null;
    const { item, index } = entry;
    const isDragging = widgetDrag.dragIndex === index;
    const isDropTarget =
      widgetDrag.overIndex === index &&
      widgetDrag.dragIndex !== null &&
      widgetDrag.dragIndex !== index;
    const isLit = highlightedId === item.id;

    return (
      <StudioPageWidgetCard
        key={item.id}
        item={item}
        index={index}
        isDragging={isDragging}
        isDropTarget={isDropTarget}
        isLit={isLit}
        inspectMode={inspectMode}
        variant={variant}
        onStartDrag={(e) => {
          if (e.button !== 0 || inspectMode) return;
          widgetDrag.startDrag(index, { x: e.clientX, y: e.clientY });
        }}
        onToggle={() => onToggleWidget(item.id)}
        onInspect={onInspectElement}
      >
        {children}
      </StudioPageWidgetCard>
    );
  };

  return (
    <div
      className="studio-page-preview studio-page-preview--community"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. ProfileHeader: identity band, XP track, shared stat band */}
      <div className="studio-page-full">
        {renderCard(
          "communityHeader",
          "slot",
          <div className="studio-cprof-header">
            <div className="studio-cprof-idrow">
              <span className="studio-cprof-avatar">
                <Sparkles size={13} />
                <span className="studio-cprof-avatar__level">
                  {t("stats.level")} 42
                </span>
              </span>

              <div className="studio-cprof-identity">
                <span className="studio-cprof-eyebrow">{t("profile.eyebrow")}</span>
                <span className="studio-cprof-title">{t("profile.title")}</span>
                <span className="studio-cprof-subtitle">
                  <span>{t("stats.persona.nightOwl.title")}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t("stats.persona.nightOwl.subtitle")}</span>
                  <span className="studio-cprof-streak">
                    <Flame size={9} />
                    14 {t("communityExtras.dayStreak")}
                  </span>
                </span>
              </div>

              <div className="studio-cprof-header-actions">
                <div className="studio-cprof-range">
                  <span className="is-active">{t("activity.allTime")}</span>
                  <span>2026</span>
                  <span>90d</span>
                  <span>30d</span>
                </div>
                <div className="studio-cprof-tools">
                  <span className="studio-cprof-tool">
                    <Share2 size={9} />
                  </span>
                  <span className="studio-cprof-tool">
                    <Camera size={9} />
                  </span>
                  <span className="studio-cprof-tool">
                    <Download size={9} />
                  </span>
                </div>
              </div>
            </div>

            <div className="studio-cprof-xp">
              <div className="studio-cprof-xp__top">
                <span>
                  {t("stats.level")} 42 <span className="studio-cprof-xp__title">Explorer</span>
                </span>
                <span>8,450 / 10,000 XP</span>
              </div>
              <Track value={84} height={5} />
            </div>

            <div className="studio-cprof-statband">
              <span className="studio-cprof-stat">
                <span className="studio-cprof-stat__label">
                  <Clock size={9} />
                  {t("community.totalPlaytime")}
                </span>
                <span className="studio-cprof-stat__value studio-cprof-tone--accent">428h</span>
                <span className="studio-cprof-stat__detail">{t("activity.allTime")}</span>
              </span>
              <span className="studio-cprof-stat">
                <span className="studio-cprof-stat__label">
                  <Gamepad2 size={9} />
                  {t("community.sessions")}
                </span>
                <span className="studio-cprof-stat__value">114</span>
              </span>
              <span className="studio-cprof-stat">
                <span className="studio-cprof-stat__label">
                  <Library size={9} />
                  {t("community.gamesInLibrary")}
                </span>
                <span className="studio-cprof-stat__value">148</span>
              </span>
              <span className="studio-cprof-stat">
                <span className="studio-cprof-stat__label">
                  <Gamepad2 size={9} />
                  {t("community.gamesPlayed")}
                </span>
                <span className="studio-cprof-stat__value studio-cprof-tone--info">96</span>
              </span>
              <span className="studio-cprof-stat">
                <span className="studio-cprof-stat__label">
                  <Trophy size={9} />
                  {t("community.achievements")}
                </span>
                <span className="studio-cprof-stat__value studio-cprof-tone--success">68%</span>
                <span className="studio-cprof-stat__detail">
                  {t("community.unlockedOf", { unlocked: "1,204", total: "1,780" })}
                </span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Profile SubTabs: Overview · Insights · Achievements · Gallery */}
      <div className="studio-page-full">
        {renderCard(
          "communityTabs",
          "slot",
          <div className="studio-cprof-subtabs" aria-hidden="true">
            <span className="studio-cprof-subtab is-active">
              <ChartColumn size={10} />
              <span>{t("profile.tab.overview")}</span>
            </span>
            <span className="studio-cprof-subtab">
              <Sparkles size={10} />
              <span>{t("profile.tab.insights")}</span>
            </span>
            <span className="studio-cprof-subtab">
              <Trophy size={10} />
              <span>{t("profile.tab.achievements")}</span>
              <i className="studio-cprof-subtab__count">1,204</i>
            </span>
            <span className="studio-cprof-subtab">
              <Camera size={10} />
              <span>{t("profile.tab.gallery")}</span>
              <i className="studio-cprof-subtab__count">36</i>
            </span>
          </div>,
        )}
      </div>

      {/* 3. Overview tab: highlights, ranked list, side rail, range hint */}
      <div className="studio-page-full">
        {renderCard(
          "communityContent",
          "slot",
          <div className="studio-cprof-main">
            <section className="studio-cprof-section">
              <div className="studio-cprof-section__head">
                <span className="studio-cprof-section__title">{t("profile.highlights")}</span>
                <span className="studio-cprof-section__meta">{t("profile.highlightsMeta")}</span>
              </div>

              <div className="studio-cprof-highlights">
                <div className="studio-cprof-card studio-cprof-goal">
                  <svg width={44} height={44} viewBox="0 0 44 44" aria-hidden="true">
                    <circle
                      cx={22}
                      cy={22}
                      r={GOAL_RING_RADIUS}
                      fill="none"
                      stroke="var(--color-border)"
                      strokeWidth={4}
                    />
                    <circle
                      cx={22}
                      cy={22}
                      r={GOAL_RING_RADIUS}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth={4}
                      strokeLinecap="round"
                      strokeDasharray={GOAL_RING_CIRCUMFERENCE}
                      strokeDashoffset={GOAL_RING_CIRCUMFERENCE * (1 - GOAL_PCT / 100)}
                      transform="rotate(-90 22 22)"
                    />
                    <text x={22} y={26} textAnchor="middle" className="studio-cprof-goal__pct">
                      {GOAL_PCT}%
                    </text>
                  </svg>
                  <div className="studio-cprof-goal__body">
                    <span className="studio-cprof-card__label">
                      {t("communityExtras.monthlyGoal")}
                    </span>
                    <span className="studio-cprof-card__value">
                      24h<small> / 30h</small>
                    </span>
                    <span className="studio-cprof-card__sub">
                      {t("communityExtras.goalAhead", { time: "2h" })}
                    </span>
                  </div>
                  <span className="studio-cprof-goal__action">{t("communityExtras.setGoal")}</span>
                </div>

                <div className="studio-cprof-card">
                  <span className="studio-cprof-card__label">{t("profile.thisMonth")}</span>
                  <span className="studio-cprof-card__value">
                    42h
                    <span className="studio-cprof-delta">
                      <TrendingUp size={9} />
                      +12%
                    </span>
                  </span>
                  <SchematicSparkline height={16} bars={[30, 45, 25, 60, 40, 70, 55, 80]} />
                  <span className="studio-cprof-card__sub">
                    {t("communityExtras.compareTitle", { this: "42h", last: "37h" })}
                  </span>
                </div>

                <div className="studio-cprof-card">
                  <span className="studio-cprof-card__label">{t("profile.mostPlayed")}</span>
                  <div className="studio-cprof-top-game">
                    <span className="studio-cprof-cover">
                      <Gamepad2 size={12} />
                    </span>
                    <div className="studio-cprof-goal__body">
                      <span className="studio-cprof-card__value studio-cprof-card__value--sm">
                        Elden Ring
                      </span>
                      <span className="studio-cprof-card__sub">
                        142h · {t("gameActivity.sessionCount", { count: 38, s: "s" })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="studio-cprof-card">
                  <span className="studio-cprof-card__label">{t("profile.nextMilestone")}</span>
                  <span className="studio-cprof-milestone__title">
                    <Flag size={10} />
                    {t("stats.milestone.play500h.title")}
                  </span>
                  <Track value={86} height={4} />
                  <span className="studio-cprof-card__sub">428 / 500</span>
                  <span className="studio-cprof-link">
                    {t("profile.openAchievements")} <span aria-hidden="true">→</span>
                  </span>
                </div>
              </div>
            </section>

            <div className="studio-cprof-columns">
              <section className="studio-cprof-section">
                <div className="studio-cprof-section__head">
                  <span className="studio-cprof-section__title">{t("profile.mostPlayed")}</span>
                  <span className="studio-cprof-link">
                    {t("profile.viewAllActivity")} <span aria-hidden="true">→</span>
                  </span>
                </div>

                <div className="studio-cprof-card">
                  <ol className="studio-cprof-ranked__list">
                    {RANKED_GAMES.map((game, index) => (
                      <li
                        key={game.name}
                        className={`studio-cprof-ranked__row${index === 0 ? " is-top" : ""}`}
                      >
                        <span className="studio-cprof-ranked__pos">{index + 1}</span>
                        <span className="studio-cprof-ranked__cover">
                          <Gamepad2 size={11} />
                        </span>
                        <span className="studio-cprof-ranked__info">
                          <span className="studio-cprof-ranked__title">{game.name}</span>
                          <span className="studio-cprof-rank-track" aria-hidden="true">
                            <span style={{ width: `${game.pct}%` }} />
                          </span>
                          <span className="studio-cprof-ranked__meta">
                            {t("gameActivity.sessionCount", {
                              count: game.sessions,
                              s: "s",
                            })}
                          </span>
                        </span>
                        <span className="studio-cprof-ranked__hours">
                          <Clock size={9} /> {game.hours}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>

              <div className="studio-cprof-rail">
                <section className="studio-cprof-card">
                  <div className="studio-cprof-card__head">
                    <span className="studio-cprof-card__title">
                      <Trophy size={10} />
                      {t("profile.recent")}
                    </span>
                    <span className="studio-cprof-link">{t("profile.openAchievements")}</span>
                  </div>
                  <ul className="studio-cprof-feed">
                    {RECENT_UNLOCKS.map((unlock) => (
                      <li key={unlock.title} className="studio-cprof-feed__item">
                        <span className="studio-cprof-feed__icon">
                          <Trophy size={9} />
                        </span>
                        <span className="studio-cprof-feed__body">
                          <span className="studio-cprof-feed__title">{unlock.title}</span>
                          <span className="studio-cprof-feed__meta">{unlock.meta}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="studio-cprof-card">
                  <div className="studio-cprof-card__head">
                    <span className="studio-cprof-card__title">
                      <Camera size={10} />
                      {t("profile.recentCaptures")}
                    </span>
                    <span className="studio-cprof-link">{t("profile.openGallery")}</span>
                  </div>
                  <div className="studio-cprof-captures" aria-hidden="true">
                    {[0, 1, 2, 3].map((index) => (
                      <span key={index} className="studio-cprof-capture" />
                    ))}
                  </div>
                </section>

                <section className="studio-cprof-card">
                  <span className="studio-cprof-card__label">
                    <Flame size={9} /> {t("communityExtras.dayStreak")}
                  </span>
                  <span className="studio-cprof-streak__value">
                    14<small> / {t("communityExtras.longest", { days: 21 })}</small>
                  </span>
                  <span className="studio-cprof-card__sub">{t("profile.playedToday")}</span>
                </section>

                <section className="studio-cprof-card">
                  <span className="studio-cprof-card__label">
                    <Sparkles size={9} /> {t("profile.tab.insights")}
                  </span>
                  <span className="studio-cprof-card__sub">{t("profile.insightsTeaser")}</span>
                  <span className="studio-cprof-link">
                    {t("profile.openInsights")} <span aria-hidden="true">→</span>
                  </span>
                </section>
              </div>
            </div>

            <p className="studio-cprof-hint">
              <Target size={9} />
              {t("profile.rangeAllTimeHint")}
            </p>
          </div>,
        )}
      </div>
    </div>
  );
}
