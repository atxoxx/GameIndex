import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

const FLASH_CLASS = "settings-flash";
const FLASH_MS = 1700;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * useSectionScroll — URL-driven deep-linking inside a settings tab.
 *
 * Reads the `?section=` query param and, whenever it names one of the
 * section ids in `sectionIds`, scrolls that section into view and briefly
 * flashes an accent ring around it. `?highlight=<id>` additionally flashes
 * the exact row a search result pointed at, so a jump to "download folder"
 * lands on the control rather than the top of its card.
 *
 * One navigation path: search results and direct deep-links all go through
 * the URL, so back/refresh/forward all behave. The location key is a
 * dependency as well, so searching for the same destination twice replays
 * the scroll/flash instead of silently doing nothing.
 *
 * Under `prefers-reduced-motion` the flash is skipped entirely (it is a
 * motion effect) and the scroll is instant.
 */
export function useSectionScroll(sectionIds: readonly string[]) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const target = searchParams.get("section");
  const highlight = searchParams.get("highlight");

  useEffect(() => {
    if (!target || !sectionIds.includes(target)) return;

    const reduced = prefersReducedMotion();
    const startedAt = performance.now();
    let frame = 0;
    let cancelled = false;
    let clearFlash: number | undefined;

    // Tabs are lazy chunks, so on a deep-link the section element can appear
    // a few frames after the page mounts. Poll for it briefly instead of
    // giving up on the first paint, then scroll + flash once it exists.
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(target);
      if (el) {
        if (!reduced) {
          el.classList.remove(FLASH_CLASS);
          void el.offsetWidth;
          el.classList.add(FLASH_CLASS);
          clearFlash = window.setTimeout(
            () => el.classList.remove(FLASH_CLASS),
            FLASH_MS,
          );
        }
        el.scrollIntoView({
          behavior: reduced ? "auto" : "smooth",
          block: "start",
        });
        return;
      }
      if (performance.now() - startedAt < 2000) {
        frame = requestAnimationFrame(tryScroll);
      }
    };

    frame = requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (clearFlash) window.clearTimeout(clearFlash);
    };
    // Re-run whenever the target section or the navigation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, location.key]);

  useEffect(() => {
    if (!highlight) return;
    const reduced = prefersReducedMotion();
    const startedAt = performance.now();
    let frame = 0;
    let cancelled = false;
    let clearFlash: number | undefined;

    const tryFlash = () => {
      if (cancelled) return;
      const row = document.getElementById(highlight);
      if (row) {
        if (!reduced) {
          row.classList.remove(FLASH_CLASS);
          void row.offsetWidth;
          row.classList.add(FLASH_CLASS);
          clearFlash = window.setTimeout(
            () => row.classList.remove(FLASH_CLASS),
            FLASH_MS,
          );
        }
        return;
      }
      if (performance.now() - startedAt < 2500) {
        frame = requestAnimationFrame(tryFlash);
      }
    };

    frame = requestAnimationFrame(tryFlash);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (clearFlash) window.clearTimeout(clearFlash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, location.key]);

  return target;
}
