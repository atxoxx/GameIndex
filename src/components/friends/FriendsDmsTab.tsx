import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { DmThread, Friend, UserProfile, DmAttachment } from "./friendsTypes";
import {
  displayName,
  getInitials,
  getProceduralAvatarStyle,
  isOnline,
  formatLastSeen,
  fileToImageAttachment,
  MessageIcon,
  SendIcon,
  PinIcon,
  TrashIcon,
  CompareIcon,
  PaperclipIcon,
  SmileIcon,
  XIcon,
} from "./friendsUtils";

const DM_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

interface FriendsDmsTabProps {
  dms: DmThread[];
  friends: Friend[];
  profile: UserProfile;
  selectedDmId: string | null;
  selectedDmFriendName: string;
  readReceiptsEnabled: boolean;
  onSelectThread: (threadId: string, friendName: string) => void;
  onSendMessage: (threadId: string, text: string, attachments?: DmAttachment[]) => void;
  onReactMessage: (threadId: string, messageId: string, emoji: string) => void;
  onTogglePinMessage: (threadId: string, messageId: string) => void;
  onDeleteMessage: (threadId: string, messageId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onCompareFriend?: (friend: Friend) => void;
}

export default function FriendsDmsTab({
  dms,
  friends,
  profile,
  selectedDmId,
  selectedDmFriendName,
  readReceiptsEnabled,
  onSelectThread,
  onSendMessage,
  onReactMessage,
  onTogglePinMessage,
  onDeleteMessage,
  onDeleteThread,
  onCompareFriend,
}: FriendsDmsTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [threadSearch, setThreadSearch] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [newChatFriendId, setNewChatFriendId] = useState("");
  const [reactingToMsg, setReactingToMsg] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<DmAttachment | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // Active thread calculation
  const activeThread = useMemo(() => {
    if (!selectedDmId) return null;
    return dms.find((t) => t.id === selectedDmId) || null;
  }, [dms, selectedDmId]);

  // Friend details for active conversation
  const activeFriend = useMemo(() => {
    if (!selectedDmFriendName) return null;
    return friends.find((f) => f.name === selectedDmFriendName) || null;
  }, [friends, selectedDmFriendName]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [activeThread?.messages?.length, selectedDmId]);

  // Filter threads
  const filteredThreads = useMemo(() => {
    let list = [...dms].filter((t) => !t.deleted);
    if (threadSearch.trim()) {
      const q = threadSearch.toLowerCase().trim();
      list = list.filter((th) => {
        const otherName = th.participants.find((p) => p !== profile.name) || "";
        const f = friends.find((fr) => fr.name === otherName);
        const name = f ? displayName(f).toLowerCase() : otherName.toLowerCase();
        const hasMsg = (th.messages || []).some((m) => m.text.toLowerCase().includes(q));
        return name.includes(q) || hasMsg;
      });
    }
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list;
  }, [dms, threadSearch, profile.name, friends]);

  const unreadCount = (thread: DmThread): number => {
    const lastRead = thread.lastReadAt?.[profile.name] || 0;
    return (thread.messages || []).filter((m) => m.author !== profile.name && m.timestamp > lastRead).length;
  };

  const handleSend = () => {
    const text = messageDraft.trim();
    if ((!text && !pendingAttachment) || !selectedDmId) return;
    onSendMessage(selectedDmId, text, pendingAttachment ? [pendingAttachment] : undefined);
    setMessageDraft("");
    setPendingAttachment(null);
  };

  const handleStartNewChat = (friendId: string) => {
    const friend = friends.find((f) => f.id === friendId);
    if (!friend) return;
    const existing = dms.find(
      (th) => th.participants.includes(profile.name) && th.participants.includes(friend.name)
    );
    const tid = existing ? existing.id : `dm_${[profile.name.trim(), friend.name.trim()].sort().join("_")}`;
    onSelectThread(tid, friend.name);
    setNewChatFriendId("");
  };

  const handlePickAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void fileToImageAttachment(file).then((att) => {
      if (att) setPendingAttachment(att);
      else showToast(t("friendsPage.attachFailed"), "error");
    });
  };

  const messages = activeThread?.messages || [];
  const pinnedMessages = messages.filter((m) => m.pinned);
  const regularMessages = messages.filter((m) => !m.pinned);
  const otherName = activeThread?.participants.find((p) => p !== profile.name) || "";
  const friendReadAt = activeThread?.lastReadAt?.[otherName] || 0;

  return (
    <div className="friends-dms-section">
      {/* Left Sidebar: Threads List */}
      <div className="dms-threads-sidebar">
        <div className="dms-threads-head">
          <h3 className="dms-threads-title">
            <MessageIcon /> {t("friends.tab.messages")}
          </h3>

          <div className="dms-new-chat-picker">
            <select
              className="profile-input dms-new-chat-select"
              value={newChatFriendId}
              onChange={(e) => {
                const val = e.target.value;
                setNewChatFriendId(val);
                if (val) handleStartNewChat(val);
              }}
            >
              <option value="">+ {t("friendsPage.newConversation")}</option>
              {friends
                .filter((f) => !f.blocked)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {displayName(f)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="dms-search-wrapper">
          <input
            type="text"
            className="profile-input dms-search-input"
            placeholder={t("friendsPage.searchMessages")}
            value={threadSearch}
            onChange={(e) => setThreadSearch(e.target.value)}
          />
        </div>

        <div className="dms-threads-list">
          {filteredThreads.length === 0 ? (
            <div className="dms-empty-threads">
              <MessageIcon />
              <p>{t("friendsPage.noConversationsYet")}</p>
            </div>
          ) : (
            filteredThreads.map((thread) => {
              const otherName = thread.participants.find((p) => p !== profile.name) || "Friend";
              const friend = friends.find((f) => f.name === otherName);
              const friendDisplay = friend ? displayName(friend) : otherName;
              const isCurr = thread.id === selectedDmId;
              const lastMsg = (thread.messages || []).slice(-1)[0];
              const online = friend ? isOnline(friend) : false;
              const unread = unreadCount(thread);

              return (
                <div
                  key={thread.id}
                  className={`dm-thread-item${isCurr ? " active" : ""}`}
                  onClick={() => onSelectThread(thread.id, otherName)}
                >
                  <div className="dm-thread-avatar-wrapper">
                    {friend?.avatar && friend.avatar.startsWith("data:") ? (
                      <img src={friend.avatar} alt={friendDisplay} className="dm-thread-avatar" />
                    ) : (
                      <div
                        className="dm-thread-avatar-procedural"
                        style={getProceduralAvatarStyle(friendDisplay)}
                      >
                        {getInitials(friendDisplay)}
                      </div>
                    )}
                    <span className={`dm-presence-dot${online ? " online" : ""}`} />
                  </div>

                  <div className="dm-thread-info">
                    <div className="dm-thread-name-row">
                      <span className="dm-thread-name">{friendDisplay}</span>
                      {lastMsg && (
                        <span className="dm-thread-time">
                          {formatLastSeen(Math.floor(lastMsg.timestamp / 1000), t)}
                        </span>
                      )}
                    </div>
                    <div className="dm-thread-preview">
                      {lastMsg
                        ? `${lastMsg.author === profile.name ? `${t("friendsPage.you")}: ` : ""}${lastMsg.text || "📷"}`
                        : t("friendsPage.startedNewChat")}
                    </div>
                  </div>

                  {unread > 0 && <span className="dm-thread-unread-badge">{unread}</span>}

                  <button
                    type="button"
                    className="dm-thread-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteThread(thread.id);
                    }}
                    title={t("friendsPage.deleteThread")}
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Pane: Active Conversation */}
      <div className="dms-conversation-pane">
        {selectedDmId ? (
          <>
            {/* Conversation Header */}
            <div className="dm-conversation-header">
              <div className="dm-conversation-friend-meta">
                {activeFriend?.avatar && activeFriend.avatar.startsWith("data:") ? (
                  <img src={activeFriend.avatar} alt={selectedDmFriendName} className="dm-header-avatar" />
                ) : (
                  <div
                    className="dm-header-avatar-procedural"
                    style={getProceduralAvatarStyle(selectedDmFriendName)}
                  >
                    {getInitials(selectedDmFriendName)}
                  </div>
                )}
                <div>
                  <h3 className="dm-header-name">
                    {activeFriend ? displayName(activeFriend) : selectedDmFriendName}
                  </h3>
                  <span className="dm-header-status">
                    {activeFriend && isOnline(activeFriend)
                      ? t("friendsPage.onlineNow")
                      : t("friendsPage.offline")}
                  </span>
                </div>
              </div>

              {activeFriend && onCompareFriend && (
                <div className="dm-header-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn--mini"
                    onClick={() => onCompareFriend(activeFriend)}
                    title={t("friends.compare")}
                  >
                    <CompareIcon /> {t("friends.compare")}
                  </button>
                </div>
              )}
            </div>

            {/* Pinned Messages Banner */}
            {pinnedMessages.length > 0 && (
              <div className="dm-pinned-messages-tray">
                <span className="dm-pinned-label">
                  <PinIcon /> {t("friends.pinned")}
                </span>
                {pinnedMessages.map((m) => (
                  <div key={m.id} className="dm-pinned-message-item">
                    <span className="dm-pinned-author">{m.author}:</span>
                    <span className="dm-pinned-text">{m.text}</span>
                    <button
                      type="button"
                      className="dm-unpin-btn"
                      onClick={() => onTogglePinMessage(selectedDmId, m.id)}
                      title={t("friends.unpin")}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Message History */}
            <div className="dm-messages-container" ref={chatScrollRef}>
              {messages.length === 0 ? (
                <div className="dm-empty-conversation">
                  <MessageIcon />
                  <p>{t("friendsPage.noMessagesInChat")}</p>
                  <span>{t("friendsPage.sayHelloDesc", { name: selectedDmFriendName })}</span>
                </div>
              ) : (
                regularMessages.map((msg) => {
                  const isMine = msg.author === profile.name;
                  const reactionEntries = Object.entries(msg.reactions || {});
                  const seen = isMine && readReceiptsEnabled && friendReadAt >= msg.timestamp;
                  return (
                    <div key={msg.id} className={`dm-message-bubble-row${isMine ? " mine" : " friend"}`}>
                      <div className="dm-message-bubble">
                        <div className="dm-message-header">
                          <span className="dm-message-author">{isMine ? t("friendsPage.you") : msg.author}</span>
                          <span className="dm-message-time">
                            {new Date(msg.timestamp).toLocaleTimeString(undefined, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        {(msg.attachments || []).map((att) => (
                          <button
                            key={att.id}
                            type="button"
                            className="dm-attachment-thumb"
                            onClick={() => setLightboxUrl(att.dataUrl)}
                            title={att.name}
                          >
                            <img src={att.dataUrl} alt={att.name} loading="lazy" />
                          </button>
                        ))}

                        {msg.text && <div className="dm-message-body">{msg.text}</div>}

                        {reactionEntries.length > 0 && (
                          <div className="dm-message-reactions">
                            {reactionEntries.map(([author, emoji]) => (
                              <span
                                key={author}
                                className={`dm-reaction-chip${author === profile.name ? " mine" : ""}`}
                                title={author}
                              >
                                {emoji}
                              </span>
                            ))}
                          </div>
                        )}

                        {seen && <span className="dm-message-seen">{t("friendsPage.seen")}</span>}

                        <div className="dm-message-actions-hover">
                          <button
                            type="button"
                            className="dm-msg-action-btn"
                            onClick={() => setReactingToMsg(reactingToMsg === msg.id ? null : msg.id)}
                            title={t("friendsPage.reactToMessage")}
                          >
                            <SmileIcon />
                          </button>
                          <button
                            type="button"
                            className="dm-msg-action-btn"
                            onClick={() => onTogglePinMessage(selectedDmId, msg.id)}
                            title={t("friends.pin")}
                          >
                            <PinIcon />
                          </button>
                          {isMine && (
                            <button
                              type="button"
                              className="dm-msg-action-btn danger"
                              onClick={() => onDeleteMessage(selectedDmId, msg.id)}
                              title={t("common.delete")}
                            >
                              <TrashIcon />
                            </button>
                          )}
                        </div>

                        {reactingToMsg === msg.id && (
                          <div className="dm-emoji-picker">
                            {DM_EMOJI.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className={`dm-emoji-btn${(msg.reactions?.[profile.name] || "") === emoji ? " active" : ""}`}
                                onClick={() => {
                                  onReactMessage(selectedDmId, msg.id, emoji);
                                  setReactingToMsg(null);
                                }}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Composer */}
            <div className="dm-composer-bar">
              {pendingAttachment && (
                <div className="dm-attachment-preview">
                  <img src={pendingAttachment.dataUrl} alt={pendingAttachment.name} />
                  <button
                    type="button"
                    className="dm-attachment-preview-remove"
                    onClick={() => setPendingAttachment(null)}
                    title={t("common.clear")}
                  >
                    <XIcon />
                  </button>
                </div>
              )}
              <input
                ref={attachInputRef}
                type="file"
                accept="image/*"
                className="hidden-file-input"
                onChange={handlePickAttachment}
              />
              <button
                type="button"
                className="dm-attach-btn"
                onClick={() => attachInputRef.current?.click()}
                title={t("friendsPage.sendAttachment")}
              >
                <PaperclipIcon />
              </button>
              <input
                type="text"
                className="profile-input dm-composer-input"
                placeholder={t("friendsPage.typeMessagePlaceholder")}
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary dm-send-btn"
                onClick={handleSend}
                disabled={!messageDraft.trim() && !pendingAttachment}
                title={t("common.send")}
              >
                <SendIcon />
              </button>
            </div>
          </>
        ) : (
          <div className="dm-no-thread-selected">
            <div className="dm-no-thread-icon">
              <MessageIcon />
            </div>
            <h3>{t("friendsPage.selectConversationTitle")}</h3>
            <p>{t("friendsPage.selectConversationDesc")}</p>
          </div>
        )}
      </div>

      {/* Image Lightbox */}
      {lightboxUrl &&
        createPortal(
          <div className="dm-lightbox" onClick={() => setLightboxUrl(null)}>
            <img src={lightboxUrl} alt="" />
          </div>,
          document.body
        )}
    </div>
  );
}
