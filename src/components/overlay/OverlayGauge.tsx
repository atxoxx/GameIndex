import type { ReactNode } from "react";
import { Tooltip } from "../ui";

export type OverlayGaugeIntent =
  | "accent"
  | "good"
  | "fair"
  | "low"
  | "default";

export interface OverlayGaugeProps {
  /** Short caption under the ring (e.g. "FPS"). */
  label: string;
  /** Current value; `undefined` renders an empty ring with a dash. */
  value?: number;
  /** Upper bound for the ring sweep. Defaults to 100. */
  max?: number;
  /** Suffix appended to the value (e.g. "%", "°"). */
  unit?: string;
  /** Overrides the centred value text (for non-numeric readouts). */
  display?: string;
  /** Colour ramp for the ring + value. */
  intent?: OverlayGaugeIntent;
  /** Ring diameter in px. */
  size?: number;
  /** Optional tooltip content. */
  hint?: ReactNode;
  testId?: string;
}

const STROKE = 5;

/**
 * Circular telemetry gauge for the overlay's reduced HUD. Dependency-free
 * (one SVG ring) and fully theme-token driven, so light themes read correctly.
 */
export default function OverlayGauge({
  label,
  value,
  max = 100,
  unit = "",
  display,
  intent = "default",
  size = 54,
  hint,
  testId,
}: OverlayGaugeProps) {
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const ratio = hasValue ? Math.min(Math.max(value / max, 0), 1) : 0;
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * ratio;

  const text = display ?? (hasValue ? `${Math.round(value)}${unit}` : "—");

  const ring = (
    <div
      className={`overlay-gauge overlay-gauge--${intent}${
        hasValue ? "" : " overlay-gauge--empty"
      }`}
      data-testid={testId}
      style={{ width: size, height: size }}
    >
      <svg
        className="overlay-gauge__svg"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label} ${text}`}
      >
        <circle
          className="overlay-gauge__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
        />
        <circle
          className="overlay-gauge__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="overlay-gauge__reading">{text}</span>
      <span className="overlay-gauge__label">{label}</span>
    </div>
  );

  return hint ? (
    <Tooltip content={hint} placement="top">
      {ring}
    </Tooltip>
  ) : (
    ring
  );
}
