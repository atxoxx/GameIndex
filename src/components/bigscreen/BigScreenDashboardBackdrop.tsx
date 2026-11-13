// BigScreenDashboardBackdrop — full-bleed ambient backdrop shared by
// the Home and Store dashboards.
//
// Renders the current artwork plus an optional animated layer
// (SteamGridDB APNG / animated WebP). When the featured game changes,
// the previous frame stays mounted underneath while the new one fades
// in, so navigating rails never flashes the bare background.
//
// The component is presentational: callers resolve the URLs through
// `useGameBackdropArt` and pass the selected game id as `artKey`.

import { useEffect, useRef, useState } from "react";

export interface BigScreenDashboardBackdropProps {
  /** Best always-available static hero/banner/cover. */
  staticUrl?: string | null;
  /** Animated hero art layered on top once decoded. */
  animatedUrl?: string | null;
  /** Identity of the artwork; a change triggers the cross-fade. */
  artKey?: string | number | null;
}

interface BackdropLayer {
  key: string;
  staticUrl: string;
  animatedUrl: string | null;
}

function BackdropImage({ layer }: { layer: BackdropLayer }) {
  const [staticFailed, setStaticFailed] = useState(false);
  const [animatedLoaded, setAnimatedLoaded] = useState(false);
  const [animatedFailed, setAnimatedFailed] = useState(false);

  useEffect(() => {
    setStaticFailed(false);
    setAnimatedLoaded(false);
    setAnimatedFailed(false);
  }, [layer.staticUrl, layer.animatedUrl]);

  return (
    <>
      {!staticFailed ? (
        <img
          className="bigscreen-dashboard-backdrop-img"
          src={layer.staticUrl}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => setStaticFailed(true)}
        />
      ) : null}
      {layer.animatedUrl && !animatedFailed ? (
        <img
          className={`bigscreen-dashboard-backdrop-animated${animatedLoaded ? " is-loaded" : ""}`}
          src={layer.animatedUrl}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={() => setAnimatedLoaded(true)}
          onError={() => setAnimatedFailed(true)}
        />
      ) : null}
    </>
  );
}

export default function BigScreenDashboardBackdrop({
  staticUrl,
  animatedUrl = null,
  artKey,
}: BigScreenDashboardBackdropProps) {
  const key = artKey != null ? String(artKey) : (staticUrl ?? "");
  const currentRef = useRef<BackdropLayer | null>(null);
  const [current, setCurrent] = useState<BackdropLayer | null>(null);
  const [previous, setPrevious] = useState<BackdropLayer | null>(null);

  useEffect(() => {
    if (!staticUrl) {
      currentRef.current = null;
      setCurrent(null);
      setPrevious(null);
      return;
    }

    const next: BackdropLayer = {
      key,
      staticUrl,
      animatedUrl: animatedUrl ?? null,
    };
    const prev = currentRef.current;
    currentRef.current = next;

    if (prev && prev.key === key) {
      // Same art identity (e.g. the animated layer just resolved) —
      // update in place so the animated image can fade in over the
      // already-painted static layer.
      setCurrent(next);
      return;
    }

    if (prev) setPrevious(prev);
    setCurrent(next);
  }, [key, staticUrl, animatedUrl]);

  // Safety net for reduced-motion (the CSS entry animation is
  // suppressed, so `animationend` never fires to drop the old layer).
  useEffect(() => {
    if (!previous) return;
    const timer = window.setTimeout(() => setPrevious(null), 1200);
    return () => window.clearTimeout(timer);
  }, [previous]);

  if (!current) return null;

  return (
    <div className="bigscreen-dashboard-backdrop-container" aria-hidden>
      {previous ? (
        <div className="bigscreen-dashboard-backdrop-layer">
          <BackdropImage layer={previous} />
        </div>
      ) : null}
      <div
        key={current.key}
        className="bigscreen-dashboard-backdrop-layer animate-fade-in"
        onAnimationEnd={() => setPrevious(null)}
      >
        <BackdropImage layer={current} />
      </div>
      <div className="bigscreen-dashboard-backdrop-overlay" />
    </div>
  );
}
