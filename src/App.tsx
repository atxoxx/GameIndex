import { HashRouter, Routes, Route } from "react-router-dom";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
import BigScreenLayout from "./components/BigScreenLayout";
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
import {
  SidebarCollapseProvider,
  useSidebarCollapse,
} from "./context/SidebarCollapseContext";
import { GamepadProvider } from "./hooks/GamepadProvider";
import { useDiscordPresence } from "./hooks/useDiscordPresence";
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
  const { isBigScreen } = useBigScreen();
  return (
    <GamepadProvider enabled={isBigScreen}>
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
    </GamepadProvider>
  );
}

function App() {
  return (
    <HashRouter>
      <ThemeProvider>
        <LanguageProvider>
          <ToastProvider>
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
          </ToastProvider>
        </LanguageProvider>
      </ThemeProvider>
    </HashRouter>
  );
}

export default App;