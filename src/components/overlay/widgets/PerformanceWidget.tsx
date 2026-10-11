import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { KpiTile, Tooltip } from "../../ui";
import OverlaySparkline from "../OverlaySparkline";
import PerformanceDeepDive from "./PerformanceDeepDive";

function formatPercent(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "—";
}

function formatTemp(value: number | undefined): string {
  // Non-positive => no sensor; never surface a fabricated 0°.
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${Math.round(value)}°`
    : "—";
}

function formatFps(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(Math.round(value))
    : "—";
}

/** Metric keys that can be plotted. */
type MetricKey = "fps" | "cpu" | "gpu" | "ram" | "cpuTemp" | "gpuTemp";

/** Pull a finite series for one metric key out of the rolling window. */
function series(
  history: ReturnType<typeof useOverlay>["history"],
  key: MetricKey,
): number[] {
  const out: number[] = [];
  for (const sample of history) {
    const value = sample[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    // Temperatures of 0 mean "no sensor reported"; keep them out of the plot.
    if ((key === "cpuTemp" || key === "gpuTemp") && value <= 0) continue;
    out.push(value);
  }
  return out;
}

interface GraphSpec {
  key: MetricKey;
  label: string;
  values: number[];
  value: number | undefined;
  unit?: string;
  max?: number;
  featured?: boolean;
}

/**
 * Live telemetry. With graphs off it is a compact grid of metric tiles; with
 * graphs on the tiles are replaced by rolling area charts, grouped by type —
 * usage (FPS/CPU/GPU/RAM) then temperatures. FPS is the featured chart and
 * shows a placeholder until a real frame source (RTSS/Afterburner) reports;
 * it is never fabricated, matching the collector's policy.
 */
export default function PerformanceWidget() {
  const { metrics, history, settings } = useOverlay();
  const { t } = useLanguage();

  const graph = (
    key: MetricKey,
    label: string,
    extra: { unit?: string; max?: number; featured?: boolean } = {},
  ): GraphSpec => ({
    key,
    label,
    values: series(history, key),
    value: metrics?.[key],
    ...extra,
  });

  if (!settings.showGraphs) {
    const tiles = [
      {
        key: "fps",
        label: t("overlay.metric.fps"),
        hint: t("overlay.metric.fpsHint"),
        value: formatFps(metrics?.fps),
        intent: "accent" as const,
      },
      {
        key: "cpu",
        label: t("overlay.metric.cpu"),
        hint: t("overlay.metric.cpuHint"),
        value: formatPercent(metrics?.cpu),
        intent: "default" as const,
      },
      {
        key: "gpu",
        label: t("overlay.metric.gpu"),
        hint: t("overlay.metric.gpuHint"),
        value: formatPercent(metrics?.gpu),
        intent: "default" as const,
      },
      {
        key: "ram",
        label: t("overlay.metric.ram"),
        hint: t("overlay.metric.ramHint"),
        value: formatPercent(metrics?.ram),
        intent: "default" as const,
      },
      ...(settings.showTemps
        ? [
            {
              key: "cpuTemp",
              label: t("overlay.metric.cpuTemp"),
              hint: t("overlay.metric.cpuTempHint"),
              value: formatTemp(metrics?.cpuTemp),
              intent: "default" as const,
            },
            {
              key: "gpuTemp",
              label: t("overlay.metric.gpuTemp"),
              hint: t("overlay.metric.gpuTempHint"),
              value: formatTemp(metrics?.gpuTemp),
              intent: "default" as const,
            },
          ]
        : []),
    ];

    return (
      <div className="overlay-performance">
        <div className="overlay-metric-grid">
          {tiles.map((tile) => (
            <Tooltip key={tile.key} content={tile.hint} placement="top">
              <KpiTile
                size="sm"
                glass
                intent={tile.intent}
                label={tile.label}
                value={tile.value}
                data-testid={`overlay-metric-${tile.key}`}
              />
            </Tooltip>
          ))}
        </div>
      </div>
    );
  }

  const usage: GraphSpec[] = [
    graph("fps", t("overlay.metric.fps"), { featured: true }),
    graph("cpu", t("overlay.metric.cpu"), { unit: "%", max: 100 }),
    graph("gpu", t("overlay.metric.gpu"), { unit: "%", max: 100 }),
    graph("ram", t("overlay.metric.ram"), { unit: "%", max: 100 }),
  ];
  const temps: GraphSpec[] = [
    graph("cpuTemp", t("overlay.metric.cpuTemp"), { unit: "°" }),
    graph("gpuTemp", t("overlay.metric.gpuTemp"), { unit: "°" }),
  ];

  const renderGraph = (spec: GraphSpec) => (
    <OverlaySparkline
      key={spec.key}
      label={spec.label}
      values={spec.values}
      value={spec.value}
      unit={spec.unit}
      max={spec.max}
      featured={spec.featured}
      emptyLabel={t("overlay.graphs.noData")}
      testId={`overlay-graph-${spec.key}`}
    />
  );

  return (
    <div className="overlay-performance" data-testid="overlay-graphs">
      <section className="overlay-graph-section">
        <h4 className="overlay-graph-section__title">
          {t("overlay.graphs.usage")}
        </h4>
        <div className="overlay-sparkline-grid">{usage.map(renderGraph)}</div>
      </section>

      {settings.showTemps && (
        <section className="overlay-graph-section">
          <h4 className="overlay-graph-section__title">
            {t("overlay.graphs.temps")}
          </h4>
          <div className="overlay-sparkline-grid">{temps.map(renderGraph)}</div>
        </section>
      )}

      <PerformanceDeepDive />
    </div>
  );
}
