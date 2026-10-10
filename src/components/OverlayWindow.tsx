import { useEffect } from "react";
import { ThemeProvider } from "../context/ThemeContext";
import { LanguageProvider } from "../context/LanguageContext";
import { ToastProvider } from "../context/ToastContext";
import { SplashProvider } from "../context/SplashContext";
import { GameProvider } from "../context/GameContext";
import { ActivityProvider } from "../context/ActivityContext";
import { AchievementProvider } from "../context/AchievementContext";
import { SessionNotesProvider } from "../context/SessionNotesContext";
import { DownloadProvider } from "../context/DownloadContext";
import { SettingsProvider } from "../context/SettingsContext";
import { OverlayProvider } from "../context/OverlayContext";
import OverlayPage from "../pages/OverlayPage";
import ResizeHandles from "./ResizeHandles";
import { GameAccentSync } from "./GameAccentSync";
// Only the styles the overlay actually needs — the full App.css barrel
// would drag every page stylesheet into this short-lived window.
import "../styles/theme.css";
import "../styles/themes.css";
import "../styles/ui.css";
import "../styles/ui-styles/index.css";
import "../styles/overlay.css";

/**
 * OverlayWindow — entry mounted by the `overlay` webview.
 *
 * Mounts a reduced provider tree (never the full App) covering exactly what
 * the widgets read from: theming, language, toasts, the game/activity/
 * achievement/session-notes/download/settings stores, and the overlay's own
 * state. SplashProvider is included because GameProvider reads `useSplash`
 * (the overlay itself never opens a splash).
 */
export default function OverlayWindow() {
  // The Tauri window is transparent, so the body must be too or the default
  // app background would paint the whole rectangle behind the widgets.
  useEffect(() => {
    document.body.classList.add("overlay-window");
    return () => document.body.classList.remove("overlay-window");
  }, []);

  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <SplashProvider>
            <GameProvider>
              <ActivityProvider>
                <AchievementProvider>
                  <SessionNotesProvider>
                    <DownloadProvider>
                      <SettingsProvider>
                        <GameAccentSync />
                        <OverlayProvider>
                          <OverlayPage />
                          <ResizeHandles />
                        </OverlayProvider>
                      </SettingsProvider>
                    </DownloadProvider>
                  </SessionNotesProvider>
                </AchievementProvider>
              </ActivityProvider>
            </GameProvider>
          </SplashProvider>
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
