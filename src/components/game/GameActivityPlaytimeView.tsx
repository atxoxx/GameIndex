import { useState, useMemo } from "react";
import { type GameSession, type Game, formatPlayTime } from "../../types/game";
import BarChart from "../charts/BarChart";
import LineChart from "../charts/LineChart";
import { useLanguage } from "../../context/LanguageContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import type { TempUnit } from "../../context/SettingsContext";
import {
  SectionPanel,
  Segmented,
  StatBand,
  StatCell,
  RecordsStrip,
  Milestones,
  WeeklyHeatmap,
  TimeOfDayDistribution,
  SessionLengthDistribution,
  TimeToBeatProgress,
  buildTimeOfDayDistribution,
  buildSessionLengthDistribution,
  buildCumulativeSeries,
  buildGameCompletionProgress,
  type PeriodComparison,
  type RecordItem,
  type MilestoneLadder,
} from "../activity";
import type { Stats, Timeframe, PlaytimeAggregation, PlaytimeChartStyle } from "./GameActivityShared";
import { GameSessionDetail } from "./GameSessionDetail";
import * as Icons from "../activity/Icons";

interface GameActivityPlaytimeViewProps {
  game: Game;
  stats: Stats;
  playtimeChartData: { data: number[]; labels: string[] };
  filteredSessions: GameSession[];
  sessionsWithHw: GameSession[];
  timeframe: Timeframe;
  playtimeAgg: PlaytimeAggregation;
  onAggChange: (agg: PlaytimeAggregation) => void;
  playtimeChartStyle: PlaytimeChartStyle;
  onStyleChange: (style: PlaytimeChartStyle) => void;
  onRequestDelete: (sessionId: string) => void;
  comparison: PeriodComparison | null;
  records: RecordItem[];
  milestones: MilestoneLadder[];
  hasTemps: boolean;
  tempUnit: TempUnit;
}

export function GameActivityPlaytimeView({
  game,
  stats,
  playtimeChartData,
  filteredSessions,
  sessionsWithHw,
  timeframe,
  playtimeAgg,
  onAggChange,
  playtimeChartStyle,
  onStyleChange,
  onRequestDelete,
  comparison,
  records,
  milestones,
  hasTemps,
  tempUnit,
}: GameActivityPlaytimeViewProps) {
  const { t, language } = useLanguage();
  const { getNote, setNote, setTags } = useSessionNotes();
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<"periodic" | "cumulative">("periodic");

  // Inline Note Editor State for a Session
  const [editingSessionNoteId, setEditingSessionNoteId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tagsList, setTagsList] = useState<string[]>([]);

  const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
  const timeframeLabel =
    timeframe === "all"
      ? t("activity.allTime")
      : t("gameActivity.lastDays", { count: timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90 });
  const sessionCountLabel = t("gameActivity.sessionCount", {
    count: filteredSessions.length,
    s: filteredSessions.length > 1 ? "s" : "",
  });

  const completionProgress = useMemo(() => {
    return buildGameCompletionProgress(stats.totalPlayTimeMin, game.timeToBeat);
  }, [stats.totalPlayTimeMin, game.timeToBeat]);

  const timeOfDayDist = useMemo(() => {
    return buildTimeOfDayDistribution(filteredSessions);
  }, [filteredSessions]);

  const sessionLengthDist = useMemo(() => {
    return buildSessionLengthDistribution(filteredSessions);
  }, [filteredSessions]);

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    const endStr = today.toISOString().slice(0, 10);
    const start = new Date(today);
    start.setDate(today.getDate() - (timeframeDays - 1));
    return { startDate: start.toISOString().slice(0, 10), endDate: endStr };
  }, [timeframeDays]);

  const aggKey = playtimeAgg === "AGG_MONTH" ? "month" : playtimeAgg === "AGG_WEEK" ? "week" : "day";

  const cumulativeSeries = useMemo(() => {
    return buildCumulativeSeries(filteredSessions, startDate, endDate, aggKey, language);
  }, [filteredSessions, startDate, endDate, aggKey, language]);

  const openNoteEditor = (session: GameSession) => {
    const current = getNote(session.id);
    setNoteInput(current.note);
    setTagsList(current.tags);
    setEditingSessionNoteId(session.id);
  };

  const handleSaveNote = (sessionId: string) => {
    setNote(sessionId, noteInput);
    setTags(sessionId, tagsList);
    setEditingSessionNoteId(null);
  };

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent, sessionId: string) => {
    if ("key" in e && e.key !== "Enter") return;
    const clean = tagInput.trim();
    if (clean && !tagsList.includes(clean)) {
      const next = [...tagsList, clean];
      setTagsList(next);
      setTags(sessionId, next);
      setTagInput("");
    }
  };

  return (
    <div id="game-activity-panel-playtime" role="tabpanel" className="act-stack">
      <StatBand>
        <StatCell
          hero
          icon={<Icons.Clock size={15} />}
          label={t("activity.totalPlaytime")}
          value={formatPlayTime(stats.totalPlayTimeMin)}
          sub={timeframeLabel}
          delta={comparison?.playtime}
        />
        <StatCell
          icon={<Icons.Calendar size={15} />}
          label={t("activity.sessions")}
          value={stats.totalSessions}
          sub={t("gameActivity.activeDaysSub", { count: stats.activeDaysCount, s: stats.activeDaysCount === 1 ? "" : "s" })}
          delta={comparison?.sessions}
        />
        <StatCell
          icon={<Icons.Clock size={15} />}
          label={t("activity.avgSession")}
          value={stats.avgSessionMin > 0 ? `${stats.avgSessionMin}m` : "—"}
          sub={t("gameActivity.perSession")}
        />
        <StatCell
          icon={<Icons.Trophy size={15} />}
          label={t("activity.longestSession")}
          value={stats.longestSessionMin > 0 ? formatPlayTime(stats.longestSessionMin) : "—"}
        />
        <StatCell
          icon={<Icons.Zap size={15} />}
          label={t("activity.currentStreak")}
          value={stats.currentStreak > 0 ? `${stats.currentStreak}d` : "—"}
          sub={stats.bestStreak > 0 ? t("gameActivity.bestStreakSub", { days: stats.bestStreak }) : undefined}
        />
      </StatBand>

      {completionProgress.hasTimeToBeat && (
        <SectionPanel
          icon={<Icons.Target size={14} />}
          title={t("gameActivity.ttb.title")}
          sub={t("gameActivity.ttb.subtitle")}
        >
          <TimeToBeatProgress progress={completionProgress} />
        </SectionPanel>
      )}

      <RecordsStrip records={records} />
      <Milestones ladders={milestones} />

      <div className="act-cols">
        <SectionPanel
          icon={<Icons.TrendingUp size={14} />}
          title={t("gameActivity.playtimeTitle")}
          sub={t("gameActivity.playtimeTotal", { total: formatPlayTime(stats.totalPlayTimeMin) })}
          tools={
            <div className="act-panel-tools-row">
              <div className="act-chart-mode-toggle">
                <button
                  type="button"
                  className={`act-chart-mode-btn ${chartMode === "periodic" ? "active" : ""}`}
                  onClick={() => setChartMode("periodic")}
                >
                  {t("activityDash.modePeriodic")}
                </button>
                <button
                  type="button"
                  className={`act-chart-mode-btn ${chartMode === "cumulative" ? "active" : ""}`}
                  onClick={() => setChartMode("cumulative")}
                >
                  {t("activityDash.modeCumulative")}
                </button>
              </div>

              {chartMode === "periodic" && (
                <>
                  <Segmented<PlaytimeAggregation>
                    size="sm"
                    ariaLabel={t("activity.interval")}
                    value={playtimeAgg}
                    onChange={onAggChange}
                    options={[
                      { value: "AGG_DAY", label: t("activity.1d") },
                      { value: "AGG_WEEK", label: t("activity.1w") },
                      { value: "AGG_MONTH", label: t("activity.1m") },
                    ]}
                  />
                  <Segmented<PlaytimeChartStyle>
                    size="sm"
                    ariaLabel={t("activity.barChart")}
                    value={playtimeChartStyle}
                    onChange={onStyleChange}
                    options={[
                      { value: "bar", label: <Icons.BarChart3 size={13} />, title: t("activity.barChart") },
                      { value: "line", label: <Icons.TrendingUp size={13} />, title: t("activity.lineChart") },
                    ]}
                  />
                </>
              )}
            </div>
          }
        >
          {filteredSessions.length > 0 ? (
            chartMode === "cumulative" ? (
              <LineChart
                series={[
                  {
                    data: cumulativeSeries.map((p) => p.cumulativeHours),
                    color: "var(--color-brand-teal)",
                    label: t("activityDash.cumulativeHours"),
                  },
                ]}
                labels={cumulativeSeries.map((p) => p.label)}
                formatValue={(v) => `${v}h`}
                height={240}
                legend={false}
                smooth
              />
            ) : playtimeChartStyle === "bar" ? (
              <BarChart
                data={playtimeChartData.data.map((m) => Math.round((m / 60) * 10) / 10)}
                labels={playtimeChartData.labels}
                formatValue={(v) => `${v}h`}
                height={240}
              />
            ) : (
              <LineChart
                series={[
                  {
                    data: playtimeChartData.data.map((m) => Math.round((m / 60) * 10) / 10),
                    color: "var(--color-accent)",
                    label: t("activity.playtime"),
                  },
                ]}
                labels={playtimeChartData.labels}
                formatValue={(v) => `${v}h`}
                height={240}
                smooth
              />
            )
          ) : (
            <div className="act-empty act-empty--compact">
              <div className="act-empty__icon">
                <Icons.Clock size={18} />
              </div>
              <div className="act-empty__title">{t("activity.noPlaytimeData")}</div>
            </div>
          )}
        </SectionPanel>

        <SectionPanel
          icon={<Icons.CalendarRange size={14} />}
          title={t("gameActivity.weeklyActivity")}
          tools={<span className="act-panel__sub">{timeframeLabel}</span>}
        >
          <WeeklyHeatmap sessions={filteredSessions} timeframeDays={timeframeDays} />
        </SectionPanel>
      </div>

      {/* Routine & Duration Breakdown for this game */}
      <div className="act-cols">
        <SectionPanel
          icon={<Icons.Clock size={14} />}
          title={t("activityInsights.timeOfDayTitle")}
        >
          <TimeOfDayDistribution distribution={timeOfDayDist} compact />
        </SectionPanel>

        <SectionPanel
          icon={<Icons.Target size={14} />}
          title={t("activityInsights.sessionLengthsTitle")}
        >
          <SessionLengthDistribution
            buckets={sessionLengthDist.buckets}
            averageMinutes={sessionLengthDist.averageMinutes}
            longestMinutes={sessionLengthDist.longestMinutes}
            totalSessions={sessionLengthDist.totalSessions}
          />
        </SectionPanel>
      </div>

      <SectionPanel
        icon={<Icons.History size={14} />}
        title={t("activity.recentSessions")}
        sub={sessionsWithHw.length > 0 ? t("gameActivity.sessionsHint") : undefined}
        tools={<span className="act-panel__sub">{sessionCountLabel}</span>}
      >
        <div className="act-session-list">
          {filteredSessions.map((session) => {
            const hasHw = sessionsWithHw.some((s) => s.id === session.id);
            const isExpanded = expandedSessionId === session.id;
            const noteData = getNote(session.id);
            const hasNote = Boolean(noteData.note || noteData.tags.length > 0);

            const formattedDate = new Date(session.date).toLocaleDateString(language, {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
            const startTimeStr = new Date(session.date).toLocaleTimeString(language, {
              hour: "2-digit",
              minute: "2-digit",
            });
            const endTimeStr = new Date(new Date(session.date).getTime() + session.durationMin * 60000).toLocaleTimeString(
              language,
              { hour: "2-digit", minute: "2-digit" },
            );

            return (
              <div
                key={session.id}
                className={`act-session-wrap${isExpanded ? " act-session-wrap--expanded" : ""}`}
              >
                <div
                  className={`act-session${isExpanded ? " act-session--active" : ""} act-session--selectable`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedSessionId(isExpanded ? null : session.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedSessionId(isExpanded ? null : session.id);
                    }
                  }}
                >
                  <div className="act-session__icon">
                    <Icons.Clock size={14} />
                  </div>
                  <div className="act-session__date">
                    <span className="act-session__day">{formattedDate}</span>
                    <span className="act-session__range">
                      {startTimeStr} – {endTimeStr}
                    </span>
                  </div>

                  <div className="act-session__pills">
                    {session.metrics?.avgFps && session.metrics.avgFps > 0 ? (
                      <span className="act-session__pill act-session__pill--fps">
                        {session.metrics.avgFps} FPS
                      </span>
                    ) : null}
                    {hasNote && (
                      <span className="act-session__pill act-session__pill--note" title={noteData.note}>
                        <Icons.FileText size={10} /> {noteData.tags.length > 0 ? `${noteData.tags.length} tags` : "Note"}
                      </span>
                    )}
                  </div>

                  <div className="act-session__duration">
                    <span>{formatPlayTime(session.durationMin)}</span>
                    <span className="act-session__chevron" aria-hidden="true">
                      {isExpanded ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="act-session__delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestDelete(session.id);
                    }}
                    title={t("activity.deleteSessionBtn")}
                    aria-label={t("activity.deleteSessionAria", { name: game.name })}
                  >
                    <Icons.Trash2 size={13} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="act-session-expanded-body">
                    {hasHw ? (
                      <GameSessionDetail
                        session={session}
                        tempUnit={tempUnit}
                        hasTemps={hasTemps}
                      />
                    ) : (
                      <div className="act-empty act-empty--compact">
                        <div className="act-empty__title">{t("activity.noTelemetryCaptured")}</div>
                      </div>
                    )}

                    {/* Inline Session Notes in Game Page Activity Tab */}
                    <div className="act-session-item__notes-box">
                      <div className="act-session-item__notes-head">
                        <span className="act-session-item__notes-title">
                          <Icons.FileText size={13} /> {t("sessionNotes.title")}
                        </span>
                        {editingSessionNoteId !== session.id && (
                          <button
                            type="button"
                            className="act-inspector-btn act-inspector-btn--sm"
                            onClick={() => openNoteEditor(session)}
                          >
                            <Icons.Edit3 size={11} /> {noteData.note ? t("common.edit") : t("sessionNotes.addNote")}
                          </button>
                        )}
                      </div>

                      {editingSessionNoteId === session.id ? (
                        <div className="act-inspector-notes__editor">
                          <textarea
                            className="act-inspector-notes__textarea"
                            rows={2}
                            placeholder={t("sessionNotes.placeholder")}
                            value={noteInput}
                            onChange={(e) => setNoteInput(e.target.value)}
                          />
                          <div className="act-inspector-notes__tags-input-row">
                            <input
                              type="text"
                              className="act-inspector-notes__tag-input"
                              placeholder={t("sessionNotes.tagPlaceholder")}
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => handleAddTag(e, session.id)}
                            />
                            <button
                              type="button"
                              className="act-inspector-btn act-inspector-btn--sm"
                              onClick={(e) => handleAddTag(e, session.id)}
                            >
                              <Icons.Tag size={11} /> {t("sessionNotes.addTag")}
                            </button>
                          </div>
                          <div className="act-inspector-notes__editor-actions">
                            <button
                              type="button"
                              className="act-inspector-btn act-inspector-btn--primary act-inspector-btn--sm"
                              onClick={() => handleSaveNote(session.id)}
                            >
                              <Icons.Check size={12} /> {t("common.save")}
                            </button>
                            <button
                              type="button"
                              className="act-inspector-btn act-inspector-btn--ghost act-inspector-btn--sm"
                              onClick={() => setEditingSessionNoteId(null)}
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="activity-session-item__notes-content">
                          {noteData.note ? (
                            <p className="activity-session-item__notes-text">{noteData.note}</p>
                          ) : (
                            <p className="activity-session-item__notes-empty">{t("sessionNotes.noNotes")}</p>
                          )}
                          {noteData.tags.length > 0 && (
                            <div className="act-inspector-notes__tags">
                              {noteData.tags.map((tag) => (
                                <span key={tag} className="act-inspector-tag">
                                  <Icons.Tag size={10} /> {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionPanel>
    </div>
  );
}
