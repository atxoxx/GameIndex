import { useEffect } from "react";
import { useOverlay } from "../context/OverlayContext";
import OverlayTicker from "../components/overlay/OverlayTicker";
import OverlayPanel from "../components/overlay/OverlayPanel";

/**
 * OverlayPage — the overlay's ticker ↔ panel switcher.
 *
 * Collapsed shows the compact ticker (click to expand); expanded shows the
 * interactive panel. Esc collapses while the panel is open.
 */
export default function OverlayPage() {
  const { collapsed, collapse } = useOverlay();

  useEffect(() => {
    if (collapsed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        collapse();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, collapse]);

  return collapsed ? <OverlayTicker /> : <OverlayPanel />;
}
