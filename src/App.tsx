import { lazy, Suspense, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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

function AppShell() {
  useDiscordPresence();
  useTrayNavigation();
  useTrayStrings();
  const { isBigScreen } = useBigScreen();
  return (
    <GamepadProvider enabled={isBigScreen}>
      <Suspense fallback={null}>
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
  // Reveal the main window once the app has mounted its first frame.
  // The main window starts hidden behind the native splashscreen window
  // (tauri.conf.json), so this is the hand-off that swaps splash -> app.
  useEffect(() => {
    invoke("close_splashscreen").catch(() => {});
  }, []);

  return (
    <HashRouter>
      <ThemeProvider>
        <LanguageProvider>
          <ToastProvider>
            <UpdateProvider>
              <SplashProvider>
                <GameProvider>
                  <ActivityProvider>
                    <AchievementProvider>
                      <DensityProvider>
                        <LibraryFilterProvider>
                          <WishlistProvider>
                            <SourceProvider>
                              <DownloadProvider>
                                <SettingsProvider>
                                  <SessionNotesProvider>
                                    <BigScreenProvider>
                                      <PresenceProvider>
                                        <AppShell />
                                        <UpdateModal />
                                        <UpdateNotification />
                                      </PresenceProvider>
                                    </BigScreenProvider>
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