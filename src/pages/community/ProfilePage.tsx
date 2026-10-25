import { Camera, ChartColumn, Sparkles, Trophy } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import PageWidget from "../../components/PageWidget";
import { SubTabs, type SubTabItem } from "../../components/ui/SubTabs";
import { ProfileHeader } from "./ProfileHeader";
import { useProfileController } from "./useProfileController";
import { OverviewTab } from "./tabs/OverviewTab";
import { InsightsTab } from "./tabs/InsightsTab";
import { AchievementsTab } from "./tabs/AchievementsTab";
import { GalleryTab } from "./tabs/GalleryTab";
import type { StatsSubtab } from "./statsTypes";

import "./profile.css";
import "./overview.css";
import "./insights.css";
import "./achievements.css";
import "./gallery.css";

/**
 * Profile — the player's own record of their library.
 *
 * One header, one range, four views: a digest (Overview), the analysis
 * (Insights), the trophy case (Achievements) and the media wall (Gallery).
 * Social features live on /friends; this page is about the player.
 */
export default function ProfilePage() {
  const { t } = useLanguage();
  const controller = useProfileController();
  const {
    activeTab,
    range,
    changeTab,
    changeRange,
    totals,
    levelInfo,
    persona,
    streak,
    genreBreakdown,
    hideAchievementProgress,
    showSecondaryTabs,
    setCaptureCount,
  } = controller;

  const tabs: SubTabItem<StatsSubtab>[] = [
    { id: "overview", label: t("profile.tab.overview"), icon: ChartColumn },
    ...(showSecondaryTabs
      ? [{ id: "insights" as const, label: t("profile.tab.insights"), icon: Sparkles }]
      : []),
    {
      id: "achievements",
      label: t("profile.tab.achievements"),
      icon: Trophy,
      count: hideAchievementProgress ? null : totals.achievementUnlocked,
    },
    ...(showSecondaryTabs
      ? [
          {
            id: "gallery" as const,
            label: t("profile.tab.gallery"),
            icon: Camera,
            count: totals.captureCount,
          },
        ]
      : []),
  ];

  return (
    <div className="profile-page">
      <PageWidget page="community" widget="communityHeader">
        <div className="ui-item-communityHeader">
          <ProfileHeader
            levelInfo={levelInfo}
            persona={persona}
            streak={streak}
            totals={totals}
            genreBreakdown={genreBreakdown}
            range={range}
            onRangeChange={changeRange}
            hideAchievementProgress={hideAchievementProgress}
          />
        </div>
      </PageWidget>

      <PageWidget page="community" widget="communityTabs">
        <div className="ui-item-communityTabs">
          <SubTabs
            ariaLabel={t("profile.tabsLabel")}
            className="profile-subtabs"
            value={activeTab}
            onChange={changeTab}
            items={tabs}
          />
        </div>
      </PageWidget>

      <PageWidget page="community" widget="communityContent">
        <main className="profile-main ui-item-communityContent">
          {activeTab === "overview" && (
            <OverviewTab
              sessions={controller.filteredSessions}
              allSessions={controller.sessions}
              games={controller.games}
              recentUnlocks={controller.recentUnlocks}
              range={range}
              totalAchievementsUnlocked={totals.achievementUnlocked}
              hideAchievementProgress={hideAchievementProgress}
              showSecondaryTabs={showSecondaryTabs}
              onOpenTab={changeTab}
            />
          )}

          {activeTab === "insights" && (
            <InsightsTab
              sessions={controller.filteredSessions}
              allSessions={controller.sessions}
              games={controller.games}
              range={range}
              onResetRange={() => changeRange("all")}
            />
          )}

          {activeTab === "achievements" && (
            <AchievementsTab
              summaries={controller.summaries}
              rarestUnlocks={controller.rarestUnlocks}
              recentUnlocks={controller.recentUnlocks}
              games={controller.games}
              allSessions={controller.sessions}
              range={range}
              totalAchievementsUnlocked={totals.achievementUnlocked}
              hideAchievementProgress={hideAchievementProgress}
            />
          )}

          {activeTab === "gallery" && (
            <GalleryTab
              games={controller.games}
              range={range}
              onCountChange={setCaptureCount}
            />
          )}
        </main>
      </PageWidget>
    </div>
  );
}
