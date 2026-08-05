import { useMemo, useState, type ReactNode } from "react";
import LineChart from "../../../components/charts/LineChart";
import { ActivitySparkline } from "../ActivitySparkline";
import { buildTimelineBundle, TIMELINE_COLORS, type GamePerfAvg } from "./perfData";
import { useLanguage } from "../../../context/LanguageContext";
import type { TempUnit } from "../../../context/SettingsContext";
import { formatTemp, toDisplayTemp, toDisplayTemps, tempMinY, tempMaxY, tempUnitLabel, tempThreshold } from "../../../utils/temp";
import * as Icons from "../Icons";
import type { GameSession } from "../../../types/game";

const PTS = 45;

export function PerformanceTimeline({
  sessions,
  gameAverages,
  tempUnit,
  totalRamGb,
}: {
  sessions: GameSession[];
  gameAverages: GamePerfAvg[];
  tempUnit: TempUnit;
  totalRamGb: number;
}) {
  const { t } = useLanguage();
  const [selectedGameFilter, setSelectedGameFilter] = useState<string>("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");

  const gameSelectorList = useMemo(
    () => gameAverages.map((g) => ({ id: g.gameId, title: g.gameTitle })),
    [gameAverages]
  );

  const sessionsForSelectedGame = useMemo(() => {
    if (selectedGameFilter === "all") return [];
    return sessions.filter((s) => s.gameId === selectedGameFilter);
  }, [sessions, selectedGameFilter]);

  const i18n = useMemo(
    () => ({
      cpuUsage: t("activityPerf.cpuUsage"),
      gpuUsage: t("activityPerf.gpuUsage"),
      cpuTemp: t("activityPerf.cpuTemp"),
      gpuTemp: t("activityPerf.gpuTemp"),
      ramUsage: t("activityPerf.ramUsage"),
      fps: t("activityPerf.fps"),
    }),
    [t]
  );

  const bundle = useMemo(
    () =>
      buildTimelineBundle({
        sessions,
        gameAverages,
        gameId: selectedGameFilter,
        sessionId: selectedSessionId === "all" ? null : selectedSessionId,
        i18n,
        pts: PTS,
      }),
    [sessions, gameAverages, selectedGameFilter, selectedSessionId, i18n]
  );

  return (
    <div className="section-panel">
      <div className="performance-timeline">
        <div className="performance-timeline__header">
          <h3 className="performance-timeline__title">
            <Icons.History size={14} />
            {t("activityPerf.sessionTimeline")}
            {bundle && (
              <span
                className={`performance-timeline__badge ${
                  bundle.estimated ? "performance-timeline__badge--estimated" : "performance-timeline__badge--live"
                }`}
                title={bundle.estimated ? t("activityPerf.telemetryCurve") : undefined}
              >
                {bundle.estimated ? t("activityPerf.estimated") : t("activityPerf.liveTelemetry")}
              </span>
            )}
          </h3>

          <div className="performance-timeline__controls">
            <div className="performance-timeline__game-selector">
              <span className="performance-timeline__game-selector-label">{t("activityPerf.gameLabel")}</span>
              <select
                className="performance-timeline__game-select"
                value={selectedGameFilter}
                onChange={(e) => {
                  setSelectedGameFilter(e.target.value);
                  setSelectedSessionId("all");
                }}
              >
                <option value="all">{t("activityPerf.allGames")}</option>
                {gameSelectorList.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>

            {selectedGameFilter !== "all" && sessionsForSelectedGame.length > 1 && (
              <div className="performance-timeline__session-selector">
                <span className="performance-timeline__session-selector-label">{t("activityPerf.sessionLabel")}</span>
                <select
                  className="performance-timeline__session-select"
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                >
                  <option value="all">{t("activityPerf.allSessionsAvg")}</option>
                  {sessionsForSelectedGame.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {!bundle ? (
          <div className="activity-empty activity-empty--compact">
            <div className="activity-empty__icon">
              <Icons.Cpu size={18} />
            </div>
            <div className="activity-empty__title">{t("activityPerf.noTimelineData")}</div>
          </div>
        ) : (
          <>
            {/* Stat cards: avg value + real curve min/max readouts */}
            <div className="performance-stat-cards">
              <StatCard
                label={t("activityPerf.cpuUsage")}
                unit="%"
                color={TIMELINE_COLORS.cpu}
                icon={<Icons.Cpu size={12} />}
                data={bundle.sparklines.cpu}
                value={bundle.raw.avgCpuUsage}
                max={bundle.readouts.cpu.max}
                min={bundle.readouts.cpu.min}
              />
              <StatCard
                label={t("activityPerf.gpuUsage")}
                unit="%"
                color={TIMELINE_COLORS.gpu}
                icon={<Icons.Activity size={12} />}
                data={bundle.sparklines.gpu}
                value={bundle.raw.avgGpuUsage}
                max={bundle.readouts.gpu.max}
                min={bundle.readouts.gpu.min}
              />
              <StatCard
                label={t("activityPerf.cpuTemp")}
                unit={tempUnitLabel(tempUnit)}
                color={TIMELINE_COLORS.cpuTemp}
                icon={<Icons.Thermometer size={12} />}
                data={bundle.sparklines.cpuTemp.map((p) => ({ ...p, y: toDisplayTemp(p.y, tempUnit) }))}
                value={toDisplayTemp(bundle.raw.avgCpuTemp, tempUnit)}
                max={toDisplayTemp(bundle.readouts.cpuTemp.max, tempUnit)}
                min={toDisplayTemp(bundle.readouts.cpuTemp.min, tempUnit)}
                thresholds={{
                  warn: tempThreshold(75, tempUnit),
                  danger: tempThreshold(85, tempUnit),
                }}
              />
              <StatCard
                label={t("activityPerf.gpuTemp")}
                unit={tempUnitLabel(tempUnit)}
                color={TIMELINE_COLORS.gpuTemp}
                icon={<Icons.Flame size={12} />}
                data={bundle.sparklines.gpuTemp.map((p) => ({ ...p, y: toDisplayTemp(p.y, tempUnit) }))}
                value={toDisplayTemp(bundle.raw.avgGpuTemp, tempUnit)}
                max={toDisplayTemp(bundle.readouts.gpuTemp.max, tempUnit)}
                min={toDisplayTemp(bundle.readouts.gpuTemp.min, tempUnit)}
                thresholds={{
                  warn: tempThreshold(75, tempUnit),
                  danger: tempThreshold(85, tempUnit),
                }}
              />
              <StatCard
                label={t("activityPerf.ramUsage")}
                unit="%"
                color={TIMELINE_COLORS.ram}
                icon={<Icons.MemoryStick size={12} />}
                data={bundle.sparklines.ram}
                value={bundle.raw.avgRamUsage}
                max={bundle.readouts.ram.max}
                min={bundle.readouts.ram.min}
              />
              <StatCard
                label={t("activityPerf.avgFps")}
                unit=""
                color={TIMELINE_COLORS.fps}
                icon={<Icons.Gauge size={12} />}
                data={bundle.sparklines.fps}
                value={bundle.raw.avgFps}
                max={bundle.readouts.fps.max}
                min={bundle.readouts.fps.min}
              />
            </div>

            {/* Trend charts */}
            <div className="performance-timeline__charts">
              <div className="performance-timeline__chart-card">
                <div className="performance-timeline__chart-title">
                  <Icons.Cpu size={12} />
                  {t("activityPerf.chartCpuGpuUsage")}
                </div>
                <LineChart
                  series={bundle.cpuGpu}
                  labels={bundle.labels}
                  formatValue={(v) => `${Math.round(v)}%`}
                  height={200}
                  minY={0}
                  maxY={100}
                  smooth
                  thresholds={[{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }]}
                />
              </div>

              <div className="performance-timeline__chart-card">
                <div className="performance-timeline__chart-title">
                  <Icons.Thermometer size={12} />
                  {t("activityPerf.temperatures")}
                </div>
                <LineChart
                  series={bundle.temps.map((s) => ({
                    ...s,
                    data: toDisplayTemps(s.data, tempUnit),
                  }))}
                  labels={bundle.labels}
                  formatValue={(v) => formatTemp(v, tempUnit)}
                  height={200}
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
                    { value: tempThreshold(75, tempUnit), label: t("activityPerf.warmThreshold"), color: "var(--color-warning)" },
                    { value: tempThreshold(85, tempUnit), label: t("activityPerf.hotThreshold"), color: "var(--color-danger)" },
                  ]}
                />
              </div>

              <div className="performance-timeline__chart-card">
                <div className="performance-timeline__chart-title">
                  <Icons.MemoryStick size={12} />
                  {t("activityPerf.ramUsage")}
                </div>
                <LineChart
                  series={bundle.ram}
                  labels={bundle.labels}
                  formatValue={(v) => `${Math.round(v)}%`}
                  formatTooltipValue={(v) => {
                    const totalRam = totalRamGb || 16;
                    if (v > 100) {
                      const gb = (totalRam * v) / 100;
                      return (
                        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.1, gap: 2 }}>
                          <span>{`${Math.round(v)}%`}</span>
                          <span style={{ fontSize: "0.78em", opacity: 0.7, fontWeight: 500, whiteSpace: "nowrap" }}>
                            {`${gb.toFixed(1)} GB`}
                          </span>
                        </span>
                      );
                    }
                    return `${Math.round(v)}%`;
                  }}
                  height={200}
                  minY={0}
                  maxY={100}
                  smooth
                  thresholds={[{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }]}
                />
              </div>

              <div className="performance-timeline__chart-card">
                <div className="performance-timeline__chart-title">
                  <Icons.Gauge size={12} />
                  {t("activityPerf.fps")}
                </div>
                <LineChart
                  series={bundle.fps}
                  labels={bundle.labels}
                  formatValue={(v) => `${Math.round(v)} FPS`}
                  height={200}
                  minY={0}
                  niceMax
                  smooth
                  thresholds={[{ value: 60, label: t("activityPerf.threshold60fps"), color: "var(--color-success)" }]}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  unit,
  color,
  icon,
  data,
  value,
  max,
  min,
  thresholds,
}: {
  label: string;
  unit: string;
  color: string;
  icon: ReactNode;
  data: { x: number; y: number }[];
  value: number;
  max: number;
  min: number;
  thresholds?: { warn: number; danger: number };
}) {
  return (
    <div className="performance-stat-cards__card">
      <div className="performance-stat-cards__label-row">
        <span className="performance-stat-cards__dot" style={{ background: color }} />
        <span className="performance-stat-cards__label">{label}</span>
        <span className="performance-stat-cards__icon" style={{ color }}>
          {icon}
        </span>
      </div>
      <div className="performance-stat-cards__sparkline">
        <ActivitySparkline
          data={data}
          label=""
          unit={unit}
          value={value}
          max={max}
          min={min}
          thresholds={thresholds}
        />
      </div>
    </div>
  );
}
