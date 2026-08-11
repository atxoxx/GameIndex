import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const FLASH_CLASS = "settings-flash";

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
 * section ids in `sectionIds`, scrolls that section into view and
 * briefly flashes an accent ring around it. The returned `target` lets
 * callers react too (e.g. auto-expanding an accordion tile before the
 * scroll lands).
 *
 * One navigation path: jump-bar chips, search results and direct
 * deep-links all go through the URL, so back/refresh/forward all behave.
 * Under `prefers-reduced-motion` the flash is skipped entirely (it is a
 * motion effect) and the scroll is instant.
 */
export function useSectionScroll(sectionIds: readonly string[]) {
  const [searchParams] = useSearchParams();
  const target = searchParams.get("section");

  useEffect(() => {
    if (!target || !sectionIds.includes(target)) return;
    const el = document.getElementById(target);
    if (!el) return;

    const reduced = prefersReducedMotion();
    if (!reduced) el.classList.add(FLASH_CLASS);

    // Defer a frame so the tab content has mounted and laid out.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(raf);
    // Re-run whenever the target section changes (including first mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return target;
}
