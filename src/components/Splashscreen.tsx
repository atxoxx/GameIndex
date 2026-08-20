import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { useSplash } from "../context/SplashContext";
import type { LaunchStep } from "../context/SplashContext";
import type { Game } from "../types/game";
import { useLanguage } from "../context/LanguageContext";
import { Button } from "./ui/Button";

/**
 * Minimum visibility before fade-out begins. Holds the splash long
 * enough that the user actually reads "Game is launching" instead
 * of seeing a flash.
 */
const MIN_VISIBILITY_MS = 1400;
const FADE_OUT_MS = 250;
/** Time between visible launch-step advances, so a burst of fast
 *  backend checkpoints still eases in one readable step at a time. */
const STEP_INTERVAL_MS = 600;
/** Fallback advance if the backend stops emitting progress (e.g. a hung
 *  pre-launch script) — keeps the splash from freezing on an early step. */
const STEP_STALL_MS = 4000;
/** How long each loading tip stays on screen before rotating. */
const TIP_INTERVAL_MS = 4000;
const MAX_LAUNCH_STEP: LaunchStep = 6;

const LAUNCH_STEP_KEYS: Record<LaunchStep, string> = {
  0: "splash.resolvingPaths",
  1: "splash.preLaunchScript",
  2: "splash.elevating",
  3: "splash.startingGame",
  4: "splash.loadingAssets",
  5: "splash.companionApps",
  6: "splash.launching",
};

/** Maps Rust `launch-progress` step names to the splash's step index. */
const STEP_INDEX: Record<string, LaunchStep> = {
  resolvingPaths: 0,
  preLaunchScript: 1,
  elevating: 2,
  startingGame: 3,
  loadingAssets: 4,
  companionApps: 5,
  launching: 6,
};

/** Progress-bar target percentage per launch step. The bar eases toward
 *  these continuously (never jumping) and only reaches 100% once the
 *  watcher confirms the game actually started. */
const STEP_PCT: Record<LaunchStep, number> = {
  0: 12,
  1: 26,
  2: 40,
  3: 55,
  4: 70,
  5: 84,
  6: 96,
};

/** Rotating tips shown during longer launches. i18n keys. */
const TIPS = ["splash.tip1", "splash.tip2", "splash.tip3"];

/** Sample an image's average color as an "r, g, b" string, or null when
 *  the image can't be read. Used to tint the splash backdrop to match
 *  the game's hero art. */
function sampleAverageColor(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Remote hero art needs a CORS request before getImageData() can read
    // its pixels; data:/same-origin URLs don't. A CORS-blocked image
    // degrades gracefully to no accent tint (null).
    if (/^https?:\/\//i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (n === 0) return resolve(null);
        resolve(`${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Splashscreen — pure in-process overlay rendered at the top level of
 * the Tauri main window. It reads its data from the SplashContext
 * (a single shared React state), renders nothing when no record is
 * set, and self-closes its CSS fade + React unmount when status
 * flips to "started" via the useSplash().close() callback. Failures
 * stay open so the user can read the error and retry.
 */
export default function Splashscreen() {
  const { record, close, updateLaunchStep } = useSplash();
  const { t } = useLanguage();

  const cardRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const displayPctRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const recordRef = useRef(record);
  recordRef.current = record;

  const targetStepRef = useRef<LaunchStep>(0);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScheduledStartedAtRef = useRef<number | null>(null);
  const lastResetRef = useRef<number | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const [accent, setAccent] = useState<string | null>(null);
  const [tipIndex, setTipIndex] = useState(0);

  // ── Event-driven launch steps ──────────────────────────────────────
  // Rust emits "launch-progress" checkpoints as the launch advances.
  // The visible step eases toward the highest checkpoint seen, one step
  // per STEP_INTERVAL_MS, so fast checkpoints still read in sequence.
  const startAnimator = useCallback(() => {
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    const tick = () => {
      const rec = recordRef.current;
      if (!rec || rec.status !== "launching") return;
      if (rec.launchStep < targetStepRef.current) {
        updateLaunchStep(Math.min(rec.launchStep + 1, MAX_LAUNCH_STEP) as LaunchStep);
      }
      stepTimerRef.current = setTimeout(tick, STEP_INTERVAL_MS);
    };
    stepTimerRef.current = setTimeout(tick, STEP_INTERVAL_MS);
  }, [updateLaunchStep]);

  const resetStall = useCallback(() => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = setTimeout(() => {
      const rec = recordRef.current;
      if (!rec || rec.status !== "launching") return;
      if (targetStepRef.current < MAX_LAUNCH_STEP) {
        targetStepRef.current = (targetStepRef.current + 1) as LaunchStep;
      }
      resetStall();
    }, STEP_STALL_MS);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenFn: (() => void) | undefined;
    const setup = listen<{ gameId: string; step: string }>(
      "launch-progress",
      (event) => {
        const rec = recordRef.current;
        if (!rec || rec.game.id !== event.payload.gameId) return;
        const idx = STEP_INDEX[event.payload.step];
        if (idx === undefined || idx <= targetStepRef.current) return;
        targetStepRef.current = idx;
        resetStall();
      }
    );
    setup.then((fn) => {
      if (disposed) fn();
      else unlistenFn = fn;
    });
    return () => {
      disposed = true;
      unlistenFn?.();
    };
  }, [resetStall]);

  // Reset step state on a fresh launch (new `startedAt`).
  useEffect(() => {
    if (!record) return;
    if (lastResetRef.current !== record.startedAt) {
      lastResetRef.current = record.startedAt;
      targetStepRef.current = 0;
      displayPctRef.current = 0;
      if (fillRef.current) fillRef.current.style.width = "0%";
      startAnimator();
      resetStall();
    }
  }, [record, startAnimator, resetStall]);

  // ── Real loading progression ───────────────────────────────────────
  // The bar eases toward the current step's target percentage with a
  // decelerating rAF tween instead of snapping between fixed values, so
  // it reads as a genuine loader. It freezes on failure and only reaches
  // 100% once the watcher confirms the game actually started.
  useEffect(() => {
    if (!record) return;
    if (record.status === "error") return;
    const target =
      record.status === "started" ? 100 : STEP_PCT[record.launchStep];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayPctRef.current = target;
      if (fillRef.current) fillRef.current.style.width = `${target}%`;
      barRef.current?.setAttribute("aria-valuenow", String(Math.round(target)));
      return;
    }
    const animate = () => {
      const cur = displayPctRef.current;
      const diff = target - cur;
      const next = Math.abs(diff) < 0.05 ? target : cur + diff * 0.085;
      displayPctRef.current = next;
      if (fillRef.current) fillRef.current.style.width = `${next}%`;
      barRef.current?.setAttribute("aria-valuenow", String(Math.round(next)));
      if (next !== target) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [record]);

  useEffect(() => {
    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Lifecycle: on "started", enforce the min-visibility hold then fade
  // out. "error" stays open so the user can read the message and retry.
  useEffect(() => {
    if (!record) return;
    if (record.status !== "started") return;
    if (lastScheduledStartedAtRef.current === record.startedAt) return;
    lastScheduledStartedAtRef.current = record.startedAt;

    const elapsed = Date.now() - record.startedAt;
    const holdMs = Math.max(0, MIN_VISIBILITY_MS - elapsed);
    const id = setTimeout(() => beginClose(), holdMs);
    return () => clearTimeout(id);
    // close / beginClose deliberately omitted — they're stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  // ── Focus management: trap focus in the card, Esc to dismiss ───────
  useEffect(() => {
    const isOpen = record !== null;
    if (isOpen && !wasOpenRef.current) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      cardRef.current?.focus();
    } else if (!isOpen && wasOpenRef.current) {
      prevFocusRef.current?.focus?.();
      prevFocusRef.current = null;
    }
    wasOpenRef.current = isOpen;
  }, [record]);

  useEffect(() => {
    if (!record) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !card.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !card.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [record, close]);

  // ── Dominant-color backdrop ────────────────────────────────────────
  const heroSrc = record?.game.bannerUrl || record?.game.coverArtUrl || null;
  useEffect(() => {
    if (!heroSrc) {
      setAccent(null);
      return;
    }
    let cancelled = false;
    sampleAverageColor(heroSrc).then((color) => {
      if (!cancelled) setAccent(color);
    });
    return () => {
      cancelled = true;
    };
  }, [heroSrc]);

  // ── Rotating loading tips ──────────────────────────────────────────
  const startedAt = record?.startedAt ?? null;
  useEffect(() => {
    if (startedAt === null) return;
    setTipIndex(0);
    const id = setInterval(
      () => setTipIndex((i) => (i + 1) % TIPS.length),
      TIP_INTERVAL_MS
    );
    return () => clearInterval(id);
  }, [startedAt]);

  // Begin fade-out CSS class flip, then teardown the React subtree.
  const beginClose = () => {
    const root = document.querySelector(".splashscreen-root");
    if (root) {
      root.classList.remove("splashscreen-fading");
      root.classList.add("splashscreen-fading");
    }
    fadeTimerRef.current = setTimeout(() => close(), FADE_OUT_MS);
  };

  // Render nothing when there's no active launch in flight.
  if (!record) return null;

  const game: Game = record.game;

  return (
    <div
      className="splashscreen-root"
      style={
        accent
          ? ({ "--splash-accent": accent } as CSSProperties)
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-label={t("splash.launchingName", { name: game.name })}
    >
      <div
        className="splashscreen-card animate-scale-up"
        ref={cardRef}
        tabIndex={-1}
      >
        {/* Progress bar eased toward the current launch step */}
        <div
          className="splashscreen-progress"
          ref={barRef}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          aria-label={t("splash.progressAria")}
        >
          <div
            ref={fillRef}
            className={[
              "splashscreen-progress-fill",
              record.status === "error" ? "splashscreen-progress-fill--error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ width: "0%" }}
          />
        </div>

        {/* Hero artwork + gradient fallback */}
        <div className="splashscreen-hero">
          {game.bannerUrl || game.coverArtUrl ? (
            <img
              src={game.bannerUrl || game.coverArtUrl!}
              alt=""
              className="splashscreen-hero-img"
            />
          ) : (
            <div className="splashscreen-hero-gradient" />
          )}
          <div className="splashscreen-hero-fade" />

          {game.logoUrl ? (
            <img
              src={game.logoUrl}
              alt={game.name}
              className="splashscreen-logo"
            />
          ) : (
            <h2 className="splashscreen-title-only">{game.name}</h2>
          )}

          {game.platform && (
            <span className="splashscreen-platform">{game.platform}</span>
          )}
        </div>

        {/* Title block under the hero */}
        <div className="splashscreen-title-block">
          {game.logoUrl && (
            <h2 className="splashscreen-title">{game.name}</h2>
          )}
          {(game.developer || game.publisher) && (
            <span className="splashscreen-subtitle">
              {[game.developer, game.publisher].filter(Boolean).join(" • ")}
            </span>
          )}
        </div>

        {/* Rotating loading tip — only while the launch is in flight */}
        {record.status === "launching" && (
          <div className="splashscreen-tip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
            </svg>
            <span>{t(TIPS[tipIndex])}</span>
          </div>
        )}

        {/* Status pill — drives the user's focus while the splash is up */}
        <div className="splashscreen-status" aria-live="polite">
          <span
            className={[
              "splashscreen-status-dot",
              record.status === "error" ? "splashscreen-status-dot--error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <span className="splashscreen-status-text">
            {record.status === "started"
              ? t("splash.launching")
              : record.status === "error"
                ? t("splash.launchFailed")
                : t(LAUNCH_STEP_KEYS[record.launchStep])}
            {record.status === "launching" && (
              <span className="splashscreen-status-dots" aria-hidden="true">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            )}
          </span>
          {record.status === "launching" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              className="splashscreen-cancel-btn"
            >
              {t("splash.cancel")}
            </Button>
          )}
        </div>

        {/* Error state: message + retry/cancel. Stays open until dismissed. */}
        {record.status === "error" && (
          <div className="splashscreen-error">
            {record.errorMessage && (
              <p className="splashscreen-error-message">{record.errorMessage}</p>
            )}
            <div className="splashscreen-error-actions">
              {record.retry && (
                <Button size="sm" onClick={record.retry}>
                  {t("splash.retry")}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={close}>
                {t("splash.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
