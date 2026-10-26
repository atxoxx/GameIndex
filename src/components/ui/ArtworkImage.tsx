import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes, type Ref } from "react";

/**
 * Shared IntersectionObserver for every artwork image on screen. One observer
 * for the whole app keeps the listener/observer count flat no matter how many
 * cards are mounted, and the WeakMap means unmounted elements are collected
 * without explicit cleanup.
 */
const listeners = new WeakMap<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | null = null;

function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          listeners.get(entry.target)?.(entry.isIntersecting);
        }
      },
      // Start decoding a little before the image enters the viewport so the
      // card is painted, not empty, by the time it is seen.
      { rootMargin: "400px 0px", threshold: 0 }
    );
  }
  return observer;
}

interface ArtworkImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "loading"> {
  src?: string | null;
  /** How long an off-screen image keeps its decoded bitmap before unloading (ms). */
  unloadDelay?: number;
  /** Never unload — for images that must stay decoded (lightbox, modals). */
  keepLoaded?: boolean;
  ref?: Ref<HTMLImageElement>;
}

/**
 * An `<img>` for artwork that loads when it scrolls into view and releases its
 * decoded bitmap once it has been off-screen for a moment.
 *
 * WebKitGTK keeps decoded image data alive for as long as the `<img>` carries a
 * `src`; a large library mounts hundreds of full-resolution covers, and the
 * render process grows into gigabytes. Clearing the attribute on scroll-out
 * drops the decoded image (and, with the minimal WebKit cache model the app
 * sets on Linux, the cached resource with it), then restores it on scroll-in.
 */
export function ArtworkImage({
  src,
  unloadDelay = 1500,
  keepLoaded = false,
  ref: externalRef,
  alt = "",
  ...rest
}: ArtworkImageProps) {
  const localRef = useRef<HTMLImageElement | null>(null);
  const observerSupported = typeof IntersectionObserver !== "undefined";
  // Without an observer we cannot know visibility, so load immediately.
  const [inView, setInView] = useState(!observerSupported);
  const [showSrc, setShowSrc] = useState(!observerSupported);

  const setRef = useCallback(
    (node: HTMLImageElement | null) => {
      localRef.current = node;
      if (typeof externalRef === "function") externalRef(node);
      else if (externalRef) (externalRef as { current: HTMLImageElement | null }).current = node;
    },
    [externalRef]
  );

  useEffect(() => {
    if (keepLoaded) {
      setInView(true);
      return;
    }
    const el = localRef.current;
    const obs = ensureObserver();
    if (!el || !obs) {
      setInView(true);
      return;
    }
    const handle = (visible: boolean) => setInView(visible);
    listeners.set(el, handle);
    obs.observe(el);
    return () => {
      listeners.delete(el);
      obs.unobserve(el);
    };
  }, [keepLoaded]);

  // Load the moment the image is in view; hold the decoded bitmap briefly after
  // it leaves, then release it. The delay avoids churn during fast scrolling.
  useEffect(() => {
    if (keepLoaded || inView) {
      setShowSrc(true);
      return;
    }
    const timer = window.setTimeout(() => setShowSrc(false), unloadDelay);
    return () => window.clearTimeout(timer);
  }, [inView, keepLoaded, unloadDelay]);

  return <img ref={setRef} src={showSrc ? src ?? undefined : undefined} alt={alt} loading="eager" decoding="async" {...rest} />;
}
