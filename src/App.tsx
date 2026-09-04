import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
// BigScreenLayout is huge (controller shell + search overlay + virtual
// cursor) and only ever mounted when the user is actually in Big Screen
// mode, so it is lazy-loaded to keep it — and its transitive deps — out of
// the desktop initial bundle entirely.
const BigScreenLayout = lazy(() => import("./components/BigScreenLayout"));
import { BIGSCREEN_ROUTE_PAIRS, ShellSwitch } from "./bigscreen/registry";
import { GameProvider } from "./context/GameContext";
import { ToastProvider } from "./context/ToastContext";
import { ActivityProvider } from "./context/ActivityContext";
import { WishlistProvider } from "./context/WishlistContext";
import { DensityProvider } from "./context/DensityContext";
import { LibraryFilterProvider } from "./context/LibraryFilterContext";
import { SplashProvider } from "./context/SplashContext";
import { DownloadProvider } from "./context/DownloadContext";
import { SourceProvider } from "./context/SourceContext";
import { ThemeProvider } from "./context/ThemeContext";
import { AchievementProvider } from "./context/AchievementContext";
import { SettingsProvider } from "./context/SettingsContext";
import { SessionNotesProvider } from "./context/SessionNotesContext";
import { BigScreenProvider, useBigScreen } from "./context/BigScreenContext";
import { LanguageProvider } from "./context/LanguageContext";
import { PresenceProvider } from "./context/PresenceContext";
import { UpdateProvider } from "./context/UpdateContext";
import { SteamGridDbProvider } from "./context/SteamGridDbContext";
import { CrackWatchProvider } from "./context/CrackWatchContext";
import { PriceProvider } from "./context/PriceContext";
import { UpdateModal } from "./components/ui/UpdateModal";
import { UpdateNotification } from "./components/ui/UpdateNotification";
import {
  SidebarCollapseProvider,
  useSidebarCollapse,
} from "./context/SidebarCollapseContext";
import { GamepadProvider } from "./hooks/GamepadProvider";
import { useDiscordPresence } from "./hooks/useDiscordPresence";
import { useTrayNavigation } from "./hooks/useTrayNavigation";
import { useTrayStrings } from "./hooks/useTrayStrings";
import { LandingRedirect } from "./components/LandingRedirect";
import Splashscreen from "./components/Splashscreen";
import WindowReveal from "./components/WindowReveal";
import { AdaptiveThemeSync } from "./components/AdaptiveThemeSync";
import { GameAccentSync } from "./components/GameAccentSync";
import { Skeleton } from "./components/ui/Skeleton";
import "./App.css";
import "./store.css";
import "./styles/page.css";

function AppLayout() {
  const { isBigScreen } = useBigScreen();

  if (isBigScreen) {
    return <BigScreenLayout />;
  }

  return (
    <SidebarCollapseProvider>
      <AppShellLayout />
    </SidebarCollapseProvider>
  );
}

function AppShellLayout() {
  const { isIconRail } = useSidebarCollapse();

  return (
    <div className={`app-layout${isIconRail ? " sidebar-icon-rail" : ""}`}>
      <div className="app-topnav">
        <TopNav />
      </div>
      <div className={`app-sidebar${isIconRail ? " sidebar-icon-rail" : ""}`}>
        <Sidebar />
      </div>
      <div className="app-main">
        <MainContent />
      </div>
    </div>
  );
}

/**
 * PageLoadingFallback — skeleton shown while a lazy page chunk downloads
 * and parses. Replaces the previous blank <Suspense fallback={null}>
 * so navigation never flashes an empty page area: the shell (topnav +
 * sidebar) stays mounted and the content region shows a neutral grid
 * of shimmer placeholders instead of nothing.
 */
function PageLoadingFallback() {
  return (
    <div className="page-fallback" aria-busy="true" role="status">
      <div className="page-fallback__header">
        <Skeleton width="260px" height="2.4em" />
        <Skeleton width="150px" height="1.3em" />
      </div>
      <div className="page-fallback__grid">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="page-fallback__tile">
            <Skeleton shape="rect" width="100%" height="130px" />
            <Skeleton width="82%" />
            <Skeleton width="58%" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AppShell() {
  useDiscordPresence();
  useTrayNavigation();
  useTrayStrings();
  const { isBigScreen } = useBigScreen();
  return (
    <GamepadProvider enabled={isBigScreen}>
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<LandingRedirect />} />
            {BIGSCREEN_ROUTE_PAIRS.map(({ path, desktop, bigscreen }) => (
              <Route
                key={path}
                path={path}
                element={<ShellSwitch desktop={desktop()} bigscreen={bigscreen?.()} />}
              />
            ))}
          </Route>
        </Routes>
      </Suspense>
    </GamepadProvider>
  );
}

function App() {
  // Route chunks are loaded on demand. Navigation components still preload
  // the route being hovered/focused, avoiding the resident memory cost of
  // warming pages the user may never visit.

  return (
    <HashRouter>
      <ThemeProvider>
        <LanguageProvider>
          <ToastProvider>
            <UpdateProvider>
              <SplashProvider>
                <GameProvider>
                  {/* Reveals the hidden main window once the library has
                      hydrated and the first frame painted (see component). */}
                  <WindowReveal />
                  <ActivityProvider>
                    <AchievementProvider>
                      <DensityProvider>
                        <LibraryFilterProvider>
                          <WishlistProvider>
                            <SourceProvider>
                              <DownloadProvider>
                                <SettingsProvider>
                                  <SessionNotesProvider>
                                    <SteamGridDbProvider>
                                      <CrackWatchProvider>
                                        <PriceProvider>
                                          <BigScreenProvider>
                                            <PresenceProvider>
                                              <AdaptiveThemeSync />
                                              <GameAccentSync />
                                              <AppShell />
                                              <UpdateModal />
                                              <UpdateNotification />
                                            </PresenceProvider>
                                          </BigScreenProvider>
                                        </PriceProvider>
                                      </CrackWatchProvider>
                                    </SteamGridDbProvider>
                                  </SessionNotesProvider>
                                </SettingsProvider>
                              </DownloadProvider>
                            </SourceProvider>
                          </WishlistProvider>
                        </LibraryFilterProvider>
                      </DensityProvider>
                    </AchievementProvider>
                  </ActivityProvider>
                </GameProvider>
                <Splashscreen />
              </SplashProvider>
            </UpdateProvider>
          </ToastProvider>
        </LanguageProvider>
      </ThemeProvider>
    </HashRouter>
  );
}

export default App;