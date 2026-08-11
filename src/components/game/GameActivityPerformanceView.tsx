import type { ReactNode } from "react";
import { type GameSession, formatPlayTime } from "../../types/game";
import { formatTemp, toDisplayTemps, tempMinY, tempMaxY, tempThreshold } from "../../utils/temp";
import LineChart from "../charts/LineChart";
import { useLanguage } from "../../context/LanguageContext";
import type { TempUnit } from "../../context/SettingsContext";
import { SectionHead } from "./GameActivityShared";
import type { HwAverages, PerfTimelineData } from "./GameActivityShared";

interface GameActivityPerformanceViewProps {
  filteredSessions: GameSession[];
  sessionsWithHw: GameSession[];
  hasTemps: boolean;
  hwAverages: HwAverages | null;
  perfTimelineData: PerfTimelineData | null;
  isolatedSessionIndex: number | null;
  setIsolatedSessionIndex: (index: number | null) => void;
  tempUnit: TempUnit;
}

/**
 * The "Performance" sub-view: a framed identity header, the average /
 * peak hardware cards, the session telemetry picker, then the stacked
 * CPU/GPU, temperature, RAM and FPS curves.
 */
export function GameActivityPerformanceView({
  filteredSessions,
  sessionsWithHw,
  hasTemps,
  hwAverages,
  perfTimelineData,
  isolatedSessionIndex,
  setIsolatedSessionIndex,
  tempUnit,
}: GameActivityPerformanceViewProps) {
  const { t, language } = useLanguage();

  return (
    <div
      id="game-activity-panel-performance"
      className="game-activity-view game-activity-view--performance"
      role="tabpanel"
      aria-labelledby="game-activity-tab-performance"
    >
      {/* View identity header — always tells you which sub-tab you're in */}
      <div className="game-activity-view-head">
        <span className="game-activity-view-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="1" y1="9" x2="4" y2="9" />
          </svg>
        </span>
        <div className="game-activity-view-titles">
          <h2 className="game-activity-view-title">{t("activity.performance")}</h2>
          <p className="game-activity-view-sub">{t("gameActivity.performanceSubtitle")}</p>
        </div>
      </div>

      {sessionsWithHw.length > 0 && hwAverages ? (
        <>
          {/* Performance averages */}
          <section className="game-activity-section">
            <SectionHead
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              }
              title={t("gameActivity.perfAveragesTitle")}
              sub={t("gameActivity.sessionCount", { count: sessionsWithHw.length, s: sessionsWithHw.length > 1 ? "s" : "" })}
            />
            <div className="game-activity-perf-cards">
              <PerfMiniCard label={t("activityPerf.avgFps")} avg={`${hwAverages.avgFps}`} max={`MAX: ${hwAverages.maxFps}`} tone={hwAverages.avgFps >= 60 ? "good" : "warn"} />
              <PerfMiniCard label={t("activityPerf.cpuUsage")} avg={`${hwAverages.avgCpu}%`} max={`MAX: ${hwAverages.maxCpu}%`} tone={hwAverages.avgCpu >= 90 ? "hot" : hwAverages.avgCpu >= 70 ? "warn" : "good"} />
              <PerfMiniCard label={t("activityPerf.gpuUsage")} avg={`${hwAverages.avgGpu}%`} max={`MAX: ${hwAverages.maxGpu}%`} tone={hwAverages.avgGpu >= 90 ? "hot" : hwAverages.avgGpu >= 70 ? "warn" : "good"} />
              <PerfMiniCard label={t("activityPerf.ramUsage")} avg={`${hwAverages.avgRamPct}%`} max={`MAX: ${hwAverages.maxRamPct}%`} tone={hwAverages.avgRamPct >= 90 ? "hot" : hwAverages.avgRamPct >= 70 ? "warn" : "good"} />
              {hasTemps && (
                <>
                  <PerfMiniCard label={t("activityPerf.cpuTemp")} avg={formatTemp(hwAverages.avgCpuT, tempUnit)} max={`MAX: ${formatTemp(hwAverages.maxCpuT, tempUnit)}`} tone={hwAverages.avgCpuT >= tempThreshold(85, tempUnit) ? "hot" : hwAverages.avgCpuT >= tempThreshold(75, tempUnit) ? "warn" : "good"} />
                  <PerfMiniCard label={t("activityPerf.gpuTemp")} avg={formatTemp(hwAverages.avgGpuT, tempUnit)} max={`MAX: ${formatTemp(hwAverages.maxGpuT, tempUnit)}`} tone={hwAverages.avgGpuT >= tempThreshold(85, tempUnit) ? "hot" : hwAverages.avgGpuT >= tempThreshold(75, tempUnit) ? "warn" : "good"} />
                </>
              )}
            </div>
          </section>

          {/* Session telemetry picker + curve source */}
          {perfTimelineData && (
            <section className="game-activity-section">
              <SectionHead
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                    <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                    <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                  </svg>
                }
                title={t("activity.sessionTelemetry")}
                sub={perfTimelineData.real ? t("gameActivity.curveReal") : t("gameActivity.curveEstimated")}
                tools={
                  <span className={`game-activity-curve-badge${perfTimelineData.real ? " game-activity-curve-badge--live" : ""}`}>
                    {perfTimelineData.real ? t("gameActivity.liveData") : t("gameActivity.estimatedData")}
                  </span>
                }
              />
              <div className="game-activity-perf-toolbar">
                {sessionsWithHw.length > 1 ? (
                  <select
                    className="game-activity-select"
                    aria-label={t("activity.sessionTelemetry")}
                    value={isolatedSessionIndex !== null ? String(isolatedSessionIndex) : "all"}
                    onChange={(e) => {
                      const val = e.target.value;
                      setIsolatedSessionIndex(val === "all" ? null : Number(val));
                    }}
                  >
                    <option value="all">{t("activityPerf.allSessionsAvg")}</option>
                    {sessionsWithHw.map((s, i) => (
                      <option key={s.id} value={String(i)}>
                        {new Date(s.date).toLocaleDateString(language, { day: "numeric", month: "short" })} - {formatPlayTime(s.durationMin)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="game-activity-perf-toolbar-note">
                    {new Date(sessionsWithHw[0].date).toLocaleDateString(language, { day: "numeric", month: "short" })} - {formatPlayTime(sessionsWithHw[0].durationMin)}
                  </span>
                )}
              </div>
            </section>
          )}

          {/* Stacked Charts */}
          {perfTimelineData && (
            <div className="game-activity-stacked-charts">
              <ChartSection
                title={t("gameActivity.chartCpuGpu")}
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="1" y1="9" x2="4" y2="9" />
                  </svg>
                }
              >
                <LineChart
                  series={[
                    { data: perfTimelineData.cpu, color: "#3e62c0", label: t("activityPerf.cpuUsage") },
                    { data: perfTimelineData.gpu, color: "#9b59b6", label: t("activityPerf.gpuUsage") },
                  ]}
                  labels={perfTimelineData.labels}
                  height={180}
                  minY={0}
                  maxY={100}
                  smooth
                  thresholds={[{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }]}
                  formatValue={(v) => `${Math.round(v)}%`}
                />
              </ChartSection>

              {hasTemps && (
                <ChartSection
                  title={t("gameActivity.chartTemps")}
                  icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
                    </svg>
                  }
                >
                  <LineChart
                    series={[
                      { data: toDisplayTemps(perfTimelineData.cpuTemp, tempUnit), color: "#ffab00", label: t("activityPerf.cpuTemp") },
                      { data: toDisplayTemps(perfTimelineData.gpuTemp, tempUnit), color: "#ff5252", label: t("activityPerf.gpuTemp") },
                    ]}
                    labels={perfTimelineData.labels}
                    height={180}
                    minY={tempMinY(tempUnit)}
                    maxY={tempMaxY(tempUnit)}
                    smooth
                    bands={[
                      { from: tempThreshold(85, tempUnit), to: tempMaxY(tempUnit), color: "var(--color-danger)", opacity: 0.1 },
                    ]}
                    thresholds={[
                      { value: tempThreshold(75, tempUnit), label: t("activityPerf.warmThreshold"), color: "var(--color-warning)" },
                      { value: tempThreshold(85, tempUnit), label: t("activityPerf.hotThreshold"), color: "var(--color-danger)" },
                    ]}
                    formatValue={(v) => formatTemp(v, tempUnit)}
                  />
                </ChartSection>
              )}

              <ChartSection
                title={t("gameActivity.chartRam")}
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="9" y1="22" x2="9" y2="18" /><line x1="15" y1="22" x2="15" y2="18" /><line x1="8" y1="6" x2="8" y2="14" /><line x1="12" y1="6" x2="12" y2="14" /><line x1="16" y1="6" x2="16" y2="14" />
                  </svg>
                }
              >
                <LineChart
                  series={[
                    { data: perfTimelineData.ram, color: "#2ecc71", label: t("activityPerf.ramUsage") }
                  ]}
                  labels={perfTimelineData.labels}
                  height={180}
                  minY={0}
                  maxY={100}
                  smooth
                  thresholds={[{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }]}
                  formatValue={(v) => `${v}%`}
                />
              </ChartSection>

              <ChartSection
                title={t("gameActivity.chartFps")}
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                }
              >
                <LineChart
                  series={[
                    { data: perfTimelineData.fps, color: "#16b195", label: t("activityPerf.fps") }
                  ]}
                  labels={perfTimelineData.labels}
                  height={180}
                  minY={0}
                  niceMax
                  smooth
                  thresholds={[{ value: 60, label: t("activityPerf.threshold60fps"), color: "var(--color-success)" }]}
                  formatValue={(v) => `${Math.round(v)} FPS`}
                />
              </ChartSection>
            </div>
          )}
        </>
      ) : (
        <div className="game-activity-empty-state">
          <span className="game-activity-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </span>
          <h3 className="game-activity-empty-title">
            {filteredSessions.length > 0 ? t("gameActivity.noPerfTitle") : t("gameActivity.noSessionsTitle")}
          </h3>
          <p className="game-activity-empty-sub">
            {filteredSessions.length > 0
              ? `${t("activity.sessionCount", { count: filteredSessions.length, s: filteredSessions.length > 1 ? "s" : "" })} ${t("gameActivity.noPerformanceHint")}`
              : t("gameActivity.noPerformance")}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Performance Mini Card Helper ─────────────────────────────────────────────
// `tone` surfaces a small status dot (good / warn / hot) derived from the
// metric's value at the call site — purely visual, no behavior change.
function PerfMiniCard({
  label,
  avg,
  max,
  tone,
}: {
  label: string;
  avg: string;
  max: string;
  tone?: "good" | "warn" | "hot";
}) {
  return (
    <div className={`game-activity-perf-card${tone ? ` game-activity-perf-card--${tone}` : ""}`}>
      <span className="game-activity-perf-label">{label}</span>
      <div className="game-activity-perf-values">
        <span className="game-activity-perf-avg">{avg}</span>
        <span className="game-activity-perf-max">{max}</span>
      </div>
      {tone && <span className="game-activity-perf-dot" aria-hidden="true" />}
    </div>
  );
}

// ─── Chart Section Helper ─────────────────────────────────────────────────────
function ChartSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="game-activity-chart-section">
      <SectionHead icon={icon} title={title} />
      <div className="game-activity-chart-box">{children}</div>
    </section>
  );
}
