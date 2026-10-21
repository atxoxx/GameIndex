import { Gamepad2 } from "lucide-react";
import WindowControls from "../WindowControls";

/**
 * Slim title bar for the popout `game-detail` window.
 *
 * The window is frameless like the main one, so it needs its own drag region
 * and window buttons. It deliberately stays generic ("GameIndex"): the page
 * below already names the game, and the native taskbar title carries the
 * specific name set by the backend command.
 */
export default function GameDetailTitleBar() {
  return (
    <div className="game-detail-titlebar" data-tauri-drag-region>
      <div className="game-detail-titlebar__brand" data-tauri-drag-region>
        <Gamepad2 size={14} aria-hidden="true" />
        <span>GameIndex</span>
      </div>
      <WindowControls />
    </div>
  );
}
