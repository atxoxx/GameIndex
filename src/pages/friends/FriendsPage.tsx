import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  CalendarDays,
  ChartNoAxesColumn,
  Gamepad2,
  Lightbulb,
  ListOrdered,
  MessageSquare,
  Sparkles,
  Swords,
  Trophy,
  User,
  Users,
} from "lucide-react";
import PageWidget from "../../components/PageWidget";
import { SubTabs, type SubTabItem } from "../../components/ui/SubTabs";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings, useWidgetVisible } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { usePersistedState } from "../../hooks/usePersistedState";
import { startDmThreadId } from "../friendsStorage";
import { consumePendingSuggestion, onPendingSuggestion, type PendingSuggestion } from "../friendSuggestionSignal";
import type { Friend } from "./friendsTypes";
import type {
  FriendsHubTab,
  FriendsPlaySegment,
  FriendsStatsSegment,
  FriendsTabKey,
} from "./friendsTypes";
import { useFriendsPageController } from "./useFriendsPageController";
import { FriendsCockpit } from "./shared/FriendsCockpit";
import { FriendsHeroBand, type FriendsRosterFilter } from "./shared/FriendsHeroBand";
import { SegmentedControl } from "./shared/SegmentedControl";
import { FriendsRoster } from "./roster/FriendsRoster";
import { FriendDetailPane } from "./roster/FriendDetailPane";
import { FriendsDigest } from "./roster/FriendsDigest";
import FriendsActivityTab from "./tabs/FriendsActivityTab";
import FriendsDmsTab from "./tabs/FriendsDmsTab";
import FriendsSessionsTab from "./tabs/FriendsSessionsTab";
import FriendsRecsTab from "./tabs/FriendsRecsTab";
import FriendsSuggestionsTab from "./tabs/FriendsSuggestionsTab";
import FriendsCompareTab from "./tabs/FriendsCompareTab";
import FriendsLeaderboardTab from "./tabs/FriendsLeaderboardTab";
import FriendsRaceTab from "./tabs/FriendsRaceTab";
import FriendsProfileTab from "./tabs/FriendsProfileTab";
import AddFriendModal from "./modals/AddFriendModal";
import FriendsCirclesModal from "./modals/FriendsCirclesModal";
import FriendsSyncModal from "./modals/FriendsSyncModal";
import EditNicknameModal from "./modals/EditNicknameModal";
import "./friends.css";

const HUB_TABS: FriendsHubTab[] = ["friends", "activity", "messages", "sessions", "play", "stats", "profile"];
const PLAY_SEGMENTS: FriendsPlaySegment[] = ["recommendations", "suggestions"];
const STATS_SEGMENTS: FriendsStatsSegment[] = ["compare", "leaderboard", "race"];

export default function FriendsPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { games, launchGame } = useGames();
  const { showToast } = useToast();
  const { isSimpleUi, dmReadReceipts } = useSettings();
  const subtabsVisible = useWidgetVisible("friends", "subtabs");
  const controller = useFriendsPageController();

  const [activeTab, setActiveTab] = usePersistedState<FriendsHubTab>(
    "gamelib.friends.hub_v2",
    "friends",
    HUB_TABS
  );
  const [playSegment, setPlaySegment] = usePersistedState<FriendsPlaySegment>(
    "gamelib.friends.play.segment_v2",
    "recommendations",
    PLAY_SEGMENTS
  );
  const [statsSegment, setStatsSegment] = usePersistedState<FriendsStatsSegment>(
    "gamelib.friends.stats.segment_v2",
    "compare",
    STATS_SEGMENTS
  );

  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedCompareFriendId, setSelectedCompareFriendId] = useState("");
  const [rosterFilter, setRosterFilter] = useState<FriendsRosterFilter>("all");
  const [selectedDmId, setSelectedDmId] = useState<string | null>(null);
  const [selectedDmFriendName, setSelectedDmFriendName] = useState("");
  const [pendingSessionInvite, setPendingSessionInvite] = useState<string | null>(null);
  const [createSessionSignal, setCreateSessionSignal] = useState(0);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showCirclesModal, setShowCirclesModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [nicknameModalFriend, setNicknameModalFriend] = useState<Friend | null>(null);
  const [pendingShare, setPendingShare] = useState<PendingSuggestion | null>(null);

  const isSecondaryTab = activeTab === "sessions" || activeTab === "play" || activeTab === "stats";
  const effectiveTab: FriendsHubTab = isSimpleUi || !subtabsVisible
    ? isSecondaryTab
      ? "friends"
      : activeTab
    : activeTab;

  const selectedFriend = useMemo(
    () => controller.friends.find((friend) => friend.id === selectedFriendId) || null,
    [controller.friends, selectedFriendId]
  );

  const go = (tab: FriendsTabKey) => {
    if (tab === "dms") {
      setActiveTab("messages");
      return;
    }
    if (tab === "recs") {
      setPlaySegment("recommendations");
      setActiveTab("play");
      return;
    }
    if (tab === "suggestions") {
      setPlaySegment("suggestions");
      setActiveTab("play");
      return;
    }
    if (tab === "compare") {
      setStatsSegment("compare");
      setActiveTab("stats");
      return;
    }
    if (tab === "leaderboard") {
      setStatsSegment("leaderboard");
      setActiveTab("stats");
      return;
    }
    if (tab === "race") {
      setStatsSegment("race");
      setActiveTab("stats");
      return;
    }
    setActiveTab(tab);
  };

  // Opening a destination consumes its badge. Activity owns every social
  // feed, so opening it clears their counters in one go.
  useEffect(() => {
    if (effectiveTab === "activity") controller.resetUnseen("activity");
    else if (effectiveTab === "messages") controller.resetUnseen("dms");
    else if (effectiveTab === "sessions") controller.resetUnseen("sessions");
    else if (effectiveTab === "play") {
      controller.resetUnseen(playSegment === "recommendations" ? "recs" : "suggestions");
    }
  }, [effectiveTab, playSegment]);

  // A friend removed from another surface must not leave a stale detail pane.
  useEffect(() => {
    if (selectedFriendId && !controller.friends.some((friend) => friend.id === selectedFriendId)) {
      setSelectedFriendId(null);
    }
  }, [controller.friends, selectedFriendId]);

  // The wishlist "share with friends" signal opens Play with the share dialog primed.
  useEffect(() => {
    const pending = consumePendingSuggestion();
    if (pending) {
      setPendingShare(pending);
      setPlaySegment("suggestions");
      setActiveTab("play");
    }
    return onPendingSuggestion((next) => {
      setPendingShare(next);
      setPlaySegment("suggestions");
      setActiveTab("play");
    });
  }, []);

  // Keep the open conversation marked read as messages arrive.
  useEffect(() => {
    if (effectiveTab !== "messages" || !selectedDmId) return;
    controller.markDmThreadRead(selectedDmId);
  }, [selectedDmId, effectiveTab, controller.dms]);

  const handleMessageFriend = (friend: Friend) => {
    const live = controller.dms.find(
      (thread) =>
        !thread.deleted &&
        thread.participants.includes(controller.profile.name) &&
        thread.participants.includes(friend.name)
    );
    const threadId = live ? live.id : startDmThreadId(controller.profile.name, friend.name, controller.dms);
    setSelectedDmId(threadId);
    setSelectedDmFriendName(friend.name);
    go("dms");
  };

  const handleInviteToSession = (friend: Friend) => {
    setPendingSessionInvite(friend.name);
    setCreateSessionSignal((value) => value + 1);
    go("sessions");
    showToast(t("friendsPage.invitingToSession", { name: friend.name }), "info");
  };

  const handleOpenFriend = (friend: Friend) => {
    setSelectedFriendId(friend.id);
    go("friends");
  };

  const handleCompareFromCard = (friend: Friend) => {
    setSelectedCompareFriendId(friend.id);
    setStatsSegment("compare");
    go("compare");
  };

  const handleCompareById = (friendId: string) => {
    setSelectedCompareFriendId(friendId);
    setStatsSegment("compare");
    go("compare");
  };

  const handleOpenGame = async (gameId: string, gameName: string, slug?: string) => {
    const next = await controller.handleOpenRecGame(gameId, gameName, slug);
    navigate(`/store/${next.slug}`);
  };

  const launchLibraryGame = (gameId: string) => {
    const match = games.find((game) => game.id === gameId);
    if (match) launchGame(match);
  };

  const onlineCount = controller.friends.filter((friend) => {
    if (friend.blocked) return false;
    return (
      !!friend.currentlyPlaying ||
      friend.status?.toLowerCase().includes("online") ||
      friend.status?.toLowerCase().includes("playing") ||
      (!!friend.lastActive && Math.floor(Date.now() / 1000) - friend.lastActive < 180)
    );
  }).length;
  const inGameCount = controller.friends.filter(
    (friend) => !friend.blocked && !!friend.currentlyPlaying
  ).length;

  let navItems: SubTabItem<FriendsHubTab>[] = [
    {
      id: "friends",
      label: t("friendsPage.friendList"),
      icon: Users,
      count: controller.friends.filter((friend) => !friend.blocked).length,
    },
    {
      id: "activity",
      label: t("friends.tab.activity"),
      icon: Activity,
      count: controller.unseenCounts.sessions + controller.unseenCounts.recs + controller.unseenCounts.suggestions,
    },
    {
      id: "messages",
      label: t("friends.tab.messages"),
      icon: MessageSquare,
      count: controller.unseenCounts.dms,
    },
  ];

  if (subtabsVisible) {
    navItems = [
      ...navItems,
      {
        id: "sessions",
        label: t("friendsPage.hubSessions"),
        icon: CalendarDays,
        count: controller.unseenCounts.sessions,
        className: "ui-complete-only",
      },
      {
        id: "play",
        label: t("friends.tab.play"),
        icon: Gamepad2,
        count: controller.unseenCounts.recs + controller.unseenCounts.suggestions,
        className: "ui-complete-only",
      },
      {
        id: "stats",
        label: t("friends.tab.stats"),
        icon: ChartNoAxesColumn,
        className: "ui-complete-only",
      },
    ];
  }

  navItems.push({ id: "profile", label: t("friendsPage.hubProfile"), icon: User });

  return (
    <div className="friends-page page">
      <PageWidget page="friends" widget="friendsHeader">
        <div className="ui-item-friendsHeader">
          <FriendsCockpit
            profile={controller.profile}
            currentlyPlaying={controller.currentlyPlaying}
            onlineCount={onlineCount}
            totalFriends={controller.friends.filter((friend) => !friend.blocked).length}
            inGameCount={inGameCount}
            isSyncing={controller.isSyncing}
            lastSyncedTime={controller.lastSyncedTime}
            lastSyncMessage={controller.syncLog[0]?.message}
            onAddFriend={() => setShowAddModal(true)}
            onStartSession={() => {
              setCreateSessionSignal((value) => value + 1);
              go("sessions");
            }}
            onManageCircles={() => setShowCirclesModal(true)}
            onEditProfile={() => go("profile")}
            onSyncNow={() => void controller.performSync(true)}
            onOpenDiagnostics={() => setShowSyncModal(true)}
          />
        </div>
      </PageWidget>

      <PageWidget page="friends" widget="friendsHero">
        <div className="ui-complete-only ui-item-kpis ui-item-friendsHero">
          <FriendsHeroBand
            friends={controller.friends}
            sessions={controller.sessions}
            myGameIds={controller.myGameIds}
            onFilter={(filter) => {
              setRosterFilter(filter);
              go("friends");
            }}
            onOpenSessions={() => go("sessions")}
            onOpenCompare={() => {
              setStatsSegment("compare");
              go("compare");
            }}
            onOpenFriend={handleOpenFriend}
            onMessageFriend={handleMessageFriend}
            onInviteFriend={handleInviteToSession}
          />
        </div>
      </PageWidget>

      <PageWidget page="friends" widget="friendsTabs">
        <div className="friends-panel ui-item-friendsTabs">
          <SubTabs
            ariaLabel={t("friendsPage.sectionsAria")}
            className="friends-hub"
            value={effectiveTab}
            onChange={(tab) => setActiveTab(tab)}
            items={navItems}
          />

          {effectiveTab === "friends" && (
            <div className={["friends-workspace", selectedFriend ? "has-selection" : ""].filter(Boolean).join(" ")}>
              <FriendsRoster
                friends={controller.friends}
                circles={controller.circles}
                invitations={controller.invitations}
                selectedFriendId={selectedFriendId}
                filter={rosterFilter}
                onFilterChange={setRosterFilter}
                onSelectFriend={setSelectedFriendId}
                onOpenAddModal={() => setShowAddModal(true)}
                onOpenCirclesModal={() => setShowCirclesModal(true)}
                onAcceptInvitation={controller.handleAcceptInvitation}
                onDenyInvitation={controller.handleDenyInvitation}
                onMessageFriend={handleMessageFriend}
                onInviteFriend={handleInviteToSession}
                onCompareFriend={handleCompareFromCard}
                onTogglePin={controller.handleTogglePin}
                onEditNickname={setNicknameModalFriend}
                onToggleBlock={controller.handleToggleBlock}
                onDeleteFriend={controller.handleDeleteFriend}
                onBulkPin={controller.handleBulkPin}
                onBulkUnpin={controller.handleBulkUnpin}
                onBulkBlock={controller.handleBulkBlock}
                onBulkRemove={controller.handleBulkRemove}
              />

              <div className="friends-detail-column">
                {selectedFriend ? (
                  <FriendDetailPane
                    friend={selectedFriend}
                    circles={controller.circles}
                    myGameIds={controller.myGameIds}
                    sessions={controller.sessions}
                    onBack={() => setSelectedFriendId(null)}
                    onMessage={() => handleMessageFriend(selectedFriend)}
                    onInvite={() => handleInviteToSession(selectedFriend)}
                    onCompare={() => handleCompareFromCard(selectedFriend)}
                    onTogglePin={() => controller.handleTogglePin(selectedFriend.id)}
                    onEditNickname={() => setNicknameModalFriend(selectedFriend)}
                    onToggleBlock={() =>
                      controller.handleToggleBlock(selectedFriend.id, selectedFriend.nickname?.trim() || selectedFriend.name)
                    }
                    onDelete={() =>
                      controller.handleDeleteFriend(
                        selectedFriend.id,
                        selectedFriend.nickname?.trim() || selectedFriend.name
                      )
                    }
                    onOpenCircles={() => setShowCirclesModal(true)}
                    onOpenSession={() => go("sessions")}
                  />
                ) : (
                  <FriendsDigest
                    friends={controller.friends}
                    sessions={controller.sessions}
                    recommendations={controller.recommendations}
                    suggestions={controller.suggestions}
                    dms={controller.dms}
                    profile={controller.profile}
                    onNavigate={go}
                  />
                )}
              </div>
            </div>
          )}

          {effectiveTab === "activity" && (
            <FriendsActivityTab
              friends={controller.friends}
              sessions={controller.sessions}
              recommendations={controller.recommendations}
              suggestions={controller.suggestions}
              profile={controller.profile}
              onNavigateTab={go}
              onSelectCompareFriend={handleCompareById}
            />
          )}

          {effectiveTab === "messages" && (
            <FriendsDmsTab
              dms={controller.dms}
              friends={controller.friends}
              profile={controller.profile}
              selectedDmId={selectedDmId}
              selectedDmFriendName={selectedDmFriendName}
              onSelectThread={(threadId, friendName) => {
                setSelectedDmId(threadId);
                setSelectedDmFriendName(friendName);
                controller.resetUnseen("dms");
              }}
              onSendMessage={(threadId, text, attachments) =>
                void controller.handleSendDmMessage(threadId, text, selectedDmFriendName, attachments)
              }
              onReactMessage={(threadId, messageId, emoji) =>
                void controller.handleReactDmMessage(threadId, messageId, emoji)
              }
              readReceiptsEnabled={dmReadReceipts}
              onTogglePinMessage={(threadId, messageId) =>
                void controller.handleTogglePinDmMessage(threadId, messageId)
              }
              onDeleteMessage={(threadId, messageId) =>
                void controller.handleDeleteDmMessage(threadId, messageId)
              }
              onDeleteThread={(threadId) => {
                setSelectedDmId(null);
                void controller.handleDeleteDmThread(threadId);
              }}
              onCompareFriend={handleCompareFromCard}
            />
          )}

          {effectiveTab === "sessions" && (
            <FriendsSessionsTab
              sessions={controller.sessions}
              profile={controller.profile}
              friends={controller.friends}
              libraryGames={games}
              prefillInvite={pendingSessionInvite}
              onPrefillConsumed={() => setPendingSessionInvite(null)}
              openCreateSignal={createSessionSignal}
              onRsvp={(sessionId, status) => void controller.handleRsvp(sessionId, status)}
              onCreateSession={(session) => void controller.handleCreateSession(session)}
              onEditSession={(sessionId, session) => void controller.handleEditSession(sessionId, session)}
              onDeleteSession={(sessionId) => void controller.handleDeleteSession(sessionId)}
              onVotePoll={(sessionId, optionId) => void controller.handleVotePoll(sessionId, optionId)}
              onFinalizePoll={(sessionId, optionId) => void controller.handleFinalizePoll(sessionId, optionId)}
              onSetRole={(sessionId, name, role) => void controller.handleSetSessionRole(sessionId, name, role)}
              onAddGuest={(sessionId, name) => void controller.handleAddSessionGuest(sessionId, name)}
              onRemoveGuest={(sessionId, name) => void controller.handleRemoveSessionGuest(sessionId, name)}
              onSetRsvpNote={(sessionId, note) => void controller.handleSetSessionRsvpNote(sessionId, note)}
              onSendMessage={(sessionId, text) => void controller.handleSendSessionMessage(sessionId, text)}
              onTogglePinMessage={(sessionId, messageId) =>
                void controller.handleTogglePinSessionMessage(sessionId, messageId)
              }
              onLaunchGame={launchLibraryGame}
            />
          )}

          {effectiveTab === "play" && (
            <div className="friends-hub-view">
              <div className="friends-hub-bar">
                <SegmentedControl
                  ariaLabel={t("friends.tab.play")}
                  value={playSegment}
                  onChange={setPlaySegment}
                  items={[
                    {
                      id: "recommendations",
                      label: t("friends.tab.recs"),
                      icon: Lightbulb,
                      count: controller.unseenCounts.recs,
                    },
                    {
                      id: "suggestions",
                      label: t("friends.tab.suggestions"),
                      icon: Sparkles,
                      count: controller.unseenCounts.suggestions,
                    },
                  ]}
                />
              </div>

              {playSegment === "recommendations" ? (
                <FriendsRecsTab
                  recommendations={controller.recommendations}
                  profile={controller.profile}
                  friends={controller.friends}
                  libraryGames={games}
                  wishlistGames={controller.wishlist}
                  onReact={(recId, kind) => void controller.handleReactRec(recId, kind)}
                  onToggleWantToPlay={(recId) => void controller.handleToggleWantToPlay(recId)}
                  onSetWantToPlay={(ids, want) => void controller.handleSetWantToPlayBulk(ids, want)}
                  onAddComment={(recId, text) => void controller.handleAddRecComment(recId, text)}
                  onCreateRec={(rec) => void controller.handleCreateRec(rec)}
                  onDeleteRec={(recId) => void controller.handleDeleteRec(recId)}
                  onOpenGame={handleOpenGame}
                />
              ) : (
                <FriendsSuggestionsTab
                  suggestions={controller.suggestions}
                  profile={controller.profile}
                  friends={controller.friends}
                  wishlistGames={controller.wishlist}
                  prefillShare={pendingShare}
                  onPrefillConsumed={() => setPendingShare(null)}
                  onReact={(suggestionId, kind) => void controller.handleReactSuggestion(suggestionId, kind)}
                  onToggleWishlist={controller.handleToggleWishlistSuggestion}
                  onAddComment={(suggestionId, text) => void controller.handleAddSuggestionComment(suggestionId, text)}
                  onCreateSuggestion={(suggestion) => void controller.handleCreateSuggestion(suggestion)}
                  onDeleteSuggestion={(suggestionId) => void controller.handleDeleteSuggestion(suggestionId)}
                  onOpenGame={handleOpenGame}
                />
              )}
            </div>
          )}

          {effectiveTab === "stats" && (
            <div className="friends-hub-view">
              <div className="friends-hub-bar">
                <SegmentedControl
                  ariaLabel={t("friends.tab.stats")}
                  value={statsSegment}
                  onChange={setStatsSegment}
                  items={[
                    { id: "compare", label: t("friends.tab.compare"), icon: Swords },
                    { id: "leaderboard", label: t("friends.tab.leaderboard"), icon: ListOrdered },
                    { id: "race", label: t("friends.tab.race"), icon: Trophy },
                  ]}
                />
              </div>

              {statsSegment === "compare" && (
                <FriendsCompareTab
                  friends={controller.friends}
                  selfSharedGames={controller.selfSharedGames}
                  selectedFriendId={selectedCompareFriendId}
                  onSelectFriendId={setSelectedCompareFriendId}
                  onLaunchGame={launchLibraryGame}
                />
              )}
              {statsSegment === "leaderboard" && (
                <FriendsLeaderboardTab
                  friends={controller.friends}
                  profile={controller.profile}
                  selfStats={controller.selfStats}
                  selfSharedGames={controller.selfSharedGames}
                  onSelectFriend={handleCompareFromCard}
                />
              )}
              {statsSegment === "race" && (
                <FriendsRaceTab
                  friends={controller.friends}
                  profile={controller.profile}
                  selfSharedGames={controller.selfSharedGames}
                  libraryGames={games}
                />
              )}
            </div>
          )}

          {effectiveTab === "profile" && (
            <FriendsProfileTab
              profile={controller.profile}
              setProfile={controller.setProfile}
              selfStats={controller.selfStats}
              libraryGames={games}
              myFriendCode={controller.generatedFriendCode}
              nostrPublicKey={controller.profile.syncId}
              onSaveProfile={(event) => void controller.handleSaveProfile(event)}
              onImageUpload={controller.handleImageUpload}
            />
          )}
        </div>
      </PageWidget>

      <AddFriendModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        myFriendCode={controller.generatedFriendCode}
        nostrPublicKey={controller.profile.syncId}
        friendCodeInput={controller.friendCodeInput}
        onFriendCodeInputChange={controller.setFriendCodeInput}
        decodedFriend={controller.decodedFriend}
        onAddFriend={() => {
          if (controller.handleAddFriend()) setShowAddModal(false);
        }}
      />

      <FriendsCirclesModal
        isOpen={showCirclesModal}
        onClose={() => setShowCirclesModal(false)}
        circles={controller.circles}
        friends={controller.friends.filter((friend) => !friend.blocked)}
        onCreateCircle={controller.handleCreateCircle}
        onRenameCircle={controller.handleRenameCircle}
        onDeleteCircle={controller.handleDeleteCircle}
        onToggleFriendCircle={controller.handleToggleFriendCircle}
      />

      <FriendsSyncModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
        isSyncing={controller.isSyncing}
        lastSyncedTime={controller.lastSyncedTime}
        syncLog={controller.syncLog}
        onTriggerSync={() => void controller.performSync(true)}
      />

      <EditNicknameModal
        friend={nicknameModalFriend}
        isOpen={!!nicknameModalFriend}
        onClose={() => setNicknameModalFriend(null)}
        onSave={controller.handleSetNickname}
      />
    </div>
  );
}
