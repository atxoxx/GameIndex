// Big Screen shell.
//
// Zones: top chrome (BigScreenTopBar), the section navigation
// (BigScreenNav), the content frame (`<Outlet/>`) and the controller
// legend. The layout preset decides where the nav sits and how the
// chrome is drawn; this file owns behaviour, not looks.
//
// Gamepad model (unchanged contracts):
//   • The shell owns Back: one handler at BACK_PRIORITY_SHELL resolves
//     the current route to its parent (bigScreenParentOf), or offers
//     the exit confirmation on a top-level screen. A page-level handler
//     still wins the B race while mounted.
//   • Arrow keys drive the same spatial-navigation engine as the
//     D-pad, including hold-to-repeat. Overlays keep their arrows
//     unless they opt in with `data-arrow-nav` (the Guide does).
//   • `/` opens search, `G` opens the Guide, Menu/Start toggles it.
//   • Route changes restore the element the user was on last time they
//     visited that route (focusMemory), falling back to the first
//     registered focusable in the content frame.

import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import BigScreenTopBar from "./bigscreen/shell/BigScreenTopBar";
import BigScreenNav from "./bigscreen/shell/BigScreenNav";
import BigScreenFooter from "./bigscreen/shell/BigScreenFooter";
import BigScreenGuide from "./bigscreen/shell/BigScreenGuide";
import BigScreenQuickSettings from "./bigscreen/shell/BigScreenQuickSettings";
import VirtualCursor from "./ui/VirtualCursor";
import BigScreenSearchOverlay from "./bigscreen/BigScreenSearchOverlay";
import { ConfirmModal } from "./ui";
import { useGamepad } from "../hooks/GamepadProvider";
import { useLanguage } from "../context/LanguageContext";
import {
  activeOverlayRoot,
  isBigScreenOverlayOpen,
  useBigScreen,
} from "../context/BigScreenContext";
import { useBigScreenPrefs } from "../context/BigScreenPrefsContext";
import {
  BACK_PRIORITY_SHELL,
  isNavigable,
} from "../hooks/gamepad/gamepadUtils";
import { bigScreenParentOf } from "../bigscreen/registry";
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

export default function BigScreenLayout() {
  const gamepad = useGamepad();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { prefs } = useBigScreenPrefs();
  const { exitConfirmOpen, requestExit, cancelExit, setBigScreen } =
    useBigScreen();
  const [searchOpen, setSearchOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [navEngaged, setNavEngaged] = useState(false);
  const [navReveal, setNavReveal] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const revealTimer = useRef<number | null>(null);

  // The focusin listener below is registered once; it reads the live
  // pathname from a ref so rapid navigation can't attribute a focus
  // event to a stale route.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  const revealNav = useCallback(() => {
    setNavReveal(true);
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = null;
      setNavReveal(false);
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    };
  }, []);

  // Shell-owned Back resolver: parent route → navigate up, otherwise
  // offer the exit confirmation (never drop out silently).
  useEffect(() => {
    return gamepad.registerBackHandler(() => {
      const parent = bigScreenParentOf(location.pathname);
      if (parent) navigate(parent);
      else requestExit();
    }, BACK_PRIORITY_SHELL);
  }, [gamepad.registerBackHandler, location.pathname, navigate, requestExit]);

  // Remember which element the controller (or keyboard) is on for the
  // current route, so returning later restores it.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      rememberFocus(pathnameRef.current, event.target as Element);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // Arrow keys drive the same spatial-navigation engine as the
  // gamepad, including hold-to-repeat. Overlays keep their arrows
  // unless they opt in via `data-arrow-nav`.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }
      const direction = ARROW_DIRECTIONS[event.key];
      if (!direction) return;
      if (isEditableTarget(event.target)) return;
      const overlay = activeOverlayRoot();
      if (overlay && !overlay.hasAttribute("data-arrow-nav")) return;
      event.preventDefault();
      gamepad.navigate(direction, event.repeat);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [gamepad.navigate]);

  // Replay the content-in animation on every route change so page
  // switches read as a console transition rather than a cut.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.classList.add("bigscreen-page-enter");
    frame.style.animation = "none";
    void frame.offsetWidth;
    frame.style.animation = "";
  }, [location.pathname]);

  // "/" opens search, "G" opens the Guide (unless typing or already
  // covered by another overlay).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable]")) return;
      if (event.key === "/" && !searchOpen) {
        if (isBigScreenOverlayOpen()) return;
        event.preventDefault();
        setSearchOpen(true);
      }
      if ((event.key === "g" || event.key === "G") && !isBigScreenOverlayOpen()) {
        event.preventDefault();
        setGuideOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  // Menu/Start toggles the Guide (the engine emits this window event).
  useEffect(() => {
    const onStart = () => {
      setGuideOpen((open) => !open);
      setQuickOpen(false);
    };
    window.addEventListener("bigscreen:start", onStart);
    return () => window.removeEventListener("bigscreen:start", onStart);
  }, []);

  // Navigating away closes transient overlays and re-arms the nav for
  // auto-hide layouts.
  useEffect(() => {
    setSearchOpen(false);
    setGuideOpen(false);
    setQuickOpen(false);
    revealNav();
  }, [location.pathname, revealNav]);

  // Route-entry focus: restore the remembered element, else focus the
  // first registered focusable inside the content frame (never a raw
  // querySelector, which could land on an unregistered element and
  // leave the engine desynced).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (isBigScreenOverlayOpen()) return;
      const main = mainRef.current;
      if (!main) return;
      if (main.contains(document.activeElement)) return;

      const remembered = recallFocus(location.pathname);
      if (remembered) {
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

      gamepad.focusFirst(main);
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname]);

  // Mirror the mode flags onto <html> so rem-based scaling and
  // portal-level tokens resolve outside the shell subtree.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-bigscreen", "true");
    return () => root.removeAttribute("data-bigscreen");
  }, []);

  return (
    <div
      className="bs-shell"
      data-bigscreen="true"
      data-preset={prefs.preset}
      data-nav={prefs.preset === "steam" ? "side" : "top"}
      data-nav-mode={prefs.navVisibility}
      data-nav-engaged={navEngaged ? "true" : undefined}
      data-nav-reveal={navReveal ? "true" : undefined}
    >
      <BigScreenTopBar
        onOpenSearch={() => setSearchOpen(true)}
        onOpenGuide={() => {
          setQuickOpen(false);
          setGuideOpen(true);
        }}
        onRequestExit={requestExit}
      />

      <BigScreenNav onEngagedChange={setNavEngaged} />

      <main ref={mainRef} className="bs-main" aria-label="Big Screen content">
        <div ref={frameRef} className="bs-frame bigscreen-page-enter">
          <Outlet />
        </div>
      </main>

      <BigScreenFooter />

      <VirtualCursor />

      <BigScreenSearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
      />

      <BigScreenGuide
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        onOpenQuickSettings={() => setQuickOpen(true)}
      />

      <BigScreenQuickSettings
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
      />

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
