// Shared handheld-mode state.
//
// One tiny external store (same pattern the price/wishlist contexts use
// for cheap cross-tree sharing) so the command palette, the shell bridge
// and any future toggle all read the same value without another provider
// in an already deep tree.

import { useCallback, useSyncExternalStore } from "react";
import {
  detectHandheldHost,
  loadHandheldPref,
  nextHandheldPref,
  resolveHandheldEnabled,
  saveHandheldPref,
  type HandheldPref,
} from "../utils/handheld";

const listeners = new Set<() => void>();

let pref: HandheldPref = loadHandheldPref();
let detected = detectHandheldHost(
  typeof navigator === "undefined" ? "" : navigator.userAgent
);

function snapshot(): string {
  // A single primitive snapshot keeps useSyncExternalStore comparisons cheap.
  return `${pref}:${detected ? "1" : "0"}`;
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set an explicit preference ("on"/"off"), persisted for next launch. */
export function setHandheldPref(next: HandheldPref): void {
  pref = next;
  saveHandheldPref(next);
  emit();
}

/** Flip to the opposite of the current effective state. */
export function toggleHandheldMode(): void {
  const enabled = resolveHandheldEnabled(pref, detected);
  setHandheldPref(nextHandheldPref(enabled));
}

/** Test seam: override device detection (SteamOS emulation). */
export function __setHandheldDetectedForTests(value: boolean): void {
  detected = value;
  emit();
}

export function useHandheldMode(): {
  /** Effective state — explicit preference, else the detected device. */
  enabled: boolean;
  /** Raw preference, for UI that wants to show "Auto". */
  pref: HandheldPref;
  /** True when the OS looks like SteamOS/Steam Deck. */
  detected: boolean;
  toggle: () => void;
  setPref: (next: HandheldPref) => void;
} {
  const raw = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [rawPref, rawDetected] = raw.split(":");
  const prefValue = rawPref as HandheldPref;
  const detectedValue = rawDetected === "1";
  const toggle = useCallback(() => toggleHandheldMode(), []);
  return {
    enabled: resolveHandheldEnabled(prefValue, detectedValue),
    pref: prefValue,
    detected: detectedValue,
    toggle,
    setPref: setHandheldPref,
  };
}
