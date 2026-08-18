import { useState, useRef, useEffect } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { GameSession, UserProfile, Friend, SessionRole, RsvpStatus } from "./friendsTypes";
import {
  formatDateTime,
  tzAbbrev,
  countdownLabel,
  isOnline,
  ClockIcon,
  TrashIcon,
  NoteIcon,
  XIcon,
  UsersIcon,
  MessageIcon,
  PinIcon,
  EditIcon,
  PlayIcon,
  RepeatIcon,
  VoteIcon,
  CheckIcon,
} from "./friendsUtils";

const SESSION_ROLE_ORDER: SessionRole[] = ["host", "cohost", "player"];

interface SessionCardProps {
  session: GameSession;
  profile: UserProfile;
  friends: Friend[];
  viewerTimezone?: string;
  conflicting?: GameSession;
  gameCover?: string;
  onRsvp: (sessionId: string, status: RsvpStatus) => void;
  onEdit?: (session: GameSession) => void;
  onDelete: (sessionId: string) => void;
  onLaunch?: (session: GameSession) => void;
  onVotePoll?: (sessionId: string, optionId: string) => void;
  onFinalizePoll?: (sessionId: string, optionId: string) => void;
  onSetRole: (sessionId: string, name: string, role: SessionRole) => void;
  onAddGuest: (sessionId: string, guestName: string) => void;
  onRemoveGuest: (sessionId: string, guestName: string) => void;
  onSetRsvpNote: (sessionId: string, note: string) => void;
  onSendMessage: (sessionId: string, text: string) => void;
  onTogglePinMessage: (sessionId: string, messageId: string) => void;
}

export default function SessionCard({
  session,
  profile,
  friends,
  viewerTimezone,
  conflicting,
  gameCover,
  onRsvp,
  onEdit,
  onDelete,
  onLaunch,
  onVotePoll,
  onFinalizePoll,
  onSetRole,
  onAddGuest,
  onRemoveGuest,
  onSetRsvpNote,
  onSendMessage,
  onTogglePinMessage,
}: SessionCardProps) {
  const { t } = useLanguage();
  const [now, setNow] = useState(Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [guestDraft, setGuestDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState(
    session.rsvps?.[profile.name]
      ? session.participants?.find((p) => p.name === profile.name)?.note || ""
      : ""
  );
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (chatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatOpen, session.messages?.length]);

  const isCreator = session.creatorName === profile.name;
  const myRsvp = session.rsvps?.[profile.name];
  const canManage =
    isCreator ||
    session.participants?.some((p) => p.name === profile.name && (p.role === "host" || p.role === "cohost"));

  const going = Object.entries(session.rsvps || {}).filter(([, v]) => v === "going").map(([n]) => n);
  const maybe = Object.entries(session.rsvps || {}).filter(([, v]) => v === "maybe").map(([n]) => n);
  const declined = Object.entries(session.rsvps || {}).filter(([, v]) => v === "declined").map(([n]) => n);

  // Collect all unique user names involved in the session
  const allUserNames = new Set<string>();
  if (session.creatorName) allUserNames.add(session.creatorName);
  (session.participants || []).forEach((p) => allUserNames.add(p.name));
  (session.attendees || []).forEach((n) => allUserNames.add(n));
  (session.invited || []).forEach((n) => allUserNames.add(n));
  Object.keys(session.rsvps || {}).forEach((n) => allUserNames.add(n));

  const playerList = Array.from(allUserNames).map((name) => {
    const participant = session.participants?.find((p) => p.name === name);
    const rsvpStatus: RsvpStatus | "invited" = session.rsvps?.[name]
      ? session.rsvps[name]
      : (session.attendees || []).includes(name) || name === session.creatorName
      ? "going"
      : "invited";

    const role: SessionRole = participant?.role || (name === session.creatorName ? "host" : "player");
    const isGuest = !!participant?.guest;
    const note = participant?.note || "";
    const friend = friends.find((f) => f.name === name);
    const online = name === profile.name ? true : friend ? isOnline(friend) : false;

    return {
      name,
      rsvp: rsvpStatus,
      role,
      isGuest,
      note,
      online,
    };
  });

  const rsvpWeight: Record<string, number> = { going: 0, maybe: 1, invited: 2, declined: 3 };
  playerList.sort((a, b) => {
    const roleDiff = SESSION_ROLE_ORDER.indexOf(a.role) - SESSION_ROLE_ORDER.indexOf(b.role);
    if (roleDiff !== 0) return roleDiff;
    const rsvpDiff = (rsvpWeight[a.rsvp] ?? 9) - (rsvpWeight[b.rsvp] ?? 9);
    if (rsvpDiff !== 0) return rsvpDiff;
    return a.name.localeCompare(b.name);
  });

  const messages = session.messages || [];
  const pinned = messages.filter((m) => m.pinned);
  const thread = messages.filter((m) => !m.pinned);

  const showTimeForViewer =
    viewerTimezone && session.creatorTimezone && viewerTimezone !== session.creatorTimezone;

  const submitNote = () => {
    onSetRsvpNote(session.id, noteDraft.trim());
  };

  const submitGuest = () => {
    const name = guestDraft.trim();
    if (!name) return;
    onAddGuest(session.id, name);
    setGuestDraft("");
  };

  const submitChat = () => {
    const text = chatDraft.trim();
    if (!text) return;
    onSendMessage(session.id, text);
    setChatDraft("");
  };

  return (
    <div className={`session-card${conflicting ? " session-conflict" : ""}`}>
      {/* 1. Header with Cover, Info, Countdown & Delete */}
      <div className="session-card-header">
        <div className="session-card-cover-wrap">
          {gameCover ? (
            <img
              src={gameCover}
              alt={session.gameName}
              className="session-card-cover"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="session-card-cover-placeholder">
              {session.gameName.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        <div className="session-card-meta">
          <div className="session-card-title-row">
            <h4 className="session-game-title" title={session.gameName}>
              {session.gameName}
            </h4>
            {session.durationMin ? (
              <span className="session-duration-tag">{session.durationMin}m</span>
            ) : null}
            {session.recurrence && (
              <span className="session-recurrence-tag" title={session.recurrence.until ? t("friendsPage.repeatsUntil", { freq: t(`friendsPage.recurrence.${session.recurrence.frequency}`), until: session.recurrence.until }) : ""}>
                <RepeatIcon /> {t(`friendsPage.recurrence.${session.recurrence.frequency}`)}
              </span>
            )}
          </div>

          {session.scheduledAt && (
            <div className="session-date-row">
              <ClockIcon />
              <span>{formatDateTime(session.scheduledAt, session.creatorTimezone)} {tzAbbrev(session.scheduledAt, session.creatorTimezone)}</span>
            </div>
          )}

          {session.scheduledAt && showTimeForViewer && (
            <div className="session-date-local">
              {t("friendsPage.yourTime")} {formatDateTime(session.scheduledAt, viewerTimezone)} {tzAbbrev(session.scheduledAt, viewerTimezone)}
            </div>
          )}

          {session.creatorTimezone && session.scheduledAt && (
            <div className="session-tz-note">
              {t("friendsPage.scheduledIn", { tz: session.creatorTimezone.replace(/_/g, " ") })}
            </div>
          )}
        </div>

        <div className="session-card-top-actions">
          {session.scheduledAt ? (
            <span
              className={`session-countdown-pill${new Date(session.scheduledAt).getTime() - now <= 0 ? " live" : ""}`}
              title={t("friendsPage.timeUntilStart")}
            >
              <ClockIcon />
              {countdownLabel(session.scheduledAt, t)}
            </span>
          ) : (
            <span className="session-countdown-pill poll">
              <VoteIcon />
              {t("friendsPage.pollOpenShort")}
            </span>
          )}
          {onLaunch && (
            <button
              type="button"
              className="session-launch-btn"
              onClick={() => onLaunch(session)}
              title={t("friendsPage.launchGame")}
            >
              <PlayIcon />
            </button>
          )}
          {isCreator && onEdit && (
            <button
              type="button"
              className="session-edit-btn"
              onClick={() => onEdit(session)}
              title={t("friendsPage.editSession")}
            >
              <EditIcon />
            </button>
          )}
          {isCreator && (
            <button
              type="button"
              className="session-delete-btn"
              onClick={() => onDelete(session.id)}
              title={t("friends.removeSession")}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {/* Poll Section (no fixed time yet) */}
      {session.poll && session.poll.options.length > 0 && (
        <div className="session-poll-section">
          <div className="session-poll-header">
            <span className="session-poll-title">
              <VoteIcon /> {t("friendsPage.pollOpen")}
            </span>
            {session.poll.options.length > 1 && (
              <span className="session-poll-hint">{t("friendsPage.pollHint")}</span>
            )}
          </div>
          <div className="session-poll-options">
            {session.poll.options.map((opt) => {
              const voters = session.poll?.votes[opt.id] || [];
              const voted = voters.includes(profile.name);
              return (
                <div key={opt.id} className={`session-poll-option${voted ? " voted" : ""}`}>
                  <div className="session-poll-option-main">
                    <span className="session-poll-time">{formatDateTime(opt.label)}</span>
                    <span className="session-poll-votes">
                      {voters.length > 0 ? `${voters.length} ✓` : ""}
                    </span>
                  </div>
                  <div className="session-poll-option-actions">
                    <button
                      type="button"
                      className={`btn btn-secondary btn--mini${voted ? " active" : ""}`}
                      onClick={() => onVotePoll?.(session.id, opt.id)}
                    >
                      {voted ? t("friendsPage.voted") : t("friendsPage.vote")}
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        className="btn btn-primary btn--mini"
                        onClick={() => onFinalizePoll?.(session.id, opt.id)}
                      >
                        <CheckIcon /> {t("friendsPage.finalizeTime")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Card Content (Description & Conflict Alert) */}
      {(session.description || conflicting) && (
        <div className="session-card-body">
          {session.description && <p className="session-desc">{session.description}</p>}

          {conflicting && (
            <div className="session-conflict-banner">
              {t("friendsPage.overlapsWarning", {
                game: conflicting.gameName,
                time: formatDateTime(conflicting.scheduledAt, conflicting.creatorTimezone),
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. Roster Section */}
      <div className="session-roster-section">
        <div className="session-roster-header">
          <div className="session-roster-title-group">
            <span className="session-roster-title">
              <UsersIcon /> {t("friendsPage.goingCount", { going: going.length, max: session.maxPlayers }).replace(/^👥\s*/, "")}
            </span>
            <div className="session-rsvp-mini-summary">
              <span className="rsvp-mini-chip going" title={t("friends.going")}>
                ✓ {going.length}
              </span>
              {maybe.length > 0 && (
                <span className="rsvp-mini-chip maybe" title={t("friends.maybe")}>
                  ? {maybe.length}
                </span>
              )}
              {declined.length > 0 && (
                <span className="rsvp-mini-chip declined" title={t("friends.cant")}>
                  ✕ {declined.length}
                </span>
              )}
            </div>
          </div>
          <span className="session-creator-tag">
            {t("friendsPage.by")} {isCreator ? t("friendsPage.me") : session.creatorName}
          </span>
        </div>

        <div className="session-roster-list">
          {playerList.map((p) => (
            <div key={p.name} className={`roster-row rsvp-${p.rsvp}${p.name === profile.name ? " self" : ""}`}>
              <span
                className={`roster-dot${p.online ? " online" : ""}`}
                title={p.online ? t("friendsPage.onlineNow") : t("friendsPage.offline")}
              />
              <span className="roster-name">
                {p.name}
                {p.isGuest ? ` (${t("friendsPage.guestSuffix") || "Guest"})` : ""}
              </span>

              {canManage && p.name !== profile.name ? (
                <select
                  className={`roster-role-select role-${p.role}`}
                  value={p.role}
                  onChange={(e) => onSetRole(session.id, p.name, e.target.value as SessionRole)}
                  title={t("friends.changeRole")}
                >
                  <option value="player">{t("friends.player")}</option>
                  <option value="cohost">{t("friends.cohost")}</option>
                  <option value="host">{t("friends.host")}</option>
                </select>
              ) : (
                <span className={`roster-role role-${p.role}`}>{t(`friends.${p.role}`)}</span>
              )}
              
              <span className={`roster-rsvp-badge rsvp-${p.rsvp}`} title={p.rsvp}>
                {p.rsvp === "going" ? (
                  <span>{t("friends.going")}</span>
                ) : p.rsvp === "maybe" ? (
                  <span>{t("friends.maybe")}</span>
                ) : p.rsvp === "declined" ? (
                  <span>{t("friends.cant")}</span>
                ) : (
                  <span>⏳ {t("friendsPage.invitedStatus") || "Invited"}</span>
                )}
              </span>

              {p.note && (
                <span className="roster-note" title={p.note}>
                  <NoteIcon />
                  <span>{p.note}</span>
                </span>
              )}

              {p.isGuest && canManage && (
                <button
                  type="button"
                  className="roster-remove"
                  onClick={() => onRemoveGuest(session.id, p.name)}
                  title={t("friends.removeGuest")}
                >
                  <XIcon />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* +1 Guest Invite (for attendees) */}
        {myRsvp === "going" && (
          <div className="session-guest-row">
            <input
              className="profile-input session-guest-input"
              placeholder={t("friends.bringGuest")}
              value={guestDraft}
              onChange={(e) => setGuestDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitGuest()}
            />
            <button type="button" className="btn btn-secondary btn--mini" onClick={submitGuest}>
              +1
            </button>
          </div>
        )}

        {/* RSVP Note editor */}
        {myRsvp && (
          <div className="session-note-row">
            <input
              className="profile-input session-note-input"
              placeholder={t("friends.whatBringing")}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={submitNote}
            />
            <button type="button" className="btn btn-secondary btn--mini" onClick={submitNote}>
              {t("common.save")}
            </button>
          </div>
        )}
      </div>

      {/* 4. RSVP Action Bar & Chat Toggle */}
      <div className="session-rsvp-bar">
        <div className="session-rsvp-buttons">
          {(["going", "maybe", "declined"] as RsvpStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              className={`rsvp-btn rsvp-${status}${myRsvp === status ? " active" : ""}`}
              onClick={() => onRsvp(session.id, status)}
            >
              {status === "going" ? t("friends.going") : status === "maybe" ? t("friends.maybe") : t("friends.cant")}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`session-chat-toggle${chatOpen ? " active" : ""}`}
          onClick={() => setChatOpen((v) => !v)}
          title={t("friends.sessionChat")}
        >
          <MessageIcon />
          {messages.length > 0 && <span className="session-chat-count">{messages.length}</span>}
        </button>
      </div>

      {/* 5. Collapsible Chat Drawer */}
      {chatOpen && (
        <div className="session-chat-drawer">
          {pinned.length > 0 && (
            <div className="session-chat-pinned">
              {pinned.map((m) => (
                <div key={m.id} className="chat-msg pinned">
                  <span className="chat-author">{m.author}</span>
                  <span className="chat-text">{m.text}</span>
                  {canManage && (
                    <button
                      type="button"
                      className="chat-pin-btn"
                      onClick={() => onTogglePinMessage(session.id, m.id)}
                      title={t("friends.unpin")}
                    >
                      <PinIcon />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="session-chat-thread">
            {thread.length === 0 && pinned.length === 0 && (
              <div className="chat-empty">{t("friendsPage.noMessages")}</div>
            )}
            {thread.map((m) => (
              <div key={m.id} className={`chat-msg${m.author === profile.name ? " mine" : ""}`}>
                <span className="chat-author">{m.author}</span>
                <span className="chat-text">{m.text}</span>
                {canManage && (
                  <button
                    type="button"
                    className="chat-pin-btn"
                    onClick={() => onTogglePinMessage(session.id, m.id)}
                    title={t("friends.pin")}
                  >
                    <PinIcon />
                  </button>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="session-chat-input">
            <input
              className="profile-input"
              placeholder={t("friends.messageGroup")}
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitChat()}
            />
            <button type="button" className="btn btn-primary btn--mini" onClick={submitChat}>
              {t("common.send")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
