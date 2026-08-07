// DmsTab — 1:1 messaging. Left rail lists every non-blocked friend
// with their latest message preview; the right pane shows the open
// thread (created lazily on first send). Controller: D-pad through
// the thread rows, A opens, B leaves the pane via the page back
// handler (the hub owns Escape).

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import { displayName, dmThreadId } from "../../../pages/friendsStorage";
import type { UseFriendsSocialResult } from "../../../hooks/useFriendsSocial";
import { FriendAvatar, Icons, isOnline, useFocusableInput } from "./friendsUtils";

export interface DmsTabProps {
  social: UseFriendsSocialResult;
  profileName: string;
}

export default function DmsTab({ social, profileName }: DmsTabProps) {
  const { t } = useLanguage();
  const { dms, friends, selectedDmId, selectedDmFriendName, handleOpenDmThread } = social;

  const thread = dms.find((th) => th.id === selectedDmId);
  const friendName =
    selectedDmFriendName || thread?.participants.find((p) => p !== profileName) || "";
  const friend = friends.find((f) => f.name === friendName);
  const msgs = thread?.messages || [];

  return (
    <div className="bigscreen-dms-layout">
      {/* Thread list */}
      <div className="bigscreen-dms-threadlist">
        <div className="bigscreen-dms-threadlist-head">
          <h3>{t("friendsPage.dmThreads")}</h3>
          <span className="bigscreen-dms-threadlist-count">{dms.filter((th) => !th.deleted).length}</span>
        </div>
        {friends.filter((f) => !f.blocked).length === 0 ? (
          <div className="system-view-empty">
            <p>{t("friendsPage.noDmFriends")}</p>
            <p>{t("friendsPage.noDmFriendsDesc")}</p>
          </div>
        ) : (
          <div className="bigscreen-dms-threadlist-items">
            {friends
              .filter((f) => !f.blocked)
              .map((f) => {
                const existing = dms.find(
                  (th) => !th.deleted && th.participants.includes(profileName) && th.participants.includes(f.name),
                );
                const threadId = existing?.id || dmThreadId(profileName, f.name);
                const lastMsg = existing?.messages?.slice(-1)[0];
                return (
                  <DmThreadRow
                    key={f.id}
                    name={displayName(f)}
                    avatar={f.avatar}
                    online={isOnline(f)}
                    active={selectedDmId === threadId}
                    preview={
                      lastMsg
                        ? `${lastMsg.author === profileName ? `${t("friendsPage.dmYou")} ` : ""}${lastMsg.text}`
                        : t("friendsPage.dmStart")
                    }
                    incoming={!!lastMsg && lastMsg.author !== profileName}
                    onOpen={() => handleOpenDmThread(threadId, f.name)}
                  />
                );
              })}
          </div>
        )}
      </div>

      {/* Chat pane */}
      <div className="bigscreen-dms-pane">
        {selectedDmId ? (
          <DmPane
            key={selectedDmId}
            friendName={friendName}
            friendAvatar={friend?.avatar || "procedural"}
            online={!!friend && isOnline(friend)}
            msgs={msgs}
            profileName={profileName}
            onSend={(text) => social.handleSendDm(friendName, text)}
          />
        ) : (
          <div className="bigscreen-dms-empty">
            <div className="bigscreen-dms-empty-icon">{Icons.message()}</div>
            <h3>{t("friendsPage.dmSelectThread")}</h3>
            <p>{t("friendsPage.dmSelectThreadDesc")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thread row ───────────────────────────────────────────────────

function DmThreadRow({
  name,
  avatar,
  online,
  active,
  preview,
  incoming,
  onOpen,
}: {
  name: string;
  avatar: string;
  online: boolean;
  active: boolean;
  preview: string;
  incoming: boolean;
  onOpen: () => void;
}) {
  const rowProps = useFocusable(onOpen);
  return (
    <button
      type="button"
      className={`bigscreen-dms-thread${active ? " active" : ""}`}
      {...rowProps}
    >
      <FriendAvatar avatar={avatar} name={name} className="bigscreen-dms-thread-avatar" />
      {online && <span className="bigscreen-dms-thread-online-dot" aria-hidden />}
      <span className="bigscreen-dms-thread-meta">
        <span className="bigscreen-dms-thread-name">{name}</span>
        <span className={`bigscreen-dms-thread-preview${incoming ? " incoming" : ""}`}>{preview}</span>
      </span>
    </button>
  );
}

// ─── Chat pane ────────────────────────────────────────────────────

function DmPane({
  friendName,
  friendAvatar,
  online,
  msgs,
  profileName,
  onSend,
}: {
  friendName: string;
  friendAvatar: string;
  online: boolean;
  msgs: { id: string; author: string; text: string; timestamp: number }[];
  profileName: string;
  onSend: (text: string) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  const sendProps = useFocusable(() => submit());
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const submit = () => {
    const text = draft.trim();
    if (!text || !friendName) return;
    onSend(text);
    setDraft("");
  };

  // Scroll the newest message into view when the thread grows.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  return (
    <div className="bigscreen-dms-pane-inner">
      <div className="bigscreen-dms-pane-head">
        <FriendAvatar avatar={friendAvatar} name={friendName} className="bigscreen-dms-thread-avatar" />
        <div className="bigscreen-dms-pane-head-name">
          {friendName}
          {online && <span className="bigscreen-dms-pane-online">{t("friendsPage.formatOnline")}</span>}
        </div>
      </div>

      <div className="bigscreen-dms-pane-messages" ref={bodyRef}>
        {msgs.length === 0 ? (
          <div className="bigscreen-chat-empty">{t("friendsPage.dmNoMessages")}</div>
        ) : (
          msgs.map((m) => {
            const mine = m.author === profileName;
            return (
              <div key={m.id} className={`bigscreen-chat-bubble ${mine ? "bigscreen-chat-bubble--me" : "bigscreen-chat-bubble--them"}`}>
                <div className={`bigscreen-chat-bubble-author${mine ? " bigscreen-chat-bubble-author--right" : ""}`}>
                  {mine ? t("friendsPage.dmYou") : m.author}
                </div>
                <div className="bigscreen-chat-bubble-text">{m.text}</div>
              </div>
            );
          })
        )}
      </div>

      <div className="bigscreen-chat-input-row">
        <input
          ref={setInputRef}
          type="text"
          className="bigscreen-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("friendsPage.dmPlaceholder")}
          tabIndex={inputProps.tabIndex}
          role={inputProps.role}
          onClick={inputProps.onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
          {...sendProps}
        >
          {t("common.send")}
        </button>
      </div>
    </div>
  );
}
