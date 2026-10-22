// Handheld mode bridge — applies the handheld shell to the document and
// (on SteamOS hardware) enters the controller-first Big Screen shell
// once per launch.
//
// Rendered once in the app shell, above the route tree. The layout
// attribute drives the compact handheld CSS in `index.css`; the shell
// switch is guarded by sessionStorage so exiting Big Screen on a Deck
// (to reach the desktop UI) isn't undone by the next render.

import { useEffect } from "react";
import { useBigScreen } from "../context/BigScreenContext";
import { useHandheldMode } from "../hooks/useHandheldMode";

const AUTO_ENTERED_KEY = "gamelib.handheld.autoEntered";

export default function HandheldModeBridge() {
  const { enabled, detected } = useHandheldMode();
  const { isBigScreen, setBigScreen } = useBigScreen();

  useEffect(() => {
    document.documentElement.toggleAttribute("data-handheld", enabled);
    document.documentElement.setAttribute("data-handheld-mode", enabled ? "on" : "off");
  }, [enabled]);

  useEffect(() => {
    if (!enabled || isBigScreen) return;
    let alreadyEntered = false;
    try {
      alreadyEntered = sessionStorage.getItem(AUTO_ENTERED_KEY) === "1";
    } catch {
      // Storage blocked — fall through and enter once per render session.
    }
    if (alreadyEntered) return;
    try {
      sessionStorage.setItem(AUTO_ENTERED_KEY, "1");
    } catch {
      // Ignore: entering the shell is more important than the guard.
    }
    setBigScreen(true);
    // Detection is stable for the process lifetime; only a mode flip
    // needs to re-evaluate. `detected` is listed to satisfy exhaustive deps.
  }, [enabled, detected, isBigScreen, setBigScreen]);

  return null;
}
