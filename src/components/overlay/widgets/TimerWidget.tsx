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
} from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
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

function formatTime(totalMs: number): string {
  const totalSecs = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const tenths = Math.floor((totalMs % 1000) / 100);

  if (hours > 0) {
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

  // Stopwatch state
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const [targetMins, setTargetMins] = useState(60);
  const [clockStr, setClockStr] = useState("");

  const startRef = useRef(0);
  const animRef = useRef<number | null>(null);

  // Update real-time clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockStr(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Stopwatch tick
  useEffect(() => {
    if (!running) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const start = performance.now() - elapsedMs;
    startRef.current = start;

    const tick = () => {
      setElapsedMs(performance.now() - startRef.current);
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

  return (
    <Card variant="glass" className="overlay-widget overlay-timer-widget">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <TimerIcon />
        </span>
        <h3 className="overlay-widget__title">{t("overlay.timer.title")}</h3>
        <span className="overlay-clock-pill">
          <Clock size={11} />
          {clockStr}
        </span>
      </div>

      <div className="overlay-timer-content">
        {/* Stopwatch display */}
        <div className="overlay-stopwatch-card">
          <div className="overlay-stopwatch-display">
            {formatTime(elapsedMs)}
          </div>
          <div className="overlay-stopwatch-controls">
            <Button
              variant={running ? "secondary" : "primary"}
              size="sm"
              onClick={toggleRunning}
            >
              {running ? <Pause size={14} /> : <Play size={14} />}
              <span>{running ? t("overlay.timer.pause") : t("overlay.timer.start")}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={addLap}
              disabled={!running && elapsedMs === 0}
            >
              <Flag size={13} />
              <span>{t("overlay.timer.lap")}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={elapsedMs === 0}
            >
              <RotateCcw size={13} />
              <span>{t("overlay.timer.reset")}</span>
            </Button>
          </div>

          {laps.length > 0 && (
            <div className="overlay-laps-list">
              {laps.slice(0, 4).map((lap, idx) => (
                <div key={idx} className="overlay-lap-item">
                  <span className="overlay-lap-idx">#{laps.length - idx}</span>
                  <span className="overlay-lap-time">{formatTime(lap)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Session Goal Tracker */}
        <div className="overlay-target-card">
          <div className="overlay-target-head">
            <div className="overlay-target-title">
              <Target size={14} />
              <span>{t("overlay.timer.target")}</span>
            </div>
            {targetReached && (
              <span className="overlay-target-reached-badge">
                <CheckCircle2 size={12} />
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
                  {Math.round(progressPercent)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
