// BigScreenLayout — v3 console shell.
//
// Three-zone chrome: fixed top strip (BigScreenHeader), full-height
// content area (`<Outlet/>`), and a fixed bottom bar that is a
// non-focusable glyph+label button legend (A SELECT · B BACK · LB/RB
// SECTIONS · Y POINTER) plus brand and clock.
//
// Keeps the historical `.bigscreen-v2` root class so existing page
// component CSS keeps resolving; the `.bigscreen-v3` class layers the
// new shell styles on top.
//
// Gamepad model:
//   • The `/` shortcut and the header search button open the search
//     overlay; navigation closes it again.
//   • The virtual cursor overlay is kept; the FocusRing component
//     (deleted) is replaced by a global CSS focus ring in
//     bigscreen.css.
//   • The shell owns Back: one back handler at `BACK_PRIORITY_SHELL`
//     resolves the current route to its parent section (see
//     `bigScreenParentOf`). A page-level handler (default priority
//     `CYCLER_PRIORITY_PAGE`) still wins the B race while mounted.
//     When there is no parent, Back offers the exit confirmation
//     instead of silently dropping out of Big Screen Mode.

import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import BigScreenHeader from "./BigScreenHeader";
import VirtualCursor from "./ui/VirtualCursor";
import BigScreenSearchOverlay from "./bigscreen/BigScreenSearchOverlay";
import { ConfirmModal } from "./ui";
import { useGamepad } from "../hooks/GamepadProvider";
import { useLanguage } from "../context/LanguageContext";
import {
  isBigScreenOverlayOpen,
  useBigScreen,
} from "../context/BigScreenContext";
import {
  BACK_PRIORITY_SHELL,
  isNavigable,
} from "../hooks/gamepad/gamepadUtils";
import { bigScreenParentOf } from "../bigscreen/registry";
import { useBumperScope } from "./bigscreen/bigscreenLegend";
import {
  recallFocus,
  rememberFocus,
  focusSelectorForKey,
} from "../utils/focusMemory";

/** Keyboard arrow keys map onto the same spatial-navigation engine as
 *  the D-pad / left stick. */
const ARROW_DIRECTIONS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Skip arrow handling while the user is editing a form control. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest("input, textarea, select, [contenteditable]");
}

/**
 * Live clock + brand for the bottom bar, plus the controller legend.
 *
 * The legend describes the ACTIVE screen, not the shell in general:
 *   • B reads Back when a parent route exists, Exit on a top-level
 *     screen — it mirrors `bigScreenParentOf`, which is exactly the
 *     decision the shell's own back handler makes.
 *   • LB/RB reads Sections or Tabs from the mounted page's declaration
 *     (see bigscreenLegend.ts), so a tabbed screen can't inherit the
 *     strip's wording.
 * This bar is the single affordance telling a couch user what the
 * buttons do, so a stale word here is a real bug, not a nit.
 */
function BottomBar() {
  const { t, language } = useLanguage();
  const { pathname } = useLocation();
  const bumperScope = useBumperScope();
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      setTime(new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [language]);

  const hasParent = bigScreenParentOf(pathname) !== null;

  return (
    <div className="bigscreen-v3-bottom-bar" aria-hidden="true">
      <span className="bigscreen-v3-bottom-brand">GAMEINDEX</span>
      <div className="bigscreen-v3-bottom-legend">
        <span className="bigscreen-v3-bottom-tip">
          <b>A</b>
          {t("bigscreen.shell.selectHint")}
        </span>
        <span className="bigscreen-v3-bottom-tip">
          <b>B</b>
          {t(hasParent ? "bigscreen.shell.backHint" : "bigscreen.shell.exitHint")}
        </span>
        <span className="bigscreen-v3-bottom-tip">
          <b>LB</b>
          <b>RB</b>
          {t(
            bumperScope === "tabs"
              ? "bigscreen.shell.tabsHint"
              : "bigscreen.shell.sectionsHint",
          )}
        </span>
        <span className="bigscreen-v3-bottom-tip">
          <b>Y</b>
          {t("bigscreen.shell.pointerHint")}
        </span>
      </div>
      <span className="bigscreen-v3-bottom-clock">{time}</span>
    </div>
  );
}

export default function BigScreenLayout() {
  const gamepad = useGamepad();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const {
    exitConfirmOpen,
    requestExit,
    cancelExit,
    setBigScreen,
  } = useBigScreen();
  const [searchOpen, setSearchOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // The focusin listener below is registered once; it reads the live
  // pathname from a ref so rapid navigation can't attribute a focus
  // event to a stale route.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  // Shell-owned Back resolver. Pages no longer need to register a
  // handler just to bounce out of a nested route: with none mounted
  // (or none at page priority), B walks up one level via the route
  // table, or offers the exit confirmation on a top-level screen.
  // A page's own handler (default priority 0) still outranks this (-100).
  useEffect(() => {
    return gamepad.registerBackHandler(() => {
      const parent = bigScreenParentOf(location.pathname);
      if (parent) navigate(parent);
      else requestExit();
    }, BACK_PRIORITY_SHELL);
  }, [
    gamepad.registerBackHandler,
    location.pathname,
    navigate,
    requestExit,
  ]);

  // Remember which element the controller (or keyboard) is on for the
  // current route, so returning later restores it. See focusMemory.ts.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      rememberFocus(pathnameRef.current, event.target as Element);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // Arrow keys drive the same spatial-navigation engine as the
  // gamepad, including hold-to-repeat (native key auto-repeat) and
  // controlled scrolling. Overlays and text fields keep the arrows.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }
      const direction = ARROW_DIRECTIONS[event.key];
      if (!direction) return;
      if (isEditableTarget(event.target)) return;
      if (isBigScreenOverlayOpen()) return;
      event.preventDefault();
      gamepad.navigate(direction, event.repeat);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [gamepad.navigate]);

  // Replay the shell's content-in animation on every route change so
  // page switches read as a fast console transition rather than a cut.
  // The base frame rule already carries the same animation, so we
  // clear it inline for one frame to force a genuine restart.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.classList.add("bigscreen-page-enter");
    frame.style.animation = "none";
    // Force a reflow so clearing the override restarts the animation.
    void frame.offsetWidth;
    frame.style.animation = "";
  }, [location.pathname]);

  // "/" opens the search overlay (unless typing or already open).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || searchOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      setSearchOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  // Navigating away closes the overlay.
  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  // Move focus into the content area after every route change (and on
  // initial mount) so the controller never snaps back to the header
  // strip when a page unmounts. A page may place its own focus first
  // in a child effect (the game hub focuses its primary action); we
  // respect that by skipping when the active element is already inside
  // the content frame. Overlays (search, modals, lightbox) keep focus.
  //
  // Before falling back to "first focusable", we try to restore the
  // element the user was on the last time they were on this route
  // (focusMemory), which makes back-navigation land on the same card.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (isBigScreenOverlayOpen()) return;
      const main = mainRef.current;
      if (!main) return;
      if (main.contains(document.activeElement)) return;

      const remembered = recallFocus(location.pathname);
      if (remembered) {
        // Game cards are restored through a shell event so virtualized
        // grids and rails can scroll the card into view themselves.
        if (remembered.startsWith("game:")) {
          window.dispatchEvent(
            new CustomEvent("bigscreen:focus-game", {
              detail: remembered.slice("game:".length),
            }),
          );
          return;
        }
        const target = document.querySelector<HTMLElement>(
          focusSelectorForKey(remembered),
        );
        if (target && isNavigable(target)) {
          target.focus({ preventScroll: true });
          return;
        }
      }

      // Last resort: pick the first registered focusable the engine
      // actually knows about. A raw `querySelector('[tabindex="0"]')`
      // can land on an element `registerAction` never saw, leaving
      // `focusedRef` unsynced and D-pad navigation dead — `focusFirst`
      // can't, because it only ever picks registered elements.
      gamepad.focusFirst(main);
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname]);

  // Mirror the mode flag onto <html> so rem-based Big Screen scaling
  // (bigscreen.css `[data-bigscreen="true"] { font-size }`) resolves.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-bigscreen", "true");
    return () => root.removeAttribute("data-bigscreen");
  }, []);

  return (
    <div className="bigscreen-v2 bigscreen-v3" data-bigscreen="true">
      <BigScreenHeader onOpenSearch={() => setSearchOpen(true)} />

      <main
        ref={mainRef}
        className="bigscreen-v3-main"
        aria-label="Big Screen content"
      >
        <div ref={frameRef} className="bigscreen-v3-content-frame">
          <Outlet />
        </div>
      </main>

      <BottomBar />

      <VirtualCursor gamepad={gamepad} />
      <BigScreenSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      <ConfirmModal
        open={exitConfirmOpen}
        title={t("bigscreen.exitConfirm.title")}
        message={t("bigscreen.exitConfirm.message")}
        confirmLabel="bigscreen.exitConfirm.confirm"
        onConfirm={() => {
          cancelExit();
          setBigScreen(false);
        }}
        onCancel={cancelExit}
      />
    </div>
  );
}
