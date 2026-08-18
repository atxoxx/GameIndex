import { useMemo, type ReactNode } from "react";
import type { GameSession } from "../../types/game";
import { formatTemp, toDisplayTemps, tempMinY, tempMaxY, tempUnitLabel } from "../../utils/temp";
import { buildSingleSessionSeries } from "../../utils/perfSamples";
import { generateConsistentSeries } from "./GameActivityShared";
import LineChart from "../charts/LineChart";
import { useLanguage } from "../../context/LanguageContext";
import type { TempUnit } from "../../context/SettingsContext";
import * as Icons from "../activity/Icons";

const PTS = 45;

function buildLabels(durationMin: number): string[] {
  const labels: string[] = [];
  for (let i = 0; i < PTS; i++) {
    const elapsedSec = Math.round((i / (PTS - 1)) * durationMin * 60);
    labels.push(`${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`);
  }
  return labels;
}

export function GameSessionDetail({
  session,
  tempUnit,
  hasTemps,
}: {
  session: GameSession;
  tempUnit: TempUnit;
  hasTemps: boolean;
}) {
  const { t } = useLanguage();
  const m = session.metrics;
  if (!m) return null;

  const { labels, cpu, gpu, ram, cpuTemp, gpuTemp, fps, real } = useMemo(() => {
    const labels = buildLabels(session.durationMin);
    const realSeries = buildSingleSessionSeries(m, PTS);
    if (realSeries) {
      return {
        labels,
        cpu: realSeries.cpu,
        gpu: realSeries.gpu,
        ram: realSeries.ram,
        cpuTemp: realSeries.cpuTemp,
        gpuTemp: realSeries.gpuTemp,
        fps: realSeries.fps,
        real: true,
      };
    }
    const seed = session.id;
    return {
      labels,
      cpu: generateConsistentSeries(m.avgCpuUsage, Math.max(0, m.avgCpuUsage - 15), Math.min(100, m.avgCpuUsage + 20), PTS, `${seed}-cpu`),
      gpu: generateConsistentSeries(m.avgGpuUsage, Math.max(0, m.avgGpuUsage - 10), Math.min(100, m.avgGpuUsage + 15), PTS, `${seed}-gpu`),
      ram: generateConsistentSeries(m.avgRamUsage, Math.max(0, m.avgRamUsage - 5), Math.min(100, m.avgRamUsage + 5), PTS, `${seed}-ram`),
      cpuTemp: m.avgCpuTemp > 0 ? generateConsistentSeries(m.avgCpuTemp, Math.max(35, m.avgCpuTemp - 8), Math.min(100, m.avgCpuTemp + 10), PTS, `${seed}-cputemp`) : [],
      gpuTemp: m.avgGpuTemp > 0 ? generateConsistentSeries(m.avgGpuTemp, Math.max(35, m.avgGpuTemp - 6), Math.min(100, m.avgGpuTemp + 8), PTS, `${seed}-gputemp`) : [],
      fps: m.avgFps > 0 ? generateConsistentSeries(m.avgFps, m.minFps, m.maxFps, PTS, `${seed}-fps`) : new Array(PTS).fill(0),
      real: false,
    };
  }, [session.id, session.durationMin, m]);

  const hasFps = Math.max(...fps) > 0;
  const tempSeries: { data: number[]; color: string; label: string }[] = [];
  if (hasTemps && Math.max(...cpuTemp) > 0) {
    tempSeries.push({ data: toDisplayTemps(cpuTemp, tempUnit), color: "var(--color-danger)", label: t("activityPerf.cpuTemp") });
  }
  if (hasTemps && Math.max(...gpuTemp) > 0) {
    tempSeries.push({ data: toDisplayTemps(gpuTemp, tempUnit), color: "var(--color-warning)", label: t("activityPerf.gpuTemp") });
  }
  const hasTempData = tempSeries.length > 0;

  return (
    <div className="act-session-detail">
      <div className="act-session-detail__stats">
        {hasFps && (
          <Chip
            label={t("activityPerf.avgFps")}
            value={String(m.avgFps)}
            sub={`${m.minFps}–${m.maxFps}`}
          />
        )}
        <Chip label={t("activityPerf.cpuUsage")} value={`${m.avgCpuUsage}%`} />
        <Chip label={t("activityPerf.gpuUsage")} value={`${m.avgGpuUsage}%`} />
        <Chip label={t("activityPerf.ramUsage")} value={`${m.avgRamUsage}%`} />
        {hasTemps && m.avgCpuTemp > 0 && (
          <Chip label={t("activityPerf.cpuTemp")} value={formatTemp(m.avgCpuTemp, tempUnit)} />
        )}
        {hasTemps && m.avgGpuTemp > 0 && (
          <Chip label={t("activityPerf.gpuTemp")} value={formatTemp(m.avgGpuTemp, tempUnit)} />
        )}
        {m.resolution && <Chip label={t("activityGantt.resolution")} value={m.resolution} />}
      </div>

      <div className="act-session-detail__charts">
        <Chart title={t("activityPerf.fps")} icon={<Icons.Gauge size={13} />} badge={real ? undefined : t("activityPerf.estimated")}>
          {hasFps ? (
            <LineChart
              series={[{ data: fps, color: "var(--color-brand-teal)", label: t("activityPerf.fps") }]}
              labels={labels}
              height={140}
              minY={0}
              niceMax
              smooth
              legend={false}
              thresholds={[{ value: 60, label: "60", color: "var(--color-success)" }]}
              formatValue={(v) => `${Math.round(v)}`}
            />
          ) : (
            <div className="act-empty act-empty--compact">
              <div className="act-empty__title">{t("activityPerf.noFpsData")}</div>
            </div>
          )}
        </Chart>

        <Chart title={t("activityPerf.chartCpuGpuUsage")} icon={<Icons.Cpu size={13} />} badge={real ? undefined : t("activityPerf.estimated")}>
          <LineChart
            series={[
              { data: cpu, color: "var(--color-brand-blue)", label: t("activityPerf.cpuUsage") },
              { data: gpu, color: "var(--color-accent)", label: t("activityPerf.gpuUsage") },
            ]}
            labels={labels}
            height={140}
            minY={0}
            maxY={100}
            smooth
            formatValue={(v) => `${Math.round(v)}%`}
          />
        </Chart>

        <Chart title={t("activityPerf.ramUsage")} icon={<Icons.MemoryStick size={13} />} badge={real ? undefined : t("activityPerf.estimated")}>
          <LineChart
            series={[{ data: ram, color: "var(--color-success)", label: t("activityPerf.ramUsage") }]}
            labels={labels}
            height={140}
            minY={0}
            maxY={100}
            smooth
            legend={false}
            formatValue={(v) => `${Math.round(v)}%`}
          />
        </Chart>

        {hasTempData && (
          <Chart title={t("activityPerf.temperatures")} icon={<Icons.Thermometer size={13} />} badge={real ? undefined : t("activityPerf.estimated")}>
            <LineChart
              series={tempSeries}
              labels={labels}
              height={140}
              minY={tempMinY(tempUnit)}
              maxY={tempMaxY(tempUnit)}
              smooth
              formatValue={(v) => `${Math.round(v)}${tempUnitLabel(tempUnit)}`}
            />
          </Chart>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="act-session-chip">
      <span className="act-session-chip__label">{label}</span>
      <span className="act-session-chip__value">{value}</span>
      {sub && <span className="act-session-chip__sub">{sub}</span>}
    </div>
  );
}

function Chart({ title, icon, badge, children }: { title: string; icon: ReactNode; badge?: string; children: ReactNode }) {
  return (
    <div className="act-session-chart">
      <div className="act-session-chart__title">
        {icon}
        {title}
        {badge && (
          <span className="act-session-detail__badge">
            <Icons.Info size={11} />
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
