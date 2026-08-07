import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useFriendsData } from "../../hooks/useFriendsData";
import BigScreenPill from "./BigScreenPill";
import BigScreenTabBar, { type TabDef } from "./BigScreenTabBar";
import BigScreenTabPanel from "./BigScreenTabPanel";
import type { Friend, GameSession } from "../../pages/friendsStorage";
import { displayName } from "../../pages/friendsStorage";

function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

type FriendsTab = "list" | "sessions" | "profile";

/**
 * Self-contained Big Screen Friends hub. Owns its data + handlers via
 * `useFriendsData` (same storage helpers / sync engine as the desktop
 * FriendsPage), so it renders standalone under ShellSwitch.
 */
export default function BigScreenFriends() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const gamepad = useGamepad();
  const {
    profile,
    setProfile,
    friends,
    sessions,
    selfStats,
    generatedFriendCode,
    friendCodeInput,
    setFriendCodeInput,
    decodedFriend,
    performSync,
    handleSetRsvp,
    handleDeleteSession,
    handleSendMessage,
    handleSaveProfile,
    handleAddFriend,
    handleTogglePin,
    handleToggleBlock,
    handleDeleteFriend,
  } = useFriendsData();

  const FRIENDS_TABS: TabDef<FriendsTab>[] = [
    { id: "list", label: t("bigscreen.friends.friendsList") },
    { id: "sessions", label: t("bigscreen.friends.gameLobbies") },
    { id: "profile", label: t("bigscreen.friends.myProfile") },
  ];
  const [activeTab, setActiveTab] = useState<FriendsTab>("list");
  const [showAddModal, setShowAddModal] = useState(false);
  const [chattingSessionId, setChattingSessionId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");

  const handleSelectTab = useCallback((tabId: FriendsTab) => {
    setActiveTab(tabId);
  }, []);

  // Filter out deleted sessions
  const activeSessions = useMemo(() => {
    return sessions.filter((s) => !s.deleted).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [sessions]);

  // Active chat session
  const chatSession = useMemo(() => {
    return sessions.find((s) => s.id === chattingSessionId) || null;
  }, [sessions, chattingSessionId]);

  const submitChat = () => {
    const text = chatDraft.trim();
    if (!text || !chattingSessionId) return;
    handleSendMessage(chattingSessionId, text);
    setChatDraft("");
  };

  // Controller B / X (and keyboard Escape) close whichever modal is open.
  // Capture-phase so it runs before the shell's global Escape handler.
  const modalOpen = showAddModal || (chattingSessionId !== null && !!chatSession);
  useEffect(() => {
    if (!modalOpen) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setShowAddModal(false);
      setChattingSessionId(null);
    }
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [modalOpen, chatSession]);

  // Controller B returns to the library grid. While an overlay is open
  // the engine dispatches Escape instead, and the overlay owns B — so
  // this back handler only fires on the bare page.
  useEffect(() => {
    return gamepad.registerBackHandler(() => navigate("/library"), 0);
  }, [gamepad.registerBackHandler, navigate]);

  // Bumper-cycled tab navigation (LB / RB across the three tabs). The
  // unregister fn runs on unmount so the shell's section cycler reclaims
  // LB/RB when the user leaves the Friends hub.
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      if (modalOpen) return;
      setActiveTab((prev) => {
        const ids: FriendsTab[] = ["list", "sessions", "profile"];
        const idx = ids.indexOf(prev);
        if (idx < 0) return ids[0];
        return direction === "forward"
          ? ids[(idx + 1) % ids.length]
          : ids[(idx - 1 + ids.length) % ids.length];
      });
    });
  }, [gamepad.registerTabCycler, modalOpen]);

  // Focusables (top header actions)
  const focusAddFriendBtn = useFocusable(() => setShowAddModal(true));
  const focusSyncBtn = useFocusable(() => performSync(true));
  const closeChatFocusable = useFocusable(() => setChattingSessionId(null));

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
    if (decodedFriend) {
      handleAddFriend();
      setShowAddModal(false);
    }
  });

  // Profile tab: make the name / status inputs reachable via controller.
  const profileNameRef = useRef<HTMLInputElement | null>(null);
  const profileNameFocusable = useFocusable(() => profileNameRef.current?.focus());
  const setProfileNameRef = useCallback(
    (el: HTMLInputElement | null) => {
      profileNameRef.current = el;
      (profileNameFocusable.ref as (node: HTMLElement | null) => void)(el);
    },
    [profileNameFocusable],
  );
  const profileStatusRef = useRef<HTMLInputElement | null>(null);
  const profileStatusFocusable = useFocusable(() => profileStatusRef.current?.focus());
  const setProfileStatusRef = useCallback(
    (el: HTMLInputElement | null) => {
      profileStatusRef.current = el;
      (profileStatusFocusable.ref as (node: HTMLElement | null) => void)(el);
    },
    [profileStatusFocusable],
  );
  const profileFormRef = useRef<HTMLFormElement | null>(null);
  const saveProfileFocusable = useFocusable(() => profileFormRef.current?.requestSubmit());

  // Lobby chat modal: message input focusable so controller A lands on it.
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputFocusable = useFocusable(() => chatInputRef.current?.focus());
  const setChatInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      chatInputRef.current = el;
      (chatInputFocusable.ref as (node: HTMLElement | null) => void)(el);
    },
    [chatInputFocusable],
  );
  const sendChatFocusable = useFocusable(submitChat);

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
              className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
              {...focusSyncBtn}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {t("bigscreen.friends.syncNetwork")}
            </button>
            {activeTab === "list" && (
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
                {...focusAddFriendBtn}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
                {t("bigscreen.friends.addFriend")}
              </button>
            )}
          </div>
        </div>

        {/* Tab Panels */}
        <div className="bigscreen-gamepage-tab-scroll-region bigscreen-friends-tab-region">
          
          {/* 1. Friends List Tab */}
          <BigScreenTabPanel tabId="list" activeTab={activeTab}>
            {friends.length === 0 ? (
              <div className="system-view-empty">
                <p>{t("bigscreen.friends.noFriendsDesc")}</p>
              </div>
            ) : (
              <div className="bigscreen-friends-grid">
                {friends.map((friend) => (
                  <FriendCard
                    key={friend.id}
                    friend={friend}
                    onPin={() => handleTogglePin(friend.id)}
                    onBlock={() => handleToggleBlock(friend.id, friend.name)}
                    onDelete={() => handleDeleteFriend(friend.id, friend.name)}
                  />
                ))}
              </div>
            )}
          </BigScreenTabPanel>

          {/* 2. Game Lobbies (Sessions) Tab */}
          <BigScreenTabPanel tabId="sessions" activeTab={activeTab}>
            {activeSessions.length === 0 ? (
              <div className="system-view-empty">
                <p>{t("bigscreen.friends.noSessions")}</p>
              </div>
            ) : (
              <div className="bigscreen-sessions-list">
                {activeSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    profileName={profile.name}
                    onRsvp={(status) => handleSetRsvp(session.id, status)}
                    onOpenChat={() => setChattingSessionId(session.id)}
                    onDelete={() => handleDeleteSession(session.id)}
                  />
                ))}
              </div>
            )}
          </BigScreenTabPanel>

          {/* 3. My Profile Tab */}
          <BigScreenTabPanel tabId="profile" activeTab={activeTab}>
            <div className="bigscreen-gamepage-2col bigscreen-profile-layout" data-cols="2">
              {/* Profile Card & Key */}
              <div className="bigscreen-panel-card">
                <div className="bigscreen-profile-card-header">
                  <div className="bigscreen-friend-avatar bigscreen-friend-avatar--lg">
                    {profile.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="bigscreen-profile-card-name">{profile.name}</h3>
                    <div className="bigscreen-profile-card-status">
                      "{profile.status || t("bigscreen.friends.noStatus")}"
                    </div>
                  </div>
                </div>

                <div className="bigscreen-profile-key-block">
                  <div className="bigscreen-kpi-label bigscreen-profile-key-label">{t("bigscreen.friends.myPublicKey")}</div>
                  <div className="bigscreen-profile-key">
                    {generatedFriendCode}
                  </div>
                </div>

                <div className="bigscreen-profile-stat-grid">
                  <div className="bigscreen-profile-stat-box">
                    <span className="bigscreen-profile-stat-value">{selfStats.gamesCount}</span>
                    <span className="bigscreen-profile-stat-label">{t("bigscreen.friends.games")}</span>
                  </div>
                  <div className="bigscreen-profile-stat-box">
                    <span className="bigscreen-profile-stat-value">{formatHours(selfStats.playtimeMinutes)}</span>
                    <span className="bigscreen-profile-stat-label">{t("bigscreen.friends.playtime")}</span>
                  </div>
                  <div className="bigscreen-profile-stat-box">
                    <span className="bigscreen-profile-stat-value">{selfStats.achievementsCount}</span>
                    <span className="bigscreen-profile-stat-label">{t("bigscreen.friends.trophies")}</span>
                  </div>
                </div>
              </div>

              {/* Edit gamer details form */}
              <div className="bigscreen-panel-card">
                <h3>{t("bigscreen.friends.editProfile")}</h3>
                <form ref={profileFormRef} onSubmit={handleSaveProfile} className="bigscreen-profile-form">
                  <div className="bigscreen-input-group">
                    <label>{t("bigscreen.friends.gamerTag")}</label>
                    <input
                      ref={setProfileNameRef}
                      type="text"
                      className="bigscreen-input"
                      value={profile.name}
                      onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                      tabIndex={profileNameFocusable.tabIndex}
                      role={profileNameFocusable.role}
                      onClick={profileNameFocusable.onClick}
                      required
                    />
                  </div>
                  <div className="bigscreen-input-group">
                    <label>{t("bigscreen.friends.currentStatus")}</label>
                    <input
                      ref={setProfileStatusRef}
                      type="text"
                      className="bigscreen-input"
                      value={profile.status}
                      onChange={(e) => setProfile({ ...profile, status: e.target.value })}
                      tabIndex={profileStatusFocusable.tabIndex}
                      role={profileStatusFocusable.role}
                      onClick={profileStatusFocusable.onClick}
                    />
                  </div>
                  <button
                    type="submit"
                    className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-profile-save-btn"
                    {...saveProfileFocusable}
                  >
                    {t("bigscreen.friends.saveSync")}
                  </button>
                </form>
              </div>
            </div>
          </BigScreenTabPanel>

        </div>
      </div>

      {/* Add Friend Modal */}
      {showAddModal && (
        <div data-bigscreen-overlay="true" className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal" onClick={() => setShowAddModal(false)}>
          <div
            className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-addfriend-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="bigscreen-addfriend-title">{t("bigscreen.friends.addFriendTitle")}</h3>
            <p className="bigscreen-modal-body-text">{t("bigscreen.friends.addFriendDesc")}</p>
            <textarea
              ref={setFriendCodeRef}
              className="bigscreen-input bigscreen-input--textarea"
              value={friendCodeInput}
              onChange={(e) => setFriendCodeInput(e.target.value)}
              placeholder={t("bigscreen.friends.publicKeyPlaceholder")}
              tabIndex={friendCodeFocusable.tabIndex}
              role={friendCodeFocusable.role}
              onClick={friendCodeFocusable.onClick}
            />

            {decodedFriend ? (
              <div className="bigscreen-addfriend-preview">
                <div className="bigscreen-friend-avatar bigscreen-friend-avatar--sm">
                  {decodedFriend.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="bigscreen-addfriend-preview-name">{decodedFriend.name}</div>
                  <div className="bigscreen-addfriend-preview-status">{decodedFriend.status}</div>
                </div>
              </div>
            ) : (
              friendCodeInput.trim() && (
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
                disabled={!decodedFriend}
                {...confirmAddFocusable}
              >
                {t("bigscreen.friends.addFriendBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lobbies Chat Modal */}
      {chattingSessionId && chatSession && (
        <div data-bigscreen-overlay="true" className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal" onClick={() => setChattingSessionId(null)}>
          <div
            className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-chat-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bigscreen-chat-header">
              <h3>{t("bigscreen.friends.lobbyChat", { gameName: chatSession.gameName })}</h3>
              <button
                type="button"
                className="bigscreen-chat-close"
                aria-label={t("common.close")}
                {...closeChatFocusable}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Messages body */}
            <div className="bigscreen-chat-body">
              {(chatSession.messages || []).length === 0 ? (
                <div className="bigscreen-chat-empty">{t("bigscreen.friends.noMessages")}</div>
              ) : (
                (chatSession.messages || []).map((m) => {
                  const isMe = m.author === profile.name;
                  return (
                    <div key={m.id} className={`bigscreen-chat-bubble ${isMe ? "bigscreen-chat-bubble--me" : "bigscreen-chat-bubble--them"}`}>
                      <div className={`bigscreen-chat-bubble-author ${isMe ? "bigscreen-chat-bubble-author--right" : ""}`}>{m.author}</div>
                      <div className="bigscreen-chat-bubble-text">{m.text}</div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Message input */}
            <div className="bigscreen-chat-input-row">
              <input
                ref={setChatInputRef}
                type="text"
                className="bigscreen-input"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                placeholder={t("bigscreen.friends.typeMessage")}
                tabIndex={chatInputFocusable.tabIndex}
                role={chatInputFocusable.role}
                onClick={chatInputFocusable.onClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitChat();
                }}
              />
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
                {...sendChatFocusable}
              >
                {t("bigscreen.friends.send")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Friend Card ─────────────────────────────────────────────────────

function FriendCard({
  friend,
  onPin,
  onBlock,
  onDelete,
}: {
  friend: Friend;
  onPin: () => void;
  onBlock: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [showOptions, setShowOptions] = useState(false);

  const focusCard = useFocusable(() => setShowOptions(true));
  const isPlaying = !!friend.currentlyPlaying;

  // Controller B / X closes the options popover.
  useEffect(() => {
    if (!showOptions) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setShowOptions(false);
    }
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [showOptions]);

  return (
    <div
      className={`bigscreen-game-card bigscreen-friend-card${friend.pinned ? " running" : ""}${isPlaying ? " bigscreen-friend-card--playing" : ""}`}
      {...focusCard}
    >
      <div className="bigscreen-friend-card-top">
        <div className="bigscreen-friend-avatar">
          {friend.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="bigscreen-friend-id">
          <h4 className="bigscreen-friend-name">
            {displayName(friend)}
          </h4>
          <p className={`bigscreen-friend-status${isPlaying ? " bigscreen-friend-status--playing" : ""}`}>
            {isPlaying && <span className="bigscreen-friend-status-dot" aria-hidden />}
            {isPlaying ? t("bigscreen.friends.playing", { game: friend.currentlyPlaying }) : friend.status || t("bigscreen.friends.offline")}
          </p>
        </div>
        {friend.pinned && (
          <span className="bigscreen-friend-pin">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 3v6l2.4 2.4a2 2 0 0 1 .6 1.4V14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1.2a2 2 0 0 1 .6-1.4L8 9V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1Z" />
              <path d="M12 15v5" />
            </svg>
          </span>
        )}
      </div>

      <div className="bigscreen-friend-stats">
        {friend.libStats ? (
          <div>{t("bigscreen.friends.friendStats", { games: friend.libStats.gamesCount, trophies: friend.libStats.achievementsCount })}</div>
        ) : (
          <div>{t("bigscreen.friends.noSyncStats")}</div>
        )}
      </div>

      {/* Quick popup options on click */}
      {showOptions && (
        <FriendOptionsPopover
          friend={friend}
          onPin={onPin}
          onBlock={onBlock}
          onDelete={onDelete}
          onClose={() => setShowOptions(false)}
        />
      )}
    </div>
  );
}

// ─── Friend Options Popover ────────────────────────────────────────
// Owns its useFocusable calls unconditionally (rules-of-hooks: the
// popover mounts as a whole only when `showOptions` flips, so the hook
// count is stable inside this component — never inside the parent's
// `.map()` / conditional JSX).

function FriendOptionsPopover({
  friend,
  onPin,
  onBlock,
  onDelete,
  onClose,
}: {
  friend: Friend;
  onPin: () => void;
  onBlock: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const pinProps = useFocusable(() => {
    onPin();
    onClose();
  });
  const blockProps = useFocusable(() => {
    onBlock();
    onClose();
  });
  const deleteProps = useFocusable(() => {
    onDelete();
    onClose();
  });
  const cancelProps = useFocusable(onClose);

  return (
    <div data-bigscreen-overlay="true" className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal" onClick={onClose}>
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-friendoptions-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="bigscreen-friendoptions-title">{displayName(friend)}</h4>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn" {...pinProps}>
          {friend.pinned ? t("bigscreen.friends.unpinFriend") : t("bigscreen.friends.pinFriend")}
        </button>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn" {...blockProps}>
          {friend.blocked ? t("bigscreen.friends.unblockFriend") : t("bigscreen.friends.blockFriend")}
        </button>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--danger bigscreen-details-btn--compact bigscreen-popover-btn" {...deleteProps}>
          {t("bigscreen.friends.deleteFriend")}
        </button>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn bigscreen-popover-btn--cancel" {...cancelProps}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

// ─── Session Row ─────────────────────────────────────────────────────

function SessionRow({
  session,
  profileName,
  onRsvp,
  onOpenChat,
  onDelete,
}: {
  session: GameSession;
  profileName: string;
  onRsvp: (status: any) => void;
  onOpenChat: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const myRsvp = session.rsvps?.[profileName] || "none";

  const focusRsvpGoing = useFocusable(() => onRsvp("going"));
  const focusRsvpMaybe = useFocusable(() => onRsvp("maybe"));
  const focusRsvpDeclined = useFocusable(() => onRsvp("declined"));
  const focusChat = useFocusable(onOpenChat);
  const focusDelete = useFocusable(onDelete);

  const formattedDate = useMemo(() => {
    return new Date(session.scheduledAt).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [session.scheduledAt]);

  const attendeesCount = Object.values(session.rsvps || {}).filter((v) => v === "going").length;

  return (
    <div className="bigscreen-widget-card bigscreen-session-row">
      <div className="bigscreen-session-main">
        <div className="bigscreen-session-title-row">
          <h4 className="bigscreen-session-title">{session.gameName}</h4>
          <BigScreenPill tone="accent" size="sm">{t("bigscreen.friends.lobby")}</BigScreenPill>
        </div>
        <div className="bigscreen-session-meta">
          {t("bigscreen.friends.sessionMeta", { date: formattedDate, going: attendeesCount, max: session.maxPlayers })}
        </div>
        {session.description && (
          <div className="bigscreen-session-desc">
            "{session.description}"
          </div>
        )}
      </div>

      <div className="bigscreen-session-actions">
        {/* RSVP button strip */}
        <div className="bigscreen-rsvp-group">
          <button type="button" className={`bigscreen-rsvp-btn ${myRsvp === "going" ? "is-selected-going" : ""}`} {...focusRsvpGoing}>
            {t("bigscreen.friends.going")}
          </button>
          <button type="button" className={`bigscreen-rsvp-btn ${myRsvp === "maybe" ? "is-selected-maybe" : ""}`} {...focusRsvpMaybe}>
            {t("bigscreen.friends.maybe")}
          </button>
          <button type="button" className={`bigscreen-rsvp-btn ${myRsvp === "declined" ? "is-selected-declined" : ""}`} {...focusRsvpDeclined}>
            {t("bigscreen.friends.decline")}
          </button>
        </div>

        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact" {...focusChat}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {t("bigscreen.friends.chat")}
        </button>

        {session.creatorName === profileName && (
          <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-session-btn--danger" {...focusDelete}>
            {t("bigscreen.friends.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
