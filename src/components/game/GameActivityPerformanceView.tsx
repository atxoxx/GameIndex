import { useMemo, useState, type ReactNode } from "react";
import { type GameSession, formatPlayTime } from "../../types/game";
import { formatTemp, toDisplayTemps, tempMinY, tempMaxY, tempThreshold } from "../../utils/temp";
import LineChart from "../charts/LineChart";
import { useLanguage } from "../../context/LanguageContext";
import { useActivity } from "../../context/ActivityContext";
import type { TempUnit } from "../../context/SettingsContext";
import { Badge } from "../ui";
import { SectionPanel, EmptyState, SessionComparisonModal } from "../activity";
import { calculateFpsStability, calculateTelemetryInsights } from "../activity/insights";
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
  const { selectedGpu, totalRamGb } = useActivity();

  const [resolutionFilter, setResolutionFilter] = useState<string>("all");
  const [showCompareModal, setShowCompareModal] = useState(false);

  const selectedSession =
    isolatedSessionIndex !== null ? sessionsWithHw[isolatedSessionIndex] : null;

  const fpsStability = useMemo(() => {
    if (!hwAverages || hwAverages.avgFps <= 0) return null;
    return calculateFpsStability(hwAverages.avgFps, Math.round(hwAverages.avgFps * 0.75));
  }, [hwAverages]);

  const telemetryInsights = useMemo(() => {
    if (selectedSession?.metrics) {
      return calculateTelemetryInsights(selectedSession.metrics);
    }
    if (hwAverages) {
      return calculateTelemetryInsights({
        avgFps: hwAverages.avgFps,
        minFps: Math.round(hwAverages.avgFps * 0.75),
        maxFps: hwAverages.maxFps,
        avgCpuUsage: hwAverages.avgCpu,
        avgGpuUsage: hwAverages.avgGpu,
        avgRamUsage: hwAverages.avgRamPct,
        avgCpuTemp: hwAverages.avgCpuT,
        avgGpuTemp: hwAverages.avgGpuT,
        resolution: "",
        samples: [],
      });
    }
    return null;
  }, [selectedSession, hwAverages]);

  const resolutionsList = useMemo(() => {
    const set = new Set<string>();
    filteredSessions.forEach((s) => {
      if (s.metrics?.resolution) set.add(s.metrics.resolution);
    });
    return Array.from(set);
  }, [filteredSessions]);

  return (
    <div id="game-activity-panel-performance" role="tabpanel" className="act-stack">
      {sessionsWithHw.length > 0 && hwAverages ? (
        <>
          {/* Hardware Context Banner */}
          {selectedGpu && (
            <div className="act-gpu-context-banner">
              <div className="act-gpu-context-info">
                <Icons.Cpu size={14} className="act-gpu-context-icon" />
                <span className="act-gpu-context-text">
                  <strong>{selectedGpu.name}</strong> ({selectedGpu.vendor}) · {selectedGpu.vramMb} MB VRAM
                  {totalRamGb > 0 ? ` · ${totalRamGb} GB System RAM` : ""}
                </span>
              </div>
              <div className="act-gpu-context-actions">
                {sessionsWithHw.length >= 2 && (
                  <button
                    type="button"
                    className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
                    onClick={() => setShowCompareModal(true)}
                  >
                    <Icons.ArrowRightLeft size={12} /> {t("activityCompare.compareBtn")}
                  </button>
                )}
              </div>
            </div>
          )}

          <SectionPanel
            icon={<Icons.Activity size={14} />}
            title={t("gameActivity.perfAveragesTitle")}
            sub={t("gameActivity.sessionCount", {
              count: sessionsWithHw.length,
              s: sessionsWithHw.length > 1 ? "s" : "",
            })}
            tools={
              <div className="act-panel-tools-row">
                {fpsStability && fpsStability.ratio > 0 && (
                  <div className="act-perf-stability-pill">
                    <span className="act-perf-stability-pill__label">{t("activityPerf.columnStability")}:</span>
                    <span
                      className={`performance-stability-badge performance-stability-badge--${fpsStability.rating}`}
                    >
                      {fpsStability.ratio}% ({fpsStability.rating.toUpperCase()})
                    </span>
                  </div>
                )}
                {!selectedGpu && sessionsWithHw.length >= 2 && (
                  <button
                    type="button"
                    className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
                    onClick={() => setShowCompareModal(true)}
                  >
                    <Icons.ArrowRightLeft size={12} /> {t("activityCompare.compareBtn")}
                  </button>
                )}
              </div>
            }
          >
            <div className="act-perf-grid">
              <PerfMiniCard
                label={t("activityPerf.avgFps")}
                avg={`${hwAverages.avgFps}`}
                max={`MAX: ${hwAverages.maxFps}`}
                low={telemetryInsights ? `1% LOW: ${telemetryInsights.onePercentLowFps}` : undefined}
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
                    tone={
                      hwAverages.avgCpuT >= tempThreshold(85, tempUnit)
                        ? "hot"
                        : hwAverages.avgCpuT >= tempThreshold(75, tempUnit)
                          ? "warn"
                          : "good"
                    }
                  />
                  <PerfMiniCard
                    label={t("activityPerf.gpuTemp")}
                    avg={formatTemp(hwAverages.avgGpuT, tempUnit)}
                    max={`MAX: ${formatTemp(hwAverages.maxGpuT, tempUnit)}`}
                    tone={
                      hwAverages.avgGpuT >= tempThreshold(85, tempUnit)
                        ? "hot"
                        : hwAverages.avgGpuT >= tempThreshold(75, tempUnit)
                          ? "warn"
                          : "good"
                    }
                  />
                </>
              )}
            </div>

            {resolutionsList.length > 0 && (
              <div className="act-perf-resolutions-row">
                <span className="act-perf-resolutions-label">{t("activityGantt.resolution")}:</span>
                <div className="act-perf-resolutions-chips">
                  <button
                    type="button"
                    className={`act-perf-res-chip ${resolutionFilter === "all" ? "act-perf-res-chip--active" : ""}`}
                    onClick={() => setResolutionFilter("all")}
                  >
                    {t("activity.sourceAll")}
                  </button>
                  {resolutionsList.map((res) => (
                    <button
                      key={res}
                      type="button"
                      className={`act-perf-res-chip ${resolutionFilter === res ? "act-perf-res-chip--active" : ""}`}
                      onClick={() => setResolutionFilter(res)}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                <div className="act-perf-session-picker-row">
                  <span className="act-perf-session-picker-label">{t("activityPerf.sessionLabel")}:</span>
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
                        {new Date(s.date).toLocaleDateString(language, { day: "numeric", month: "short" })} –{" "}
                        {formatPlayTime(s.durationMin)} {s.metrics?.avgFps ? `(${s.metrics.avgFps} FPS)` : ""}
                        {s.metrics?.resolution ? ` [${s.metrics.resolution}]` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="act-panel__sub">
                  {new Date(sessionsWithHw[0].date).toLocaleDateString(language, {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  – {formatPlayTime(sessionsWithHw[0].durationMin)}
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
                      {
                        data: toDisplayTemps(perfTimelineData.cpuTemp, tempUnit),
                        color: "var(--color-danger)",
                        label: t("activityPerf.cpuTemp"),
                      },
                      {
                        data: toDisplayTemps(perfTimelineData.gpuTemp, tempUnit),
                        color: "var(--color-warning)",
                        label: t("activityPerf.gpuTemp"),
                      },
                    ]}
                    labels={perfTimelineData.labels}
                    height={190}
                    minY={tempMinY(tempUnit)}
                    maxY={tempMaxY(tempUnit)}
                    smooth
                    bands={[
                      {
                        from: tempThreshold(85, tempUnit),
                        to: tempMaxY(tempUnit),
                        color: "var(--color-danger)",
                        opacity: 0.1,
                      },
                    ]}
                    thresholds={[
                      {
                        value: tempThreshold(75, tempUnit),
                        label: t("activityPerf.warmThreshold"),
                        color: "var(--color-warning)",
                      },
                      {
                        value: tempThreshold(85, tempUnit),
                        label: t("activityPerf.hotThreshold"),
                        color: "var(--color-danger)",
                      },
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

          {/* Session Comparison Modal */}
          {showCompareModal && (
            <SessionComparisonModal
              isOpen={showCompareModal}
              onClose={() => setShowCompareModal(false)}
              sessions={sessionsWithHw}
              initialSessionAId={selectedSession?.id}
            />
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
  low,
  tone,
}: {
  label: string;
  avg: string;
  max: string;
  low?: string;
  tone?: "good" | "warn" | "hot";
}) {
  return (
    <div className={`act-perf-card${tone ? ` act-perf-card--${tone}` : ""}`}>
      {tone && <span className="act-perf-card__dot" aria-hidden="true" />}
      <span className="act-perf-card__label">{label}</span>
      <span className="act-perf-card__value">{avg}</span>
      <div className="act-perf-card__footer-metrics">
        <span className="act-perf-card__max">{max}</span>
        {low && <span className="act-perf-card__low">{low}</span>}
      </div>
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
