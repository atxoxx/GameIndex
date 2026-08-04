import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import BigScreenHeader from "./BigScreenHeader";
import FocusRing from "./ui/FocusRing";
import VirtualCursor from "./ui/VirtualCursor";
import GamepadHint from "./ui/GamepadHint";
import BigScreenSearchOverlay from "./bigscreen/BigScreenSearchOverlay";
import { useGamepad } from "../hooks/GamepadProvider";

export default function BigScreenLayout() {
  const gamepad = useGamepad();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);

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

  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  return (
    <div className="bigscreen-v2" data-bigscreen="true">
      <BigScreenHeader onOpenSearch={() => setSearchOpen(true)} />

      <main className="bigscreen-v2-main" aria-label="Big Screen content">
        <div className="bigscreen-v2-content-frame">
          <Outlet />
        </div>
      </main>

      <div className="bigscreen-v2-bottom-bar" aria-hidden="true">
        <span className="bigscreen-v2-bottom-brand">GAME LIBRARY</span>
        <span className="bigscreen-v2-bottom-tip"><b>A</b> SELECT</span>
        <span className="bigscreen-v2-bottom-tip"><b>B</b> BACK</span>
        <span className="bigscreen-v2-bottom-tip"><b>LB</b><b>RB</b> SECTIONS</span>
        <span className="bigscreen-v2-bottom-tip"><b>Y</b> POINTER</span>
      </div>

      <FocusRing gamepad={gamepad} />
      <VirtualCursor gamepad={gamepad} />
      <GamepadHint gamepad={gamepad} />
      <BigScreenSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
