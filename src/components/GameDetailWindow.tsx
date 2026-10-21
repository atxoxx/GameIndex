import { lazy, Suspense, useEffect } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { ThemeProvider } from "../context/ThemeContext";
import { LanguageProvider, useLanguage } from "../context/LanguageContext";
import { ToastProvider } from "../context/ToastContext";
import { SplashProvider } from "../context/SplashContext";
import { GameProvider, useGames } from "../context/GameContext";
import { ActivityProvider } from "../context/ActivityContext";
import { AchievementProvider } from "../context/AchievementContext";
import { DensityProvider } from "../context/DensityContext";
import { LibraryFilterProvider } from "../context/LibraryFilterContext";
import { ShelfProvider } from "../context/ShelfContext";
import { WishlistProvider } from "../context/WishlistContext";
import { SourceProvider } from "../context/SourceContext";
import { DownloadProvider } from "../context/DownloadContext";
import { SavesProvider } from "../context/SavesContext";
import { SettingsProvider } from "../context/SettingsContext";
import { SessionNotesProvider } from "../context/SessionNotesContext";
import { SteamGridDbProvider } from "../context/SteamGridDbContext";
import { CrackWatchProvider } from "../context/CrackWatchContext";
import { PriceProvider } from "../context/PriceContext";
import { BigScreenProvider } from "../context/BigScreenContext";
import { PresenceProvider } from "../context/PresenceContext";
import { AdaptiveThemeSync } from "./AdaptiveThemeSync";
import { GameAccentSync } from "./GameAccentSync";
import GameDetailTitleBar from "./game/GameDetailTitleBar";
import ResizeHandles from "./ResizeHandles";
import { GamepadProvider } from "../hooks/GamepadProvider";
import LaunchSplashBridge from "./LaunchSplashBridge";
import { Skeleton } from "./ui/Skeleton";
import { isTauriRuntime } from "../utils/gameDetailWindow";
// The popout renders the same pages as the main shell, so it needs the same
// stylesheet barrel. Vite shares it with the App chunk instead of duplicating
// it; the alternative (hand-picking page styles) drifts as pages change.
import "../App.css";
import "../styles/game-detail-window.css";

const GamePage = lazy(() => import("../pages/GamePage"));
const StoreGameDetail = lazy(() => import("../pages/StoreGameDetail"));

const NAVIGATE_EVENT = "game-detail:navigate";

/** Route the backend put in the window URL (`?route=...`). */
function readInitialRoute(): string {
  const route = new URLSearchParams(window.location.search).get("route")?.trim();
  return route && route.startsWith("/") ? route : "/library";
}

const isDetailRoute = (route: string) =>
  route.startsWith("/library/") || route.startsWith("/store/");

interface NavigatePayload {
  route?: string;
}

/**
 * Applies `game-detail:navigate` from Rust: the reused window follows the
 * newest card the user asked for without being recreated.
 */
function DetailNavigator() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<NavigatePayload>(NAVIGATE_EVENT, (event) => {
      const route = event.payload?.route?.trim();
      if (route && isDetailRoute(route)) navigate(route);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* browser-mode: no IPC */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate]);

  return null;
}

function DetailWindowSkeleton() {
  return (
    <div className="game-detail-loading" aria-busy="true" role="status">
      <Skeleton shape="rect" width="100%" height="260px" />
      <Skeleton width="42%" height="2em" />
      <Skeleton width="70%" />
      <Skeleton width="58%" />
    </div>
  );
}

/**
 * The library page's detail view reads from the hydrated game list, so the
 * first paint waits for it instead of briefly showing "game not found".
 */
function LibraryDetailRoute() {
  const { gamesHydrated } = useGames();
  return gamesHydrated ? <GamePage hideBackLink /> : <DetailWindowSkeleton />;
}

function UnknownDetailRoute() {
  const { t } = useLanguage();
  return <div className="game-detail-empty">{t("game.notFoundTitle")}</div>;
}

/**
 * GameDetailWindow - entry mounted by the `game-detail` webview.
 *
 * Mounts the providers the detail pages read from, but none of the shell-only
 * bridges (Discord presence, tray navigation, update checks, gamepad, launch
 * splash mirroring). That is what keeps a popout from behaving like a second
 * instance of the app while still rendering the page exactly as it looks in
 * the main window.
 */
export default function GameDetailWindow() {
  const initialRoute = readInitialRoute();

  useEffect(() => {
    document.body.classList.add("game-detail-window-body");
    return () => document.body.classList.remove("game-detail-window-body");
  }, []);

  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <SplashProvider>
            <GameProvider>
              <ActivityProvider>
                <AchievementProvider>
                  <DensityProvider>
                    <LibraryFilterProvider>
                      <ShelfProvider>
                        <WishlistProvider>
                          <SourceProvider>
                            <DownloadProvider>
                              <SavesProvider>
                                <SettingsProvider>
                                  <SessionNotesProvider>
                                    <SteamGridDbProvider>
                                      <CrackWatchProvider>
                                        <PriceProvider>
                                          <BigScreenProvider headless>
                                            <PresenceProvider>
                                              <GamepadProvider enabled={false}>
                                                <GameAccentSync />
                                                <LaunchSplashBridge />
                                                <MemoryRouter initialEntries={[initialRoute]}>
                                                  <AdaptiveThemeSync />
                                                  <div className="game-detail-window">
                                                    <GameDetailTitleBar />
                                                    <ResizeHandles />
                                                    <main className="game-detail-window__body">
                                                      <DetailNavigator />
                                                      <Suspense fallback={<DetailWindowSkeleton />}>
                                                        <Routes>
                                                          <Route path="/library/:gameId" element={<LibraryDetailRoute />} />
                                                          <Route path="/store/:gameSlug" element={<StoreGameDetail hideBackLink />} />
                                                          <Route path="*" element={<UnknownDetailRoute />} />
                                                        </Routes>
                                                      </Suspense>
                                                    </main>
                                                  </div>
                                                </MemoryRouter>
                                              </GamepadProvider>
                                            </PresenceProvider>
                                          </BigScreenProvider>
                                        </PriceProvider>
                                      </CrackWatchProvider>
                                    </SteamGridDbProvider>
                                  </SessionNotesProvider>
                                </SettingsProvider>
                              </SavesProvider>
                            </DownloadProvider>
                          </SourceProvider>
                        </WishlistProvider>
                      </ShelfProvider>
                    </LibraryFilterProvider>
                  </DensityProvider>
                </AchievementProvider>
              </ActivityProvider>
            </GameProvider>
          </SplashProvider>
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
