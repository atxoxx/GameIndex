import { useEffect, useMemo } from "react";
import { Gauge, Timer, Flame, CircuitBoard, Zap } from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { Tooltip } from "../../ui";
import OverlaySparkline from "../OverlaySparkline";
import { computeFpsStats, metricSeries, peakOf, formatVram } from "../overlayStats";

/** A single labelled statistic pill in the deep-dive header strip. */
function StatChip({
  label,
  value,
  hint,
  intent = "default",
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  intent?: "default" | "accent" | "good" | "warn";
  testId: string;
}) {
  const chip = (
    <div className={`overlay-stat-chip overlay-stat-chip--${intent}`} data-testid={testId}>
      <span className="overlay-stat-chip__value">{value}</span>
      <span className="overlay-stat-chip__label">{label}</span>
    </div>
  );
  return hint ? (
    <Tooltip content={hint} placement="top">
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

/**
 * Performance deep-dive: real frame-time statistics and the extended hardware
 * sensors (VRAM, power draw, clocks) that the reduced HUD has no room for.
 * Everything is derived from the shared rolling telemetry window; sensors that
 * no source reported stay hidden rather than showing a fabricated zero.
 */
export default function PerformanceDeepDive() {
  const { metrics, history, setDeepDiveActive } = useOverlay();
  const { t } = useLanguage();

  // While the deep-dive is open the sampler runs at the fine rate
  // (DEEP_DIVE_INTERVAL_MS) — the statistics below are only meaningful over a
  // dense series — and drops back to the ordinary rate when it closes.
  useEffect(() => {
    setDeepDiveActive(true);
    return () => setDeepDiveActive(false);
  }, [setDeepDiveActive]);

  const fpsStats = useMemo(
    () => computeFpsStats(metricSeries(history, "fps")),
    [history],
  );

  // RTSS reports per-frame min/max over its own stat window — real frame
  // boundaries rather than the 1-second samples the HUD sees — so those bounds
  // win over anything computed from the rolling window.
  const rtssMin = useMemo(() => {
    const series = metricSeries(history, "fpsMin");
    return series.length ? Math.min(...series) : null;
  }, [history]);
  const rtssMax = useMemo(() => {
    const series = metricSeries(history, "fpsMax");
    return series.length ? Math.max(...series) : null;
  }, [history]);

  // Frame time: prefer the sensor value, otherwise derive it from FPS.
  const frametimeSeries = useMemo(
    () =>
      history
        .map((sample) =>
          typeof sample.frametime === "number"
            ? sample.frametime
            : typeof sample.fps === "number" && sample.fps > 0
              ? 1000 / sample.fps
              : undefined,
        )
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    [history],
  );

  const hasFps = fpsStats !== null;
  const hasFrametime = frametimeSeries.length > 1;

  const vram = formatVram(metrics?.vramUsedMb, metrics?.vramTotalMb);
  const gpuPower =
    typeof metrics?.gpuPower === "number" && Number.isFinite(metrics.gpuPower)
      ? `${Math.round(metrics.gpuPower)} W`
      : null;
  const cpuPower =
    typeof metrics?.cpuPower === "number" && Number.isFinite(metrics.cpuPower)
      ? `${Math.round(metrics.cpuPower)} W`
      : null;
  const coreClock =
    typeof metrics?.gpuCoreClock === "number" && Number.isFinite(metrics.gpuCoreClock)
      ? `${Math.round(metrics.gpuCoreClock)} MHz`
      : null;
  const memClock =
    typeof metrics?.gpuMemClock === "number" && Number.isFinite(metrics.gpuMemClock)
      ? `${Math.round(metrics.gpuMemClock)} MHz`
      : null;

  const peakCpu = peakOf(metricSeries(history, "cpu"));
  const peakGpu = peakOf(metricSeries(history, "gpu"));
  const peakRam = peakOf(metricSeries(history, "ram"));

  return (
    <div className="overlay-deep-dive" data-testid="overlay-performance-deep-dive">
      <section className="overlay-graph-section">
        <h4 className="overlay-graph-section__title">
          {t("overlay.performance.title")}
        </h4>

        <div className="overlay-stat-row" data-testid="overlay-fps-stats">
          <StatChip
            testId="overlay-stat-avg"
            intent="accent"
            label={t("overlay.performance.avgFps")}
            value={hasFps ? String(Math.round(fpsStats!.avg)) : "—"}
          />
          <StatChip
            testId="overlay-stat-low1"
            intent="warn"
            label={t("overlay.performance.low1")}
            value={hasFps ? String(Math.round(fpsStats!.low1)) : "—"}
          />
          <StatChip
            testId="overlay-stat-low01"
            intent="warn"
            label={t("overlay.performance.low01")}
            value={hasFps ? String(Math.round(fpsStats!.low01)) : "—"}
          />
          <StatChip
            testId="overlay-stat-min"
            label={t("overlay.performance.minFps")}
            value={
              rtssMin !== null
                ? String(Math.round(rtssMin))
                : hasFps
                  ? String(Math.round(fpsStats!.min))
                  : "—"
            }
            hint={rtssMin !== null ? t("overlay.performance.realWindow") : undefined}
          />
          <StatChip
            testId="overlay-stat-max"
            intent="good"
            label={t("overlay.performance.maxFps")}
            value={
              rtssMax !== null
                ? String(Math.round(rtssMax))
                : hasFps
                  ? String(Math.round(fpsStats!.max))
                  : "—"
            }
            hint={rtssMax !== null ? t("overlay.performance.realWindow") : undefined}
          />
        </div>

        <div className="overlay-sparkline-grid">
          <OverlaySparkline
            featured
            label={t("overlay.performance.frametime")}
            values={frametimeSeries}
            value={metrics?.frametime}
            unit=" ms"
            emptyLabel={t("overlay.graphs.noData")}
            testId="overlay-graph-frametime"
          />
        </div>
        <p className="overlay-deep-dive__hint">{t("overlay.performance.frametimeHint")}</p>
      </section>

      {(vram || gpuPower || cpuPower || coreClock || memClock) && (
        <section className="overlay-graph-section">
          <h4 className="overlay-graph-section__title">
            {t("overlay.performance.sensors")}
          </h4>
          <div className="overlay-sensor-grid" data-testid="overlay-sensor-grid">
            {vram && (
              <div className="overlay-sensor-tile" data-testid="overlay-sensor-vram">
                <CircuitBoard size={14} className="overlay-sensor-tile__icon" />
                <span className="overlay-sensor-tile__value">{vram}</span>
                <span className="overlay-sensor-tile__label">{t("overlay.performance.vram")}</span>
              </div>
            )}
            {gpuPower && (
              <div className="overlay-sensor-tile" data-testid="overlay-sensor-gpu-power">
                <Zap size={14} className="overlay-sensor-tile__icon" />
                <span className="overlay-sensor-tile__value">{gpuPower}</span>
                <span className="overlay-sensor-tile__label">{t("overlay.performance.gpuPower")}</span>
              </div>
            )}
            {cpuPower && (
              <div className="overlay-sensor-tile" data-testid="overlay-sensor-cpu-power">
                <Flame size={14} className="overlay-sensor-tile__icon" />
                <span className="overlay-sensor-tile__value">{cpuPower}</span>
                <span className="overlay-sensor-tile__label">{t("overlay.performance.cpuPower")}</span>
              </div>
            )}
            {coreClock && (
              <div className="overlay-sensor-tile" data-testid="overlay-sensor-core-clock">
                <Gauge size={14} className="overlay-sensor-tile__icon" />
                <span className="overlay-sensor-tile__value">{coreClock}</span>
                <span className="overlay-sensor-tile__label">{t("overlay.performance.coreClock")}</span>
              </div>
            )}
            {memClock && (
              <div className="overlay-sensor-tile" data-testid="overlay-sensor-mem-clock">
                <Timer size={14} className="overlay-sensor-tile__icon" />
                <span className="overlay-sensor-tile__value">{memClock}</span>
                <span className="overlay-sensor-tile__label">{t("overlay.performance.memClock")}</span>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="overlay-graph-section">
        <h4 className="overlay-graph-section__title">{t("overlay.performance.peaks")}</h4>
        <div className="overlay-stat-row" data-testid="overlay-peak-stats">
          <StatChip
            testId="overlay-peak-cpu"
            label={t("overlay.metric.cpu")}
            value={peakCpu !== null ? `${Math.round(peakCpu)}%` : "—"}
          />
          <StatChip
            testId="overlay-peak-gpu"
            label={t("overlay.metric.gpu")}
            value={peakGpu !== null ? `${Math.round(peakGpu)}%` : "—"}
          />
          <StatChip
            testId="overlay-peak-ram"
            label={t("overlay.metric.ram")}
            value={peakRam !== null ? `${Math.round(peakRam)}%` : "—"}
          />
        </div>
      </section>

      {!hasFrametime && (
        <p className="overlay-deep-dive__hint">{t("overlay.performance.noFps")}</p>
      )}
    </div>
  );
}
