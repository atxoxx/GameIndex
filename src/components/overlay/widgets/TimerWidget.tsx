import { useState, useEffect, useRef } from "react";
import {
  Timer as TimerIcon,
  Play,
  Pause,
  RotateCcw,
  Flag,
  Target,
  CheckCircle2,
  Clock,
  Sparkles,
} from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useVisibleInterval } from "../../../hooks/useVisibleInterval";
import { Card, Button } from "../../ui";

const TARGET_PRESETS = [
  { mins: 0, labelKey: "overlay.timer.noTarget" },
  { mins: 30, label: "30m" },
  { mins: 45, label: "45m" },
  { mins: 60, label: "1h" },
  { mins: 90, label: "1h 30m" },
  { mins: 120, label: "2h" },
  { mins: 180, label: "3h" },
];

function formatTime(totalMs: number, includeHours = false): string {
  const totalSecs = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const tenths = Math.floor((totalMs % 1000) / 100);

  if (hours > 0 || includeHours) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}.${tenths}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}.${tenths}`;
}

export default function TimerWidget() {
  const { session } = useOverlay();
  const { t } = useLanguage();

  // Mode switcher: "stopwatch" vs "target"
  const [activeTab, setActiveTab] = useState<"stopwatch" | "target">("stopwatch");

  // Stopwatch state
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const [targetMins, setTargetMins] = useState(60);
  const [clockStr, setClockStr] = useState("");

  const startRef = useRef(0);
  const animRef = useRef<number | null>(null);

  // Update real-time clock
  useVisibleInterval(() => {
    const now = new Date();
    setClockStr(
      now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  }, 1000);

  // Stopwatch tick
  useEffect(() => {
    if (!running) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const start = performance.now() - elapsedMs;
    startRef.current = start;

    // The readout only shows tenths of a second — re-rendering once per
    // displayed tick (≤10 Hz) instead of once per animation frame.
    let lastTenth = Math.floor(elapsedMs / 100);
    const tick = () => {
      const now = performance.now() - startRef.current;
      const tenth = Math.floor(now / 100);
      if (tenth !== lastTenth) {
        lastTenth = tenth;
        setElapsedMs(now);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [running]);

  const toggleRunning = () => setRunning((r) => !r);

  const reset = () => {
    setRunning(false);
    setElapsedMs(0);
    setLaps([]);
  };

  const addLap = () => {
    setLaps((prev) => [elapsedMs, ...prev]);
  };

  // Session duration from session.startedAt
  const sessionDurationMs = session?.startedAt
    ? Math.max(0, Date.now() - session.startedAt)
    : 0;

  const targetMs = targetMins * 60 * 1000;
  const progressPercent =
    targetMs > 0 ? Math.min(100, (sessionDurationMs / targetMs) * 100) : 0;
  const targetReached = targetMs > 0 && sessionDurationMs >= targetMs;
  const remainingMs = Math.max(0, targetMs - sessionDurationMs);

  return (
    <Card variant="glass" className="overlay-widget overlay-timer-widget">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <TimerIcon />
        </span>
        <h3 className="overlay-widget__title">{t("overlay.timer.title")}</h3>
        <span className="overlay-clock-pill">
          <Clock size={12} />
          {clockStr}
        </span>
      </div>

      {/* Segmented Mode Selector */}
      <div className="overlay-timer-modes">
        <button
          type="button"
          className={`overlay-timer-mode-btn${
            activeTab === "stopwatch" ? " active" : ""
          }`}
          onClick={() => setActiveTab("stopwatch")}
        >
          <TimerIcon size={13} />
          <span>{t("overlay.timer.stopwatch")}</span>
          {running && <span className="overlay-timer-dot" />}
        </button>
        <button
          type="button"
          className={`overlay-timer-mode-btn${
            activeTab === "target" ? " active" : ""
          }`}
          onClick={() => setActiveTab("target")}
        >
          <Target size={13} />
          <span>{t("overlay.timer.sessionGoal")}</span>
          {targetMins > 0 && (
            <span className="overlay-timer-badge-mini">
              {Math.round(progressPercent)}%
            </span>
          )}
        </button>
      </div>

      <div className="overlay-timer-content">
        {activeTab === "stopwatch" ? (
          /* Stopwatch View */
          <div className="overlay-stopwatch-card">
            <div className="overlay-stopwatch-display">
              {formatTime(elapsedMs)}
            </div>

            <div className="overlay-stopwatch-controls">
              <Button
                variant={running ? "secondary" : "primary"}
                size="sm"
                onClick={toggleRunning}
                className="overlay-stopwatch-btn overlay-stopwatch-btn--main"
              >
                {running ? <Pause size={14} /> : <Play size={14} />}
                <span>
                  {running ? t("overlay.timer.pause") : t("overlay.timer.start")}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={addLap}
                disabled={!running && elapsedMs === 0}
                className="overlay-stopwatch-btn"
              >
                <Flag size={13} />
                <span>{t("overlay.timer.lap")}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={elapsedMs === 0}
                className="overlay-stopwatch-btn"
              >
                <RotateCcw size={13} />
                <span>{t("overlay.timer.reset")}</span>
              </Button>
            </div>

            {laps.length > 0 && (
              <div className="overlay-laps-list">
                <div className="overlay-laps-header">
                  <span>{t("overlay.timer.laps")}</span>
                  <span className="overlay-laps-count">({laps.length})</span>
                </div>
                <div className="overlay-laps-items">
                  {laps.slice(0, 5).map((lap, idx) => (
                    <div key={idx} className="overlay-lap-item">
                      <span className="overlay-lap-idx">#{laps.length - idx}</span>
                      <span className="overlay-lap-time">{formatTime(lap)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Session Goal View */
          <div className="overlay-target-card">
            <div className="overlay-target-head">
              <div className="overlay-target-title">
                <Target size={14} />
                <span>{t("overlay.timer.target")}</span>
              </div>
              {targetReached && (
                <span className="overlay-target-reached-badge">
                  <CheckCircle2 size={13} />
                  {t("overlay.timer.targetReached")}
                </span>
              )}
            </div>

            <div className="overlay-target-presets">
              {TARGET_PRESETS.map((p) => (
                <button
                  key={p.mins}
                  type="button"
                  className={`overlay-target-chip${
                    targetMins === p.mins ? " active" : ""
                  }`}
                  onClick={() => setTargetMins(p.mins)}
                >
                  {p.label ?? t(p.labelKey!)}
                </button>
              ))}
            </div>

            {targetMins > 0 && (
              <div className="overlay-target-progress-wrap">
                <div className="overlay-target-progress-bar">
                  <div
                    className={`overlay-target-progress-fill${
                      targetReached ? " reached" : ""
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="overlay-target-labels">
                  <span>
                    {t("overlay.timer.elapsed")}: {formatTime(sessionDurationMs).split(".")[0]}
                  </span>
                  <span>
                    {targetReached ? (
                      <span className="text-success flex items-center gap-1">
                        <Sparkles size={11} />
                        100%
                      </span>
                    ) : (
                      `${t("overlay.timer.remaining")}: ${formatTime(remainingMs).split(".")[0]}`
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
