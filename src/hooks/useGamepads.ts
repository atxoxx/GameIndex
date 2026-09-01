import { useCallback, useEffect, useState } from "react";

/**
 * A connected gamepad snapshot (subset of the standard Gamepad object —
 * the full interface isn't serialisable and varies across browsers).
 */
export interface GamepadInfo {
  index: number;
  id: string;
  /** "standard" for standard layouts, "" for unknown. */
  mapping: string;
  connected: boolean;
  /** Number of physical buttons exposed. */
  buttonCount: number;
  /** Number of axes. */
  axisCount: number;
}

export type ButtonLayout = "xbox" | "ps" | "nintendo";

/** Display labels per layout for the standard 16-button gamepad order
 *  (buttons[0..15] = bottom, right, left, top, L1, R1, L2, R2, back,
 *  start, L3, R3, dpad up/down/left/right). */
export const BUTTON_LABELS: Record<ButtonLayout, string[]> = {
  xbox: [
    "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start",
    "LS", "RS", "↑", "↓", "←", "→",
  ],
  ps: [
    "✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Select", "Start",
    "L3", "R3", "↑", "↓", "←", "→",
  ],
  nintendo: [
    "B", "A", "Y", "X", "L", "R", "ZL", "ZR", "−", "+",
    "L", "R", "↑", "↓", "←", "→",
  ],
};

/** Poll `navigator.getGamepads()` and report connected controllers.
 *  Uses a 500 ms interval; the Gamepad API requires an interaction
 *  before it reports anything in most browsers. */
export function useGamepads(): GamepadInfo[] {
  const [pads, setPads] = useState<GamepadInfo[]>([]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.getGamepads) {
      return;
    }
    const read = () => {
      const all = navigator.getGamepads();
      const connected: GamepadInfo[] = [];
      for (const gp of all) {
        if (!gp || !gp.connected) continue;
        connected.push({
          index: gp.index,
          id: gp.id,
          mapping: gp.mapping,
          connected: true,
          buttonCount: gp.buttons?.length ?? 0,
          axisCount: gp.axes?.length ?? 0,
        });
      }
      setPads((prev) => {
        if (
          prev.length === connected.length &&
          prev.every((p, i) => p.id === connected[i]?.id && p.index === connected[i]?.index)
        ) {
          return prev;
        }
        return connected;
      });
    };
    read();
    const timer = window.setInterval(read, 500);
    const onConnect = () => read();
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onConnect);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onConnect);
    };
  }, []);

  return pads;
}

/** Label a standard gamepad button index for the given layout. */
export function buttonLabel(layout: ButtonLayout, index: number): string {
  const labels = BUTTON_LABELS[layout] ?? BUTTON_LABELS.xbox;
  return labels[index] ?? `Btn${index}`;
}

/** Best-guess layout for a controller id string (vendor heuristics). */
export function guessLayout(id: string): ButtonLayout {
  const lower = id.toLowerCase();
  if (lower.includes("nintendo") || lower.includes("switch") || lower.includes("pro controller")) {
    return "nintendo";
  }
  if (lower.includes("playstation") || lower.includes("dualshock") || lower.includes("dualsense")) {
    return "ps";
  }
  if (lower.includes("xbox")) {
    return "xbox";
  }
  // Generic controllers with A/B/X/Y follow the Xbox convention.
  return "xbox";
}

export const useButtonLabel = (): ((index: number) => string) => {
  const pads = useGamepads();
  const layout = pads[0] ? guessLayout(pads[0].id) : "xbox";
  return useCallback((index: number) => buttonLabel(layout, index), [layout]);
};
