// BigScreenFriends — the Big Screen Friends hub (v2).
//
// Full console translation of the desktop Friends page. Seven primary
// tabs keep every desktop surface reachable:
//
//   List       → friends grid, playing-now rail, filters, circles,
//                invitations, add friend
//   Activity   → unified timeline
//   Messages   → 1:1 DM threads
//   Lobbies    → session planner (create / upcoming / past / agenda,
//                RSVP, participants, pinned chat)
//   Social     → Recommendations | Wishlist Shares (sub-tabs)
//   Compare    → Library Compare | Leaderboard | Achievement Race
//                (sub-tabs)
//   Profile    → profile card + friend code + full editor
//
// Data comes from `useFriendsData` (friends core + sync engine) and
// `useFriendsSocial` (all remaining social surfaces; sessions/friends
// are authoritative there). LB/RB switches the main header sections
// (like every other primary section); the hub's own tabs are reached
// with D-pad left/right on the focusable tab bar + A to activate. B
// exits to the library; overlays own B while open.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useFriendsData } from "../../hooks/useFriendsData";
import { useFriendsSocial } from "../../hooks/useFriendsSocial";
import BigScreenTabBar, { type TabDef } from "./BigScreenTabBar";
import BigScreenTabPanel from "./BigScreenTabPanel";
import type { Friend } from "../../pages/friendsStorage";
import { displayName } from "../../pages/friendsStorage";
import FriendsListTab from "./friends/FriendsListTab";
import ActivityTab from "./friends/ActivityTab";
import DmsTab from "./friends/DmsTab";
import SessionsTab from "./friends/SessionsTab";
import SocialTab from "./friends/SocialTab";
import CompareTab from "./friends/CompareTab";
import ProfileTab from "./friends/ProfileTab";
import { Icons, useFocusableInput, useOverlayEscape } from "./friends/friendsUtils";

type FriendsTab = "list" | "activity" | "dms" | "sessions" | "social" | "compare" | "profile";

export default function BigScreenFriends() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const gamepad = useGamepad();
  const fd = useFriendsData();
  const social = useFriendsSocial(fd);

  const { profile, setProfile, selfStats, generatedFriendCode, isSyncing } = fd;

  const [activeTab, setActiveTab] = useState<FriendsTab>("list");
  const [showAddModal, setShowAddModal] = useState(false);
  // Friend pre-selected for the lobby composer via the friend-card
  // "Invite" action (cross-tab jump).
  const [pendingLobbyInvites, setPendingLobbyInvites] = useState<string[]>([]);
  // Friend whose nickname is being edited (modal with input).
  const [nicknameFriendId, setNicknameFriendId] = useState<string | null>(null);

  const badgeFor = useCallback(
    (tab: FriendsTab): number => {
      if (tab === "activity")
        return social.unseenCounts.sessions + social.unseenCounts.recs + social.unseenCounts.suggestions + social.unseenCounts.dms;
      if (tab === "dms") return social.unseenCounts.dms;
      if (tab === "sessions") return social.unseenCounts.sessions;
      if (tab === "social") return social.unseenCounts.recs + social.unseenCounts.suggestions;
      return 0;
    },
    [social.unseenCounts],
  );

  const FRIENDS_TABS: TabDef<FriendsTab>[] = useMemo(
    () => [
      // No icon on the tab labels: the friends tab bar is icon-free
      // (the badge on some tabs below is the unseen-count indicator,
      // not a decorative icon).
      { id: "list", label: t("bigscreen.friends.friendsList") },
      { id: "activity", label: t("friends.tab.activity"), icon: badgeFor("activity") > 0 ? <Badge count={badgeFor("activity")} /> : undefined },
      { id: "dms", label: t("friends.tab.messages"), icon: badgeFor("dms") > 0 ? <Badge count={badgeFor("dms")} /> : undefined },
      { id: "sessions", label: t("bigscreen.friends.gameLobbies"), icon: badgeFor("sessions") > 0 ? <Badge count={badgeFor("sessions")} /> : undefined },
      { id: "social", label: t("bigscreen.friends.tabSocial"), icon: badgeFor("social") > 0 ? <Badge count={badgeFor("social")} /> : undefined },
      { id: "compare", label: t("friends.tab.compare") },
      { id: "profile", label: t("bigscreen.friends.myProfile") },
    ],
    [t, badgeFor],
  );

  // Clear the unseen badge when its tab is opened (mirrors desktop).
  useEffect(() => {
    if (activeTab === "sessions") social.clearUnseenTab("sessions");
    else if (activeTab === "social") {
      social.clearUnseenTab("recs");
      social.clearUnseenTab("suggestions");
    } else if (activeTab === "dms") social.clearUnseenTab("dms");
    else if (activeTab === "activity") social.clearUnseenTab("activity");
  }, [activeTab, social]);

  const handleSelectTab = useCallback((tabId: FriendsTab) => {
    setActiveTab(tabId);
  }, []);

  // Controller B / X (keyboard Escape) closes whichever modal is open.
  // Capture-phase so it runs before the shell's global Escape handler.
  const modalOpen = showAddModal || nicknameFriendId !== null;
  useEffect(() => {
    if (!modalOpen) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setShowAddModal(false);
      setNicknameFriendId(null);
    }
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [modalOpen]);

  // Controller B returns to the library grid. While an overlay is open
  // the engine dispatches Escape instead, and the overlay owns B — so
  // this back handler only fires on the bare page.
  useEffect(() => {
    return gamepad.registerBackHandler(() => navigate("/library"), 0);
  }, [gamepad.registerBackHandler, navigate]);

  // NOTE: no `registerTabCycler` here. The shell header owns LB/RB
  // (section switching) and its priority beats any page-level cycler —
  // registering one here would hijack LB/RB for the entire Friends
  // section, unlike every other primary section. The hub's seven tabs
  // are reached via D-pad left/right on the focusable tab bar.

  // Sync spinner debounce: the engine polls in the background (every
  // 15s + on every remote event), so binding the icon straight to
  // `isSyncing` would blink constantly. Only surface it once a cycle
  // has actually run long enough to notice, and never disable the
  // button (a manual press queues behind an in-flight cycle).
  const [syncBusy, setSyncBusy] = useState(false);
  useEffect(() => {
    if (!isSyncing) {
      setSyncBusy(false);
      return undefined;
    }
    const id = window.setTimeout(() => setSyncBusy(true), 800);
    return () => window.clearTimeout(id);
  }, [isSyncing]);

  // Focusables (top header actions)
  const focusAddFriendBtn = useFocusable(() => setShowAddModal(true));
  const focusSyncBtn = useFocusable(() => {
    void fd.performSync(true);
  });

  // Add-friend modal: the public-key textarea is focusable so controller
  // A lands on it (typing happens via the virtual cursor / keyboard).
  const friendCodeRef = useRef<HTMLTextAreaElement | null>(null);
  const friendCodeFocusable = useFocusable(() => friendCodeRef.current?.focus());
  const setFriendCodeRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      friendCodeRef.current = el;
      (friendCodeFocusable.ref as (node: HTMLElement | null) => void)(el);
    },
    [friendCodeFocusable],
  );
  const cancelAddFocusable = useFocusable(() => setShowAddModal(false));
  const confirmAddFocusable = useFocusable(() => {
    if (fd.decodedFriend) {
      fd.handleAddFriend();
      setShowAddModal(false);
    }
  });

  // Cross-tab quick actions from the friend cards.
  const handleOpenDm = useCallback(
    (threadId: string, friendName: string) => {
      social.handleOpenDmThread(threadId, friendName);
      setActiveTab("dms");
    },
    [social],
  );

  const handleInviteToLobby = useCallback(
    (friendName: string) => {
      setPendingLobbyInvites((prev) =>
        prev.includes(friendName) ? prev : [...prev, friendName],
      );
      setActiveTab("sessions");
    },
    [],
  );

  const handleCompare = useCallback(
    (friendId: string) => {
      social.setSelectedCompareFriendId(friendId);
      setActiveTab("compare");
    },
    [social],
  );

  const handleSetNickname = useCallback((friendId: string) => {
    setNicknameFriendId(friendId);
  }, []);

  const nicknameFriend = nicknameFriendId
    ? social.friends.find((f) => f.id === nicknameFriendId) || null
    : null;

  return (
    <div className="bigscreen-store-dashboard">
      <div className="bigscreen-dashboard-scrollable-content bigscreen-friends-content">
        {/* Header Tabs */}
        <div className="bigscreen-friends-toolbar">
          <BigScreenTabBar
            tabs={FRIENDS_TABS}
            activeTab={activeTab}
            onActivate={handleSelectTab}
          />
          <div className="bigscreen-friends-toolbar-actions">
            <button
              type="button"
              className={`bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact${syncBusy ? " is-syncing" : ""}`}
              {...focusSyncBtn}
            >
              {Icons.refresh()}
              {t("bigscreen.friends.syncNetwork")}
            </button>
            {activeTab === "list" && (
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
                {...focusAddFriendBtn}
              >
                {Icons.plus()}
                {t("bigscreen.friends.addFriend")}
              </button>
            )}
          </div>
        </div>

        {/* Tab Panels */}
        <div className="bigscreen-gamepage-tab-scroll-region bigscreen-friends-tab-region">
          <BigScreenTabPanel tabId="list" activeTab={activeTab}>
            <FriendsListTab
              social={social}
              profileName={profile.name}
              onOpenDm={handleOpenDm}
              onInviteToLobby={handleInviteToLobby}
              onCompare={handleCompare}
              onSetNickname={handleSetNickname}
            />
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="activity" activeTab={activeTab}>
            <ActivityTab social={social} />
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="dms" activeTab={activeTab}>
            <DmsTab social={social} profileName={profile.name} />
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="sessions" activeTab={activeTab}>
            <SessionsTab
              social={social}
              profileName={profile.name}
              initialInvites={pendingLobbyInvites}
              onConsumeInitialInvites={() => setPendingLobbyInvites([])}
            />
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="social" activeTab={activeTab}>
            <SocialTab social={social} profileName={profile.name} />
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="compare" activeTab={activeTab}>
            <CompareTab social={social} profile={profile} selfStats={selfStats} />
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="profile" activeTab={activeTab}>
            <ProfileTab
              social={social}
              profile={profile}
              setProfile={setProfile}
              selfStats={selfStats}
              generatedFriendCode={generatedFriendCode}
              onSave={() => void social.saveProfile()}
            />
          </BigScreenTabPanel>
        </div>
      </div>

      {/* Add Friend Modal */}
      {showAddModal && (
        <div
          data-bigscreen-overlay="true"
          role="dialog"
          aria-modal="true"
          className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-addfriend-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="bigscreen-addfriend-title">{t("bigscreen.friends.addFriendTitle")}</h3>
            <p className="bigscreen-modal-body-text">{t("bigscreen.friends.addFriendDesc")}</p>
            <textarea
              ref={setFriendCodeRef}
              className="bigscreen-input bigscreen-input--textarea"
              value={fd.friendCodeInput}
              onChange={(e) => fd.setFriendCodeInput(e.target.value)}
              placeholder={t("bigscreen.friends.publicKeyPlaceholder")}
              tabIndex={friendCodeFocusable.tabIndex}
              role={friendCodeFocusable.role}
              onClick={friendCodeFocusable.onClick}
            />

            {fd.decodedFriend ? (
              <div className="bigscreen-addfriend-preview">
                <div className="bigscreen-friend-avatar bigscreen-friend-avatar--sm">
                  {fd.decodedFriend.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="bigscreen-addfriend-preview-name">{fd.decodedFriend.name}</div>
                  <div className="bigscreen-addfriend-preview-status">{fd.decodedFriend.status}</div>
                </div>
              </div>
            ) : (
              fd.friendCodeInput.trim() && (
                <div className="bigscreen-addfriend-error">{t("bigscreen.friends.invalidKey")}</div>
              )
            )}

            <div className="bigscreen-modal-footer bigscreen-addfriend-footer">
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
                {...cancelAddFocusable}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
                disabled={!fd.decodedFriend}
                {...confirmAddFocusable}
              >
                {t("bigscreen.friends.addFriendBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nickname Modal */}
      {nicknameFriend && (
        <NicknameModal
          friend={nicknameFriend}
          onSave={(nickname) => {
            social.handleSetNickname(nicknameFriend.id, nickname);
            setNicknameFriendId(null);
          }}
          onClose={() => setNicknameFriendId(null)}
        />
      )}
    </div>
  );
}

// ─── Unseen badge ─────────────────────────────────────────────────

function Badge({ count }: { count: number }) {
  return <span className="bigscreen-friends-tab-badge">{count > 99 ? "99+" : count}</span>;
}

// ─── Nickname modal ───────────────────────────────────────────────

function NicknameModal({
  friend,
  onSave,
  onClose,
}: {
  friend: Friend;
  onSave: (nickname: string) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(friend.nickname || friend.name);
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  const closeProps = useFocusable(onClose);
  useOverlayEscape(onClose);
  const saveProps = useFocusable(() => {
    onSave(draft);
  });

  return (
    <div
      data-bigscreen-overlay="true"
      role="dialog"
      aria-modal="true"
      className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
      onMouseDown={onClose}
    >
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-nickname-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bigscreen-overlay-drawer-header">
          <h3>{t("bigscreen.friends.setNickname")}</h3>
          <button type="button" className="bigscreen-overlay-drawer-close" aria-label={t("common.close")} {...closeProps}>
            {Icons.x()}
          </button>
        </div>
        <div className="bigscreen-overlay-drawer-content">
          <div className="bigscreen-nickname-current">{displayName(friend)}</div>
          <input
            ref={setInputRef}
            type="text"
            className="bigscreen-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("bigscreen.friends.circleNamePlaceholder")}
            tabIndex={inputProps.tabIndex}
            role={inputProps.role}
            onClick={inputProps.onClick}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(draft);
            }}
          />
        </div>
        <div className="bigscreen-modal-footer">
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
            {...useFocusable(onClose)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
            {...saveProps}
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
