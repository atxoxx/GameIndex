// DmsTab — 1:1 messaging. Left rail lists every accepted friend with
// their latest message preview; the right pane shows the open thread
// (created lazily on first send). Controller: D-pad through the thread
// rows, A opens, B leaves the pane via the page back handler (the hub
// owns Escape).
//
// Threads are pubkey-addressed once the engine re-keys them, so a thread
// is matched to a friend by `peerForThread(threadId)` and the friend's
// `syncId` — never by display name, which can be changed locally.

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import {
  type Friend,
  type DmThread,
  displayName,
  dmThreadId,
  startDmThreadId,
  visibleMessages,
} from "../../../pages/friendsStorage";
import type { PeerSyncState } from "../../../sync/friends/engine";
import { asPeerPubkey } from "../../../pages/friends/friendsSyncHelpers";
import {
  isPeerOnline,
  peerCurrentlyPlaying,
  peerDeliveryState,
} from "../../../pages/friends/friendsSyncPresentation";
import type { UseFriendsSocialResult } from "../../../hooks/useFriendsSocial";
import { FriendAvatar, Icons, isOnline, useFocusableInput } from "./friendsUtils";

export interface DmsTabProps {
  social: UseFriendsSocialResult;
  profileName: string;
  /** Our own pubkey, needed for the pair thread id. */
  myPubkey?: string;
  /** Per-peer engine state, keyed by pubkey. */
  peerStates: Record<string, PeerSyncState>;
}

export default function DmsTab({ social, profileName, myPubkey, peerStates }: DmsTabProps) {
  const { t } = useLanguage();
  const { dms, friends, selectedDmId, selectedDmFriendName, handleOpenDmThread, peerForThread } = social;

  const acceptedFriends = friends.filter((f) => !f.blocked && f.consent !== "pending");

  const peerThreadId = (peer: string) => {
    const mine = asPeerPubkey(myPubkey);
    return mine ? dmThreadId(mine, peer) : null;
  };

  /** Thread holding this friend's conversation, pubkey-addressed first. */
  const threadForFriend = (friend: Friend): DmThread | undefined => {
    const peer = asPeerPubkey(friend.syncId);
    if (peer) {
      const addressed = dms.find((th) => !th.deleted && peerForThread(th.id) === peer);
      if (addressed) return addressed;
      const pairId = peerThreadId(peer);
      const pair = pairId ? dms.find((th) => th.id === pairId) : undefined;
      if (pair) return pair;
      return undefined;
    }
    return dms.find(
      (th) =>
        !th.deleted &&
        th.participants.includes(profileName) &&
        th.participants.includes(friend.name),
    );
  };

  const selectedPeer = selectedDmId ? peerForThread(selectedDmId) : null;
  const friend =
    (selectedPeer
      ? acceptedFriends.find((f) => asPeerPubkey(f.syncId) === selectedPeer)
      : undefined) ??
    acceptedFriends.find((f) => f.name === selectedDmFriendName || displayName(f) === selectedDmFriendName);
  const peerState = selectedPeer ? peerStates[selectedPeer] : undefined;

  const thread = dms.find((th) => th.id === selectedDmId);
  const friendName = friend ? displayName(friend) : selectedDmFriendName;
  const msgs = visibleMessages(thread?.messages);

  return (
    <div className="bigscreen-dms-layout">
      {/* Thread list */}
      <div className="bigscreen-dms-threadlist">
        <div className="bigscreen-dms-threadlist-head">
          <h3>{t("friendsPage.dmThreads")}</h3>
          <span className="bigscreen-dms-threadlist-count">{dms.filter((th) => !th.deleted).length}</span>
        </div>
        {acceptedFriends.length === 0 ? (
          <div className="system-view-empty">
            <p>{t("friendsPage.noDmFriends")}</p>
            <p>{t("friendsPage.noDmFriendsDesc")}</p>
          </div>
        ) : (
          <div className="bigscreen-dms-threadlist-items">
            {acceptedFriends.map((f) => {
              const peer = asPeerPubkey(f.syncId);
              const existing = threadForFriend(f);
              const threadId =
                existing?.id ??
                (peer ? peerThreadId(peer) : null) ??
                startDmThreadId(profileName, f.name, dms);
              const lastMsg = visibleMessages(existing?.messages).slice(-1)[0];
              const state = peer ? peerStates[peer] : undefined;
              return (
                <DmThreadRow
                  key={f.id}
                  name={displayName(f)}
                  avatar={f.avatar}
                  online={
                    state ? isPeerOnline(state) || !!peerCurrentlyPlaying(state) : isOnline(f)
                  }
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
            online={
              peerState
                ? isPeerOnline(peerState) || !!peerCurrentlyPlaying(peerState)
                : !!friend && isOnline(friend)
            }
            delivery={selectedPeer ? peerDeliveryState(peerState) : "none"}
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

const DELIVERY_LABEL = {
  seen: "friendsPage.syncSeen",
  delivered: "friendsPage.syncDelivered",
  none: null,
} as const;

function DmPane({
  friendName,
  friendAvatar,
  online,
  delivery,
  msgs,
  profileName,
  onSend,
}: {
  friendName: string;
  friendAvatar: string;
  online: boolean;
  delivery: "seen" | "delivered" | "none";
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
          {delivery !== "none" && (
            <span className={`bigscreen-dms-pane-delivery is-${delivery}`}>
              {t(DELIVERY_LABEL[delivery] as string)}
            </span>
          )}
          <span className="bigscreen-dms-pane-private">{t("friendsPage.messagesPrivate")}</span>
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
          aria-label={t("friendsPage.dmPlaceholder")}
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
