import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { useSplash } from "../context/SplashContext";
import type { LaunchStep } from "../context/SplashContext";
import type { Game } from "../types/game";
import { formatPlayTimeCompact } from "./game/shared";
import { useLanguage } from "../context/LanguageContext";
import { Button } from "./ui/Button";

/**
 * Minimum visibility before fade-out begins. Holds the splash long
 * enough that the user actually reads "Game is launching" instead
 * of seeing an abrupt flash.
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
const TIP_INTERVAL_MS = 4500;
const MAX_LAUNCH_STEP: LaunchStep = 6;

export const LAUNCH_STEP_KEYS: Record<LaunchStep, string> = {
  0: "splash.resolvingPaths",
  1: "splash.preLaunchScript",
  2: "splash.elevating",
  3: "splash.startingGame",
  4: "splash.loadingAssets",
  5: "splash.companionApps",
  6: "splash.launching",
};

/** Maps Rust `launch-progress` step names to the splash's step index. */
export const STEP_INDEX: Record<string, LaunchStep> = {
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
export const STEP_PCT: Record<LaunchStep, number> = {
  0: 14,
  1: 28,
  2: 44,
  3: 58,
  4: 72,
  5: 86,
  6: 96,
};

/** Rotating tips shown during longer launches. i18n keys. */
export const TIPS = ["splash.tip1", "splash.tip2", "splash.tip3"];

export interface VibrantPalette {
  accent: string;
  accent2: string;
  glow: string;
}

/**
 * Pure color extraction from RGBA pixel data.
 * Filters out extreme darks, lights, and low saturation, then groups into hue bins.
 */
export function extractVibrantFromPixels(data: Uint8ClampedArray | number[]): VibrantPalette | null {
  const bins: { r: number; g: number; b: number; count: number; score: number }[] =
    Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, count: 0, score: 0 }));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;

    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const l = (max + min) / 2;

    // Discard dark shadows, overexposed whites, and low saturation
    if (l < 0.16 || l > 0.88) continue;
    const d = max - min;
    if (d < 0.18) continue;

    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (s < 0.22) continue;

    let h = 0;
    if (max === rf) {
      h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
    } else if (max === gf) {
      h = ((bf - rf) / d + 2) / 6;
    } else {
      h = ((rf - gf) / d + 4) / 6;
    }

    const binIdx = Math.floor(h * 12) % 12;
    const weight = s * 2 + (1 - Math.abs(l - 0.5) * 2);
    const bin = bins[binIdx];
    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
    bin.count += weight;
    bin.score += weight;
  }

  let bestBin = bins[0];
  for (let i = 1; i < bins.length; i++) {
    if (bins[i].score > bestBin.score) {
      bestBin = bins[i];
    }
  }

  if (bestBin.count <= 0) return null;

  const r = Math.round(bestBin.r / bestBin.count);
  const g = Math.round(bestBin.g / bestBin.count);
  const b = Math.round(bestBin.b / bestBin.count);

  // Derive harmonized accent2 by rotating hue ~35 deg and shifting lightness
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
    else if (max === gf) h = ((bf - rf) / d + 2) / 6;
    else h = ((rf - gf) / d + 4) / 6;
  }

  const h2 = (h + 35 / 360) % 1;
  const s2 = Math.min(1, Math.max(0.4, s * 0.9));
  const l2 = Math.min(0.82, Math.max(0.35, l + 0.1));

  function hue2rgb(p: number, q: number, t: number) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p = 2 * l2 - q;
  const r2 = Math.round(hue2rgb(p, q, h2 + 1 / 3) * 255);
  const g2 = Math.round(hue2rgb(p, q, h2) * 255);
  const b2 = Math.round(hue2rgb(p, q, h2 - 1 / 3) * 255);

  return {
    accent: `rgb(${r}, ${g}, ${b})`,
    accent2: `rgb(${r2}, ${g2}, ${b2})`,
    glow: `rgba(${r}, ${g}, ${b}, 0.35)`,
  };
}

/**
 * Extract a dominant vibrant color and harmonized secondary color
 * from the game's artwork. Rejects extreme darks, lights, and muddy grays.
 */
export function sampleVibrantPalette(src: string): Promise<VibrantPalette | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (val: VibrantPalette | null) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    const timer = setTimeout(() => safeResolve(null), 2500);

    const img = new Image();
    if (/^https?:\/\//i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => {
      clearTimeout(timer);
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return safeResolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        safeResolve(extractVibrantFromPixels(data));
      } catch {
        safeResolve(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      safeResolve(null);
    };
    img.src = src;
  });
}

export default function Splashscreen() {
  const { record, close, updateLaunchStep } = useSplash();
  const { t } = useLanguage();

  const cardRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const displayPctRef = useRef(0);
  const [displayPct, setDisplayPct] = useState(0);
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

  const [palette, setPalette] = useState<VibrantPalette | null>(null);
  const [tipIndex, setTipIndex] = useState(0);

  // ── Event-driven launch steps ──────────────────────────────────────
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

  // Reset step state on a fresh launch
  useEffect(() => {
    if (!record) return;
    if (lastResetRef.current !== record.startedAt) {
      lastResetRef.current = record.startedAt;
      targetStepRef.current = 0;
      displayPctRef.current = 0;
      setDisplayPct(0);
      if (fillRef.current) fillRef.current.style.width = "0%";
      startAnimator();
      resetStall();
    }
  }, [record, startAnimator, resetStall]);

  // ── Smooth loading progression with rAF ─────────────────────────────
  useEffect(() => {
    if (!record) return;
    if (record.status === "error") return;
    const target =
      record.status === "started" ? 100 : STEP_PCT[record.launchStep];

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayPctRef.current = target;
      setDisplayPct(target);
      if (fillRef.current) fillRef.current.style.width = `${target}%`;
      barRef.current?.setAttribute("aria-valuenow", String(Math.round(target)));
      return;
    }

    const animate = () => {
      const cur = displayPctRef.current;
      const diff = target - cur;
      const next = Math.abs(diff) < 0.05 ? target : cur + diff * 0.085;
      displayPctRef.current = next;
      setDisplayPct(Math.round(next));
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

  // Lifecycle hold on "started", then fade out
  useEffect(() => {
    if (!record) return;
    if (record.status !== "started") return;
    if (lastScheduledStartedAtRef.current === record.startedAt) return;
    lastScheduledStartedAtRef.current = record.startedAt;

    const elapsed = Date.now() - record.startedAt;
    const holdMs = Math.max(0, MIN_VISIBILITY_MS - elapsed);
    const id = setTimeout(() => beginClose(), holdMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  // ── Focus trapping and keyboard navigation ─────────────────────────
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

  // ── Artwork palette extraction ─────────────────────────────────────
  const heroSrc = record?.game.bannerUrl || record?.game.coverArtUrl || null;
  useEffect(() => {
    if (!heroSrc) {
      setPalette(null);
      return;
    }
    let cancelled = false;
    sampleVibrantPalette(heroSrc).then((pal) => {
      if (!cancelled) setPalette(pal);
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

  const beginClose = () => {
    const root = document.querySelector(".splashscreen-root");
    if (root) {
      root.classList.remove("splashscreen-fading");
      root.classList.add("splashscreen-fading");
    }
    fadeTimerRef.current = setTimeout(() => close(), FADE_OUT_MS);
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      close();
    }
  };

  if (!record) return null;

  const game: Game = record.game;
  const playTimeStr = game.playTime ? formatPlayTimeCompact(game.playTime) : "";
  const hasPlayTime = playTimeStr && playTimeStr !== "0h";
  const primaryGenre = game.genres && game.genres.length > 0 ? game.genres[0] : null;

  return (
    <div
      className="splashscreen-root"
      style={
        palette
          ? ({
              "--splash-accent": palette.accent,
              "--splash-accent-2": palette.accent2,
              "--splash-accent-glow": palette.glow,
            } as CSSProperties)
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-label={t("splash.launchingName", { name: game.name })}
      onClick={handleBackdropClick}
    >
      {/* Immersive ambient artwork & atmospheric mesh */}
      <div className="splashscreen-ambient-layer" aria-hidden="true">
        {heroSrc && (
          <img
            src={heroSrc}
            alt=""
            className="splashscreen-ambient-art"
          />
        )}
        <div className="splashscreen-ambient-glow-primary" />
        <div className="splashscreen-ambient-glow-secondary" />
        <div className="splashscreen-ambient-vignette" />
      </div>

      <div
        className="splashscreen-card animate-scale-up"
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle cyber corner accents */}
        <div className="splashscreen-corner splashscreen-corner--tl" aria-hidden="true" />
        <div className="splashscreen-corner splashscreen-corner--tr" aria-hidden="true" />
        <div className="splashscreen-corner splashscreen-corner--bl" aria-hidden="true" />
        <div className="splashscreen-corner splashscreen-corner--br" aria-hidden="true" />

        {/* Hero visual banner with gradient mask */}
        <div className="splashscreen-hero">
          {heroSrc ? (
            <img
              src={heroSrc}
              alt=""
              className="splashscreen-hero-img"
            />
          ) : (
            <div className="splashscreen-hero-gradient" />
          )}
          <div className="splashscreen-hero-vignette" />
          <div className="splashscreen-hero-fade" />

          {/* Top metadata badge row */}
          <div className="splashscreen-hero-top-bar">
            <div className="splashscreen-hero-badges">
              {game.platform && (
                <span className="splashscreen-badge splashscreen-badge--platform">
                  <PlatformIcon platform={game.platform} />
                  <span>{game.platform}</span>
                </span>
              )}
              {hasPlayTime && (
                <span className="splashscreen-badge splashscreen-badge--meta">
                  <ClockIcon />
                  <span>{playTimeStr}</span>
                </span>
              )}
              {primaryGenre && (
                <span className="splashscreen-badge splashscreen-badge--genre">
                  {primaryGenre}
                </span>
              )}
            </div>
          </div>

          {/* Bottom logo or display title */}
          <div className="splashscreen-hero-bottom">
            {game.logoUrl ? (
              <img
                src={game.logoUrl}
                alt={game.name}
                className="splashscreen-logo"
              />
            ) : (
              <h2 className="splashscreen-display-title">{game.name}</h2>
            )}
          </div>
        </div>

        {/* Lower interactive section */}
        <div className="splashscreen-body">
          {/* Title & subtitle credits */}
          <div className="splashscreen-info-row">
            <div className="splashscreen-info-titles">
              {game.logoUrl && (
                <h2 className="splashscreen-title">{game.name}</h2>
              )}
              {(game.developer || game.publisher) && (
                <span className="splashscreen-credits">
                  {[game.developer, game.publisher].filter(Boolean).join(" • ")}
                </span>
              )}
            </div>
          </div>

          {/* Laser Progress Section */}
          <div className="splashscreen-progress-section">
            <div className="splashscreen-progress-header">
              <div className="splashscreen-progress-label">
                <span
                  className={[
                    "splashscreen-status-indicator",
                    record.status === "error"
                      ? "splashscreen-status-indicator--error"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="splashscreen-status-ring" />
                  <span className="splashscreen-status-core" />
                </span>
                <span className="splashscreen-step-text">
                  {record.status === "started"
                    ? t("splash.launching")
                    : record.status === "error"
                      ? t("splash.launchFailed")
                      : t(LAUNCH_STEP_KEYS[record.launchStep])}
                </span>
                {record.status === "launching" && (
                  <span className="splashscreen-dots" aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                )}
              </div>
              <span className="splashscreen-progress-pct" aria-hidden="true">
                {displayPct}%
              </span>
            </div>

            {/* Glowing 6px progress track */}
            <div
              className="splashscreen-progress"
              ref={barRef}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={displayPct}
              aria-label={t("splash.progressAria")}
            >
              <div
                ref={fillRef}
                className={[
                  "splashscreen-progress-fill",
                  record.status === "error"
                    ? "splashscreen-progress-fill--error"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ width: "0%" }}
              >
                <div className="splashscreen-progress-head" />
              </div>
            </div>
          </div>

          {/* Rotating Tips pill */}
          {record.status === "launching" && (
            <div className="splashscreen-tip-pill" key={tipIndex}>
              <LightbulbIcon />
              <span className="splashscreen-tip-text">{t(TIPS[tipIndex])}</span>
            </div>
          )}

          {/* Error Alert Container */}
          {record.status === "error" && (
            <div className="splashscreen-error-alert" role="alert">
              <AlertTriangleIcon />
              <div className="splashscreen-error-content">
                <p className="splashscreen-error-message">
                  {record.errorMessage || t("splash.launchFailed")}
                </p>
              </div>
            </div>
          )}

          {/* Footer with shortcut and actions */}
          <div className="splashscreen-footer">
            <div className="splashscreen-footer-meta">
              <span className="splashscreen-shortcut-hint">
                <kbd>Esc</kbd> {t("splash.cancel")}
              </span>
            </div>
            <div className="splashscreen-footer-actions">
              {record.status === "error" && record.retry && (
                <Button
                  size="sm"
                  onClick={record.retry}
                  className="splashscreen-btn splashscreen-btn--retry"
                >
                  <RotateCwIcon />
                  <span>{t("splash.retry")}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={close}
                className="splashscreen-btn splashscreen-btn--cancel"
              >
                {t("splash.cancel")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inline SVGs ───────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="splashscreen-icon"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="splashscreen-icon splashscreen-icon--tip"
      aria-hidden="true"
    >
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-1 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="splashscreen-icon splashscreen-icon--danger"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function RotateCwIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="splashscreen-icon"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p.includes("steam")) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="splashscreen-icon"
        aria-hidden="true"
      >
        <path d="M12 2a10 10 0 0 0-10 9.77c0 .87.11 1.72.33 2.52l4.89 2.01a3.53 3.53 0 0 1 2.22-.64c.26 0 .51.03.75.08l2.7-3.92a2.98 2.98 0 0 1-.02-.3c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3c-.22 0-.44-.02-.65-.07l-3.85 2.65c.05.23.08.47.08.72 0 1.93-1.57 3.5-3.5 3.5a3.5 3.5 0 0 1-3.48-3.15L2.3 17.2A10 10 0 1 0 12 2Zm3.87 8.52a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="splashscreen-icon"
      aria-hidden="true"
    >
      <line x1="6" y1="12" x2="10" y2="12" />
      <line x1="8" y1="10" x2="8" y2="14" />
      <line x1="15" y1="13" x2="15.01" y2="13" />
      <line x1="18" y1="11" x2="18.01" y2="11" />
      <rect x="2" y="6" width="20" height="12" rx="6" />
    </svg>
  );
}
