import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import type { GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";
import { formatTemp } from "../../utils/temp";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { compareSessions, calculateTelemetryInsights } from "./insights";
import * as Icons from "./Icons";

export interface SessionComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: GameSession[];
  initialSessionAId?: string;
  initialSessionBId?: string;
}

export function SessionComparisonModal({
  isOpen,
  onClose,
  sessions,
  initialSessionAId,
  initialSessionBId,
}: SessionComparisonModalProps) {
  const { t, language } = useLanguage();
  const { tempUnit } = useSettings();

  const sessionsWithHw = useMemo(() => {
    return sessions.filter((s) => s.metrics && s.metrics.avgFps > 0);
  }, [sessions]);

  const candidateSessions = sessionsWithHw.length >= 2 ? sessionsWithHw : sessions;

  const [sessionAId, setSessionAId] = useState<string>(() => {
    if (initialSessionAId && candidateSessions.some((s) => s.id === initialSessionAId)) {
      return initialSessionAId;
    }
    return candidateSessions[0]?.id ?? "";
  });

  const [sessionBId, setSessionBId] = useState<string>(() => {
    if (initialSessionBId && candidateSessions.some((s) => s.id === initialSessionBId)) {
      return initialSessionBId;
    }
    return candidateSessions[1]?.id ?? candidateSessions[0]?.id ?? "";
  });

  const sessionA = useMemo(() => candidateSessions.find((s) => s.id === sessionAId) ?? null, [candidateSessions, sessionAId]);
  const sessionB = useMemo(() => candidateSessions.find((s) => s.id === sessionBId) ?? null, [candidateSessions, sessionBId]);

  const comparison = useMemo(() => {
    if (!sessionA || !sessionB) return null;
    return compareSessions(sessionA, sessionB);
  }, [sessionA, sessionB]);

  const telemetryA = useMemo(() => calculateTelemetryInsights(sessionA?.metrics), [sessionA]);
  const telemetryB = useMemo(() => calculateTelemetryInsights(sessionB?.metrics), [sessionB]);

  if (!isOpen) return null;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(language, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const renderDelta = (delta: number | null, unit: string = "", invertGood: boolean = false) => {
    if (delta == null || delta === 0) {
      return <span className="act-compare-delta act-compare-delta--flat">0{unit}</span>;
    }
    const isPositive = delta > 0;
    const isGood = invertGood ? !isPositive : isPositive;
    return (
      <span
        className={`act-compare-delta ${isGood ? "act-compare-delta--good" : "act-compare-delta--bad"}`}
      >
        {isPositive ? `+${delta}` : delta}
        {unit}
      </span>
    );
  };

  return createPortal(
    <div className="act-modal-backdrop" onClick={onClose}>
      <div
        className="act-modal act-modal--compare"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="act-modal__header">
          <div className="act-modal__title-group">
            <div className="act-modal__icon-pill">
              <Icons.Sliders size={16} />
            </div>
            <div>
              <h3 className="act-modal__title">{t("activityCompare.title")}</h3>
              <span className="act-modal__sub">{t("activityCompare.subtitle")}</span>
            </div>
          </div>
          <button
            type="button"
            className="act-modal__close-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icons.X size={16} />
          </button>
        </div>

        <div className="act-compare-body">
          {/* Session Selectors */}
          <div className="act-compare-selectors">
            <div className="act-compare-select-col">
              <label className="act-compare-label">{t("activityCompare.baselineSession")}</label>
              <select
                className="act-toolbar__select act-compare-select"
                value={sessionAId}
                onChange={(e) => setSessionAId(e.target.value)}
              >
                {candidateSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDate(s.date)} — {s.gameName} ({formatPlayTime(s.durationMin)})
                    {s.metrics?.avgFps ? ` · ${s.metrics.avgFps} FPS` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="act-compare-vs-badge">
              <Icons.ArrowRightLeft size={14} />
            </div>

            <div className="act-compare-select-col">
              <label className="act-compare-label">{t("activityCompare.comparisonSession")}</label>
              <select
                className="act-toolbar__select act-compare-select"
                value={sessionBId}
                onChange={(e) => setSessionBId(e.target.value)}
              >
                {candidateSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDate(s.date)} — {s.gameName} ({formatPlayTime(s.durationMin)})
                    {s.metrics?.avgFps ? ` · ${s.metrics.avgFps} FPS` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {sessionA && sessionB && comparison ? (
            <div className="act-compare-table-wrapper">
              <table className="act-compare-table">
                <thead>
                  <tr>
                    <th>{t("activityCompare.metric")}</th>
                    <th>{t("activityCompare.sessionA")}</th>
                    <th>{t("activityCompare.delta")}</th>
                    <th>{t("activityCompare.sessionB")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="act-compare-metric-name">
                        <Icons.Clock size={13} /> {t("activity.duration")}
                      </div>
                    </td>
                    <td>{formatPlayTime(sessionA.durationMin)}</td>
                    <td>
                      {renderDelta(
                        comparison.durationDeltaMin,
                        "m",
                      )}
                    </td>
                    <td>{formatPlayTime(sessionB.durationMin)}</td>
                  </tr>

                  {/* Resolution */}
                  <tr>
                    <td>
                      <div className="act-compare-metric-name">
                        <Icons.Monitor size={13} /> {t("activityGantt.resolution")}
                      </div>
                    </td>
                    <td>{sessionA.metrics?.resolution || "—"}</td>
                    <td>
                      {sessionA.metrics?.resolution === sessionB.metrics?.resolution ? (
                        <span className="act-compare-delta act-compare-delta--flat">{t("activityCompare.same")}</span>
                      ) : (
                        <span className="act-compare-delta act-compare-delta--diff">{t("activityCompare.changed")}</span>
                      )}
                    </td>
                    <td>{sessionB.metrics?.resolution || "—"}</td>
                  </tr>

                  {/* Avg FPS */}
                  <tr>
                    <td>
                      <div className="act-compare-metric-name">
                        <Icons.Gauge size={13} /> {t("activityPerf.avgFps")}
                      </div>
                    </td>
                    <td>{sessionA.metrics?.avgFps ? `${sessionA.metrics.avgFps} FPS` : "—"}</td>
                    <td>{renderDelta(comparison.avgFpsDelta, " FPS")}</td>
                    <td>{sessionB.metrics?.avgFps ? `${sessionB.metrics.avgFps} FPS` : "—"}</td>
                  </tr>

                  {/* 1% Low FPS */}
                  <tr>
                    <td>
                      <div className="act-compare-metric-name">
                        <Icons.Zap size={13} /> {t("activityCompare.onePercentLow")}
                      </div>
                    </td>
                    <td>{telemetryA?.onePercentLowFps ? `${telemetryA.onePercentLowFps} FPS` : "—"}</td>
                    <td>{renderDelta(comparison.onePercentLowDelta, " FPS")}</td>
                    <td>{telemetryB?.onePercentLowFps ? `${telemetryB.onePercentLowFps} FPS` : "—"}</td>
                  </tr>

                  {/* Stability Rating */}
                  <tr>
                    <td>
                      <div className="act-compare-metric-name">
                        <Icons.Activity size={13} /> {t("activityPerf.columnStability")}
                      </div>
                    </td>
                    <td>
                      {telemetryA ? (
                        <span className={`performance-stability-badge performance-stability-badge--${telemetryA.stabilityRating}`}>
                          {telemetryA.fpsStabilityScore}% ({telemetryA.stabilityRating})
                        </span>
                      ) : "—"}
                    </td>
                    <td>
                      {telemetryA && telemetryB ? (
                        renderDelta(telemetryB.fpsStabilityScore - telemetryA.fpsStabilityScore, "%")
                      ) : "—"}
                    </td>
                    <td>
                      {telemetryB ? (
                        <span className={`performance-stability-badge performance-stability-badge--${telemetryB.stabilityRating}`}>
                          {telemetryB.fpsStabilityScore}% ({telemetryB.stabilityRating})
                        </span>
                      ) : "—"}
                    </td>
                  </tr>

                  {/* CPU Usage */}
                  <tr>
                    <td>
                      <div className="act-compare-metric-name">
                        <Icons.Cpu size={13} /> {t("activityPerf.cpuUsage")}
                      </div>
                    </td>
                    <td>{sessionA.metrics?.avgCpuUsage ? `${sessionA.metrics.avgCpuUsage}%` : "—"}</td>
                    <td>{renderDelta(comparison.avgCpuDelta, "%", true)}</td>
                    <td>{sessionB.metrics?.avgCpuUsage ? `${sessionB.metrics.avgCpuUsage}%` : "—"}</td>
                  </tr>

                  {/* GPU Usage */}
                  <tr>
                    <td>
                      <div className="act-compare-metric-name">
                        <Icons.Activity size={13} /> {t("activityPerf.gpuUsage")}
                      </div>
                    </td>
                    <td>{sessionA.metrics?.avgGpuUsage ? `${sessionA.metrics.avgGpuUsage}%` : "—"}</td>
                    <td>{renderDelta(comparison.avgGpuDelta, "%")}</td>
                    <td>{sessionB.metrics?.avgGpuUsage ? `${sessionB.metrics.avgGpuUsage}%` : "—"}</td>
                  </tr>

                  {/* Temperatures */}
                  {(sessionA.metrics?.avgGpuTemp || sessionB.metrics?.avgGpuTemp) ? (
                    <tr>
                      <td>
                        <div className="act-compare-metric-name">
                          <Icons.Thermometer size={13} /> {t("activityPerf.gpuTemp")}
                        </div>
                      </td>
                      <td>{sessionA.metrics?.avgGpuTemp ? formatTemp(sessionA.metrics.avgGpuTemp, tempUnit) : "—"}</td>
                      <td>{renderDelta(comparison.avgGpuTempDelta, "°", true)}</td>
                      <td>{sessionB.metrics?.avgGpuTemp ? formatTemp(sessionB.metrics.avgGpuTemp, tempUnit) : "—"}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="act-empty act-empty--compact">
              <div className="act-empty__title">{t("activityCompare.selectTwoSessions")}</div>
            </div>
          )}
        </div>

        <div className="act-modal__actions">
          <button
            type="button"
            className="act-inspector-btn act-inspector-btn--primary"
            onClick={onClose}
          >
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
