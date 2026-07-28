import { HashRouter, Routes, Route } from "react-router-dom";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
import BigScreenLayout from "./components/BigScreenLayout";
import LibraryPage from "./pages/LibraryPage";
import HomePage from "./pages/HomePage";
import GamePage from "./pages/GamePage";
import StorePage from "./pages/StorePage";
import StoreGameDetail from "./pages/StoreGameDetail";
import CommunityPage from "./pages/CommunityPage";
import SettingsPage from "./pages/SettingsPage";
import FriendsPage from "./pages/FriendsPage";
import ActivityPage from "./pages/ActivityPage";
import StoragePage from "./pages/StoragePage";
import WishlistPage from "./pages/WishlistPage";
import NewsPage from "./pages/NewsPage";
import DealsPage from "./pages/deals/DealsPage";
import DownloadsPage from "./pages/DownloadsPage";
import AchievementsPage from "./pages/AchievementsPage";
import EmulatorsPage from "./pages/EmulatorsPage";
import ModsPage from "./pages/mods/ModsPage";
import { GameProvider } from "./context/GameContext";
import { ToastProvider } from "./context/ToastContext";
import { ActivityProvider } from "./context/ActivityContext";
import { WishlistProvider } from "./context/WishlistContext";
import { DensityProvider } from "./context/DensityContext";
import { SplashProvider } from "./context/SplashContext";
import { DownloadProvider } from "./context/DownloadContext";
import { SourceProvider } from "./context/SourceContext";
import { ThemeProvider } from "./context/ThemeContext";
import { AchievementProvider } from "./context/AchievementContext";
import { SettingsProvider } from "./context/SettingsContext";
import { SessionNotesProvider } from "./context/SessionNotesContext";
import { BigScreenProvider, useBigScreen } from "./context/BigScreenContext";
import { LanguageProvider } from "./context/LanguageContext";
import {
  SidebarCollapseProvider,
  useSidebarCollapse,
} from "./context/SidebarCollapseContext";
import { GamepadProvider } from "./hooks/GamepadProvider";
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
  const { isBigScreen } = useBigScreen();
  return (
    <GamepadProvider enabled={isBigScreen}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<LandingRedirect />} />
          <Route path="home" element={<HomePage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="library/:gameId" element={<GamePage />} />
          <Route path="wishlist" element={<WishlistPage />} />
          <Route path="news" element={<NewsPage />} />
          <Route path="deals" element={<DealsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="achievements" element={<AchievementsPage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="store" element={<StorePage />} />
          <Route path="store/:gameSlug" element={<StoreGameDetail />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="emulators" element={<EmulatorsPage />} />
          <Route path="mods" element={<ModsPage />} />
          <Route path="settings" element={<SettingsPage />} />
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
                      <WishlistProvider>
                        <SourceProvider>
                          <DownloadProvider>
                            <SettingsProvider>
                              <SessionNotesProvider>
                                <BigScreenProvider>
                                  <AppShell />
                                </BigScreenProvider>
                              </SessionNotesProvider>
                            </SettingsProvider>
                          </DownloadProvider>
                        </SourceProvider>
                      </WishlistProvider>
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