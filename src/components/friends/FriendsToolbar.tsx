import { useLanguage } from "../../context/LanguageContext";
import { useWidgetVisible } from "../../context/SettingsContext";
import { SubTabs, type SubTabItem } from "../ui/SubTabs";
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
  const subtabsVisible = useWidgetVisible("friends", "subtabs");

  const activityBadge =
    unseenCounts.sessions + unseenCounts.recs + unseenCounts.suggestions;

  const gatedClass = "ui-complete-only";

  const items: SubTabItem<FriendsTabKey>[] = [
    {
      id: "friends",
      label: t("friends.tab.friends"),
      icon: UsersIcon,
      count: friendsCount,
    },
    {
      id: "activity",
      label: t("friends.tab.activity"),
      icon: ActivityIcon,
      count: activityBadge,
    },
    {
      id: "dms",
      label: t("friends.tab.messages"),
      icon: MessageIcon,
      count: unseenCounts.dms,
    },
  ];

  if (subtabsVisible) {
    items.push(
      {
        id: "sessions",
        label: t("friends.tab.sessions"),
        icon: CalendarIcon,
        count: unseenCounts.sessions,
        className: gatedClass,
      },
      {
        id: "recs",
        label: t("friends.tab.recs"),
        icon: RecommendIcon,
        count: unseenCounts.recs,
        className: gatedClass,
      },
      {
        id: "suggestions",
        label: t("friends.tab.suggestions"),
        icon: SuggestionIcon,
        count: unseenCounts.suggestions,
        className: gatedClass,
      },
      {
        id: "compare",
        label: t("friends.tab.compare"),
        icon: CompareIcon,
        className: gatedClass,
      },
      {
        id: "leaderboard",
        label: t("friends.tab.leaderboard"),
        icon: LeaderboardIcon,
        className: gatedClass,
      },
      {
        id: "race",
        label: t("friends.tab.race"),
        icon: TrophyIcon,
        className: gatedClass,
      },
    );
  }

  items.push({
    id: "profile",
    label: t("friends.tab.profile"),
    icon: UserIcon,
  });

  return (
    <div className="friends-tab-bar-container">
      <SubTabs
        ariaLabel={t("friendsPage.sectionsAria")}
        className="friends-tabs"
        value={activeTab}
        onChange={onSelectTab}
        items={items}
      />

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
