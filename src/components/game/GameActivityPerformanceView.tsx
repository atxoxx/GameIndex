import type { ReactNode } from "react";
import { type GameSession, formatPlayTime } from "../../types/game";
import { formatTemp, toDisplayTemps, tempMinY, tempMaxY, tempThreshold } from "../../utils/temp";
import LineChart from "../charts/LineChart";
import { useLanguage } from "../../context/LanguageContext";
import type { TempUnit } from "../../context/SettingsContext";
import { Badge } from "../ui";
import { SectionPanel, EmptyState } from "../activity";
import type { HwAverages, PerfTimelineData } from "./GameActivityShared";
import * as Icons from "../activity/Icons";

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
    <div id="game-activity-panel-performance" role="tabpanel" className="act-stack">
      {sessionsWithHw.length > 0 && hwAverages ? (
        <>
          <SectionPanel
            icon={<Icons.Activity size={14} />}
            title={t("gameActivity.perfAveragesTitle")}
            sub={t("gameActivity.sessionCount", { count: sessionsWithHw.length, s: sessionsWithHw.length > 1 ? "s" : "" })}
          >
            <div className="act-perf-grid">
              <PerfMiniCard
                label={t("activityPerf.avgFps")}
                avg={`${hwAverages.avgFps}`}
                max={`MAX: ${hwAverages.maxFps}`}
                tone={hwAverages.avgFps >= 60 ? "good" : "warn"}
              />
              <PerfMiniCard
                label={t("activityPerf.cpuUsage")}
                avg={`${hwAverages.avgCpu}%`}
                max={`MAX: ${hwAverages.maxCpu}%`}
                tone={hwAverages.avgCpu >= 90 ? "hot" : hwAverages.avgCpu >= 70 ? "warn" : "good"}
              />
              <PerfMiniCard
                label={t("activityPerf.gpuUsage")}
                avg={`${hwAverages.avgGpu}%`}
                max={`MAX: ${hwAverages.maxGpu}%`}
                tone={hwAverages.avgGpu >= 90 ? "hot" : hwAverages.avgGpu >= 70 ? "warn" : "good"}
              />
              <PerfMiniCard
                label={t("activityPerf.ramUsage")}
                avg={`${hwAverages.avgRamPct}%`}
                max={`MAX: ${hwAverages.maxRamPct}%`}
                tone={hwAverages.avgRamPct >= 90 ? "hot" : hwAverages.avgRamPct >= 70 ? "warn" : "good"}
              />
              {hasTemps && (
                <>
                  <PerfMiniCard
                    label={t("activityPerf.cpuTemp")}
                    avg={formatTemp(hwAverages.avgCpuT, tempUnit)}
                    max={`MAX: ${formatTemp(hwAverages.maxCpuT, tempUnit)}`}
                    tone={hwAverages.avgCpuT >= tempThreshold(85, tempUnit) ? "hot" : hwAverages.avgCpuT >= tempThreshold(75, tempUnit) ? "warn" : "good"}
                  />
                  <PerfMiniCard
                    label={t("activityPerf.gpuTemp")}
                    avg={formatTemp(hwAverages.avgGpuT, tempUnit)}
                    max={`MAX: ${formatTemp(hwAverages.maxGpuT, tempUnit)}`}
                    tone={hwAverages.avgGpuT >= tempThreshold(85, tempUnit) ? "hot" : hwAverages.avgGpuT >= tempThreshold(75, tempUnit) ? "warn" : "good"}
                  />
                </>
              )}
            </div>
          </SectionPanel>

          {perfTimelineData && (
            <SectionPanel
              icon={<Icons.BarChart3 size={14} />}
              title={t("activity.sessionTelemetry")}
              sub={perfTimelineData.real ? t("gameActivity.curveReal") : t("gameActivity.curveEstimated")}
              tools={
                perfTimelineData.real ? (
                  <Badge variant="success">{t("gameActivity.liveData")}</Badge>
                ) : (
                  <Badge variant="warning">{t("gameActivity.estimatedData")}</Badge>
                )
              }
            >
              {sessionsWithHw.length > 1 ? (
                <select
                  className="act-toolbar__select"
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
                <span className="act-panel__sub">
                  {new Date(sessionsWithHw[0].date).toLocaleDateString(language, { day: "numeric", month: "short" })} - {formatPlayTime(sessionsWithHw[0].durationMin)}
                </span>
              )}
            </SectionPanel>
          )}

          {perfTimelineData && (
            <div className="act-cols">
              <ChartPanel icon={<Icons.Cpu size={14} />} title={t("gameActivity.chartCpuGpu")}>
                <LineChart
                  series={[
                    { data: perfTimelineData.cpu, color: "var(--color-brand-blue)", label: t("activityPerf.cpuUsage") },
                    { data: perfTimelineData.gpu, color: "var(--color-accent)", label: t("activityPerf.gpuUsage") },
                  ]}
                  labels={perfTimelineData.labels}
                  height={190}
                  minY={0}
                  maxY={100}
                  smooth
                  thresholds={[{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }]}
                  formatValue={(v) => `${Math.round(v)}%`}
                />
              </ChartPanel>

              {hasTemps && (
                <ChartPanel icon={<Icons.Thermometer size={14} />} title={t("gameActivity.chartTemps")}>
                  <LineChart
                    series={[
                      { data: toDisplayTemps(perfTimelineData.cpuTemp, tempUnit), color: "var(--color-danger)", label: t("activityPerf.cpuTemp") },
                      { data: toDisplayTemps(perfTimelineData.gpuTemp, tempUnit), color: "var(--color-warning)", label: t("activityPerf.gpuTemp") },
                    ]}
                    labels={perfTimelineData.labels}
                    height={190}
                    minY={tempMinY(tempUnit)}
                    maxY={tempMaxY(tempUnit)}
                    smooth
                    bands={[{ from: tempThreshold(85, tempUnit), to: tempMaxY(tempUnit), color: "var(--color-danger)", opacity: 0.1 }]}
                    thresholds={[
                      { value: tempThreshold(75, tempUnit), label: t("activityPerf.warmThreshold"), color: "var(--color-warning)" },
                      { value: tempThreshold(85, tempUnit), label: t("activityPerf.hotThreshold"), color: "var(--color-danger)" },
                    ]}
                    formatValue={(v) => formatTemp(v, tempUnit)}
                  />
                </ChartPanel>
              )}

              <ChartPanel icon={<Icons.MemoryStick size={14} />} title={t("gameActivity.chartRam")}>
                <LineChart
                  series={[{ data: perfTimelineData.ram, color: "var(--color-success)", label: t("activityPerf.ramUsage") }]}
                  labels={perfTimelineData.labels}
                  height={190}
                  minY={0}
                  maxY={100}
                  smooth
                  thresholds={[{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }]}
                  formatValue={(v) => `${Math.round(v)}%`}
                />
              </ChartPanel>

              <ChartPanel icon={<Icons.Gauge size={14} />} title={t("gameActivity.chartFps")}>
                <LineChart
                  series={[{ data: perfTimelineData.fps, color: "var(--color-brand-teal)", label: t("activityPerf.fps") }]}
                  labels={perfTimelineData.labels}
                  height={190}
                  minY={0}
                  niceMax
                  smooth
                  thresholds={[{ value: 60, label: t("activityPerf.threshold60fps"), color: "var(--color-success)" }]}
                  formatValue={(v) => `${Math.round(v)} FPS`}
                />
              </ChartPanel>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Icons.Cpu size={24} />}
          title={filteredSessions.length > 0 ? t("gameActivity.noPerfTitle") : t("gameActivity.noSessionsTitle")}
          hint={
            filteredSessions.length > 0
              ? `${t("activity.sessionCount", { count: filteredSessions.length, s: filteredSessions.length > 1 ? "s" : "" })} ${t("gameActivity.noPerformanceHint")}`
              : t("gameActivity.noPerformance")
          }
        />
      )}
    </div>
  );
}

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
    <div className={`act-perf-card${tone ? ` act-perf-card--${tone}` : ""}`}>
      {tone && <span className="act-perf-card__dot" aria-hidden="true" />}
      <span className="act-perf-card__label">{label}</span>
      <span className="act-perf-card__value">{avg}</span>
      <span className="act-perf-card__max">{max}</span>
    </div>
  );
}

function ChartPanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <SectionPanel icon={icon} title={title}>
      {children}
    </SectionPanel>
  );
}
