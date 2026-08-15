import { useLanguage } from "../../context/LanguageContext";
import type { FriendsTabKey, UnseenCounts } from "./friendsTypes";
import {
  UsersIcon,
  ActivityIcon,
  MessageIcon,
  CalendarIcon,
  RecommendIcon,
  SuggestionIcon,
  CompareIcon,
  LeaderboardIcon,
  TrophyIcon,
  UserIcon,
  RefreshIcon,
  P2pSyncIcon,
} from "./friendsUtils";

interface FriendsToolbarProps {
  activeTab: FriendsTabKey;
  onSelectTab: (tab: FriendsTabKey) => void;
  friendsCount: number;
  unseenCounts: UnseenCounts;
  isSyncing: boolean;
  lastSyncedTime: string;
  onSyncNow: () => void;
  onOpenP2pModal: () => void;
}

export default function FriendsToolbar({
  activeTab,
  onSelectTab,
  friendsCount,
  unseenCounts,
  isSyncing,
  lastSyncedTime,
  onSyncNow,
  onOpenP2pModal,
}: FriendsToolbarProps) {
  const { t } = useLanguage();

  const activityBadge =
    unseenCounts.sessions + unseenCounts.recs + unseenCounts.suggestions;

  return (
    <div className="friends-tab-bar-container">
      <div className="friends-tab-bar" role="tablist" aria-label={t("friendsPage.sectionsAria")}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "friends"}
          className={`friends-tab${activeTab === "friends" ? " active" : ""}`}
          onClick={() => onSelectTab("friends")}
        >
          <UsersIcon />
          <span>{t("friends.tab.friends")}</span>
          {friendsCount > 0 && <span className="friends-tab-count">{friendsCount}</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "activity"}
          className={`friends-tab${activeTab === "activity" ? " active" : ""}`}
          onClick={() => onSelectTab("activity")}
        >
          <ActivityIcon />
          <span>{t("friends.tab.activity")}</span>
          {activityBadge > 0 && <span className="friends-tab-count">{activityBadge}</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "dms"}
          className={`friends-tab${activeTab === "dms" ? " active" : ""}`}
          onClick={() => onSelectTab("dms")}
        >
          <MessageIcon />
          <span>{t("friends.tab.messages")}</span>
          {unseenCounts.dms > 0 && <span className="friends-tab-count">{unseenCounts.dms}</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sessions"}
          className={`friends-tab${activeTab === "sessions" ? " active" : ""}`}
          onClick={() => onSelectTab("sessions")}
        >
          <CalendarIcon />
          <span>{t("friends.tab.sessions")}</span>
          {unseenCounts.sessions > 0 && <span className="friends-tab-count">{unseenCounts.sessions}</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "recs"}
          className={`friends-tab${activeTab === "recs" ? " active" : ""}`}
          onClick={() => onSelectTab("recs")}
        >
          <RecommendIcon />
          <span>{t("friends.tab.recs")}</span>
          {unseenCounts.recs > 0 && <span className="friends-tab-count">{unseenCounts.recs}</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "suggestions"}
          className={`friends-tab${activeTab === "suggestions" ? " active" : ""}`}
          onClick={() => onSelectTab("suggestions")}
        >
          <SuggestionIcon />
          <span>{t("friends.tab.suggestions")}</span>
          {unseenCounts.suggestions > 0 && <span className="friends-tab-count">{unseenCounts.suggestions}</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "compare"}
          className={`friends-tab${activeTab === "compare" ? " active" : ""}`}
          onClick={() => onSelectTab("compare")}
        >
          <CompareIcon />
          <span>{t("friends.tab.compare")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "leaderboard"}
          className={`friends-tab${activeTab === "leaderboard" ? " active" : ""}`}
          onClick={() => onSelectTab("leaderboard")}
        >
          <LeaderboardIcon />
          <span>{t("friends.tab.leaderboard")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "race"}
          className={`friends-tab${activeTab === "race" ? " active" : ""}`}
          onClick={() => onSelectTab("race")}
        >
          <TrophyIcon />
          <span>{t("friends.tab.race")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "profile"}
          className={`friends-tab${activeTab === "profile" ? " active" : ""}`}
          onClick={() => onSelectTab("profile")}
        >
          <UserIcon />
          <span>{t("friends.tab.profile")}</span>
        </button>
      </div>

      <div className="sync-status-container">
        <span className={`sync-status-dot${isSyncing ? " spinning" : ""}`} aria-hidden />
        <span className="sync-status-text">
          {isSyncing
            ? t("friends.syncing")
            : lastSyncedTime
            ? t("friends.synced", { time: lastSyncedTime })
            : t("friendsPage.lastSyncedNever")}
        </span>
        <span className="sync-status-divider" aria-hidden />
        <button
          type="button"
          className="btn-sync"
          onClick={onSyncNow}
          disabled={isSyncing}
          title={t("friends.syncNow")}
          aria-label={t("friends.syncNow")}
        >
          <RefreshIcon className={isSyncing ? "sync-spinner" : ""} />
        </button>
        <button
          type="button"
          className="btn-sync p2p-sync-btn"
          onClick={onOpenP2pModal}
          title={t("friends.p2pSync")}
          aria-label={t("friends.p2pSync")}
        >
          <P2pSyncIcon />
        </button>
      </div>
    </div>
  );
}
