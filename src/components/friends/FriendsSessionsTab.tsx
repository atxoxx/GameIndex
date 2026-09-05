import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import type {
  GameSession,
  UserProfile,
  Friend,
  SessionRole,
  RsvpStatus,
} from "./friendsTypes";
import SessionCard from "./SessionCard";
import {
  formatDateTime,
  sessionsConflict,
  detectTimezone,
  nextOccurrence,
  GamePicker,
  CalendarIcon,
  PlusIcon,
  ClockIcon,
  XIcon,
} from "./friendsUtils";

interface FriendsSessionsTabProps {
  sessions: GameSession[];
  profile: UserProfile;
  friends: Friend[];
  libraryGames: any[];
  /** Friend name to pre-invite when the create-session form opens (from a
   *  friend card's "Invite to session" action). */
  prefillInvite?: string | null;
  /** Called after the prefill has been applied so it isn't re-applied. */
  onPrefillConsumed?: () => void;
  onRsvp: (sessionId: string, status: RsvpStatus) => void;
  onCreateSession: (session: Omit<GameSession, "id" | "updatedAt">) => void;
  onEditSession: (sessionId: string, session: Omit<GameSession, "id" | "updatedAt">) => void;
  onDeleteSession: (sessionId: string) => void;
  onVotePoll: (sessionId: string, optionId: string) => void;
  onFinalizePoll: (sessionId: string, optionId: string) => void;
  onLaunchGame?: (gameId: string) => void;
  onSetRole: (sessionId: string, name: string, role: SessionRole) => void;
  onAddGuest: (sessionId: string, guestName: string) => void;
  onRemoveGuest: (sessionId: string, guestName: string) => void;
  onSetRsvpNote: (sessionId: string, note: string) => void;
  onSendMessage: (sessionId: string, text: string) => void;
  onTogglePinMessage: (sessionId: string, messageId: string) => void;
}

export default function FriendsSessionsTab({
  sessions,
  profile,
  friends,
  libraryGames,
  prefillInvite,
  onPrefillConsumed,
  onRsvp,
  onCreateSession,
  onEditSession,
  onDeleteSession,
  onVotePoll,
  onFinalizePoll,
  onLaunchGame,
  onSetRole,
  onAddGuest,
  onRemoveGuest,
  onSetRsvpNote,
  onSendMessage,
  onTogglePinMessage,
}: FriendsSessionsTabProps) {
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<"upcoming" | "past" | "agenda">("upcoming");
  const [agendaMode, setAgendaMode] = useState<"grid" | "list">("grid");
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "mine" | "going">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSession, setEditingSession] = useState<GameSession | null>(null);

  // Form State for creating session
  const [gameId, setGameId] = useState("");
  const [gameName, setGameName] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [durationMin, setDurationMin] = useState(120);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [description, setDescription] = useState("");
  const [invitedFriends, setInvitedFriends] = useState<string[]>([]);
  const [recurrenceFreq, setRecurrenceFreq] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [pollMode, setPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>([]);

  const viewerTimezone = useMemo(() => detectTimezone(), []);

  // Ticks every minute so recurring sessions roll forward to their next
  // occurrence and the upcoming/past split stays honest over time.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);

  // Active non-deleted sessions
  const activeSessions = useMemo(() => {
    return sessions.filter((s) => !s.deleted);
  }, [sessions]);

  // Recurring sessions render as their next occurrence; exhausted rules fall
  // back to the stored (past) time so they land in history.
  const effectiveSessions = useMemo(() => {
    return activeSessions.map((s) => {
      if (!s.recurrence) return s;
      const next = nextOccurrence(s.scheduledAt, s.recurrence, nowTick);
      return next ? { ...s, scheduledAt: next } : s;
    });
  }, [activeSessions, nowTick]);

  // Conflict warning calculation for new session form
  const potentialConflict = useMemo(() => {
    if (!dateTime || pollMode) return undefined;
    return activeSessions.find((s) =>
      sessionsConflict({ scheduledAt: dateTime, durationMin }, s)
    );
  }, [dateTime, durationMin, activeSessions, pollMode]);

  // Filtered upcoming vs past sessions
  const { upcomingSessions, pastSessions } = useMemo(() => {
    let list = [...effectiveSessions];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.gameName.toLowerCase().includes(q) ||
          s.creatorName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
    }

    if (filterMode === "mine") {
      list = list.filter((s) => s.creatorName === profile.name);
    } else if (filterMode === "going") {
      list = list.filter((s) => s.rsvps?.[profile.name] === "going");
    }

    const upcoming = list
      .filter((s) => {
        const t = new Date(s.scheduledAt).getTime();
        // Poll sessions have no fixed time yet — they belong in "upcoming".
        return Number.isNaN(t) ? !!s.poll : t > nowTick;
      })
      .sort((a, b) => {
        const ta = new Date(a.scheduledAt).getTime() || Infinity;
        const tb = new Date(b.scheduledAt).getTime() || Infinity;
        return ta - tb;
      });

    const past = list
      .filter((s) => {
        const t = new Date(s.scheduledAt).getTime();
        return !Number.isNaN(t) && t <= nowTick;
      })
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

    return { upcomingSessions: upcoming, pastSessions: past };
  }, [effectiveSessions, searchQuery, filterMode, profile.name, nowTick]);

  // Agenda Day grouping
  const agendaDays = useMemo(() => {
    const map = new Map<string, GameSession[]>();
    upcomingSessions.forEach((s) => {
      const d = new Date(s.scheduledAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [upcomingSessions]);

  const libraryCoverMap = useMemo(() => {
    const map = new Map<string, string>();
    libraryGames.forEach((g) => {
      if (g.coverArtUrl) map.set(String(g.id), g.coverArtUrl);
    });
    return map;
  }, [libraryGames]);

  const getCoverForSession = (s: GameSession) => {
    return libraryCoverMap.get(s.gameId);
  };

  const resetForm = () => {
    setGameId("");
    setGameName("");
    setDateTime("");
    setDurationMin(120);
    setMaxPlayers(4);
    setDescription("");
    setInvitedFriends([]);
    setRecurrenceFreq("none");
    setRecurrenceUntil("");
    setPollMode(false);
    setPollOptions([]);
  };

  const openEdit = (session: GameSession) => {
    setEditingSession(session);
    setGameId(session.gameId.startsWith("custom_") ? "" : session.gameId);
    setGameName(session.gameName);
    setDateTime(session.scheduledAt || "");
    setDurationMin(session.durationMin || 120);
    setMaxPlayers(session.maxPlayers || 4);
    setDescription(session.description || "");
    setInvitedFriends(session.invited || []);
    setRecurrenceFreq(session.recurrence?.frequency || "none");
    setRecurrenceUntil(session.recurrence?.until || "");
    setPollMode(false);
    setPollOptions([]);
    setShowCreateModal(true);
  };

  const addPollOption = () => {
    if (pollOptions.length >= 4) return;
    setPollOptions((prev) => [...prev, ""]);
  };

  const updatePollOption = (i: number, value: string) => {
    setPollOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  };

  const removePollOption = (i: number) => {
    setPollOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const recurrenceRule = () =>
    recurrenceFreq !== "none"
      ? { frequency: recurrenceFreq, ...(recurrenceUntil ? { until: recurrenceUntil } : {}) }
      : undefined;

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSession) {
      handleEditSubmit(e);
      return;
    }
    if (!gameName.trim()) return;
    if (!pollMode && !dateTime) return;

    const slots = pollOptions.filter(Boolean);
    onCreateSession({
      gameId: gameId || `custom_${Date.now()}`,
      gameName: gameName.trim(),
      scheduledAt: pollMode ? "" : dateTime,
      durationMin,
      maxPlayers,
      description: description.trim(),
      creatorName: profile.name,
      creatorTimezone: viewerTimezone,
      invited: invitedFriends,
      attendees: [profile.name],
      rsvps: { [profile.name]: "going" },
      participants: [{ name: profile.name, role: "host", timezone: viewerTimezone }],
      messages: [],
      poll:
        pollMode && slots.length > 0
          ? {
              options: slots.map((label) => ({
                id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                label,
              })),
              votes: {},
            }
          : undefined,
      recurrence: recurrenceRule(),
    });

    setShowCreateModal(false);
    resetForm();
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSession || !gameName.trim() || !dateTime) return;

    onEditSession(editingSession.id, {
      gameId: gameId || `custom_${Date.now()}`,
      gameName: gameName.trim(),
      scheduledAt: dateTime,
      durationMin,
      maxPlayers,
      description: description.trim(),
      creatorName: editingSession.creatorName,
      creatorTimezone: viewerTimezone,
      invited: invitedFriends,
      // Attendee state is preserved — editing only touches the scheduled fields.
      attendees: editingSession.attendees || [profile.name],
      rsvps: editingSession.rsvps || { [profile.name]: "going" },
      participants: editingSession.participants || [],
      messages: editingSession.messages || [],
      poll: undefined,
      recurrence: recurrenceRule(),
    });

    setShowCreateModal(false);
    setEditingSession(null);
    resetForm();
  };

  const toggleInviteFriend = (friendName: string) => {
    setInvitedFriends((prev) =>
      prev.includes(friendName) ? prev.filter((n) => n !== friendName) : [...prev, friendName]
    );
  };

  // Apply a friend-card "Invite to session" request: open the create form
  // with that friend pre-selected in the invitee list.
  useEffect(() => {
    if (!prefillInvite) return;
    setInvitedFriends((prev) => (prev.includes(prefillInvite) ? prev : [...prev, prefillInvite]));
    setShowCreateModal(true);
    onPrefillConsumed?.();
  }, [prefillInvite, onPrefillConsumed]);

  return (
    <div className="friends-sessions-section">
      {/* Sessions Toolbar */}
      <div className="sessions-toolbar">
        <div className="sessions-view-pills">
          <button
            type="button"
            className={`session-view-pill${viewMode === "upcoming" ? " active" : ""}`}
            onClick={() => setViewMode("upcoming")}
          >
            {t("friendsPage.upcoming")} ({upcomingSessions.length})
          </button>
          <button
            type="button"
            className={`session-view-pill${viewMode === "agenda" ? " active" : ""}`}
            onClick={() => setViewMode("agenda")}
          >
            {t("friendsPage.agendaCalendar")}
          </button>
          <button
            type="button"
            className={`session-view-pill${viewMode === "past" ? " active" : ""}`}
            onClick={() => setViewMode("past")}
          >
            {t("friendsPage.pastHistory")} ({pastSessions.length})
          </button>
        </div>

        <div className="sessions-filter-cluster">
          <input
            type="text"
            className="profile-input sessions-search-input"
            placeholder={t("friendsPage.searchSessionsPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="friends-sort-wrapper">
            <select
              className="friends-sort-select"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as any)}
              aria-label={t("library.filter.status")}
            >
              <option value="all">{t("friends.all")}</option>
              <option value="mine">{t("friendsPage.hostedByMe")}</option>
              <option value="going">{t("friendsPage.confirmedGoing")}</option>
            </select>
          </div>

          <button
            type="button"
            className="btn btn-primary btn--mini"
            onClick={() => setShowCreateModal(true)}
          >
            <PlusIcon /> {t("friends.scheduleSession")}
          </button>
        </div>
      </div>

      {/* Main Content Areas */}
      {viewMode === "upcoming" && (
        <div className="sessions-content-view">
          {upcomingSessions.length === 0 ? (
            <div className="friends-empty-state">
              <div className="friends-empty-icon">
                <CalendarIcon />
              </div>
              <h3 className="friends-empty-title">{t("friends.noSessions")}</h3>
              <p className="friends-empty-desc">{t("friendsPage.noUpcomingSessionsDesc")}</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowCreateModal(true)}
              >
                <PlusIcon /> {t("friends.scheduleSession")}
              </button>
            </div>
          ) : (
            <div className="sessions-grid">
              {upcomingSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  profile={profile}
                  friends={friends}
                  viewerTimezone={viewerTimezone}
                  gameCover={getCoverForSession(session)}
                  onRsvp={onRsvp}
                  onEdit={openEdit}
                  onDelete={onDeleteSession}
                  onLaunch={onLaunchGame ? (s) => onLaunchGame(s.gameId) : undefined}
                  onVotePoll={onVotePoll}
                  onFinalizePoll={onFinalizePoll}
                  onSetRole={onSetRole}
                  onAddGuest={onAddGuest}
                  onRemoveGuest={onRemoveGuest}
                  onSetRsvpNote={onSetRsvpNote}
                  onSendMessage={onSendMessage}
                  onTogglePinMessage={onTogglePinMessage}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {viewMode === "agenda" && (
        <div className="sessions-agenda-view">
          <div className="agenda-mode-toggle">
            <button
              type="button"
              className={`btn btn-secondary btn--mini${agendaMode === "grid" ? " active" : ""}`}
              onClick={() => setAgendaMode("grid")}
            >
              {t("friendsPage.calendarGrid")}
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn--mini${agendaMode === "list" ? " active" : ""}`}
              onClick={() => setAgendaMode("list")}
            >
              {t("friendsPage.timelineList")}
            </button>
          </div>

          {agendaDays.length === 0 ? (
            <div className="friends-empty-state">
              <CalendarIcon />
              <p>{t("friendsPage.noScheduledAgenda")}</p>
            </div>
          ) : (
            <div className={`agenda-container mode-${agendaMode}`}>
              {agendaDays.map(([dateKey, daySessions]) => {
                const isExpanded = expandedDay === dateKey;
                const dayDate = new Date(daySessions[0].scheduledAt);
                return (
                  <div key={dateKey} className="agenda-day-group">
                    <div
                      className="agenda-day-header"
                      onClick={() => setExpandedDay(isExpanded ? null : dateKey)}
                    >
                      <div className="agenda-day-date">
                        <span className="agenda-day-name">
                          {dayDate.toLocaleDateString(undefined, { weekday: "short" })}
                        </span>
                        <span className="agenda-day-number">
                          {dayDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <span className="agenda-day-count">
                        {t("friendsPage.sessionsCount", { count: daySessions.length })}
                      </span>
                    </div>

                    <div className="agenda-day-sessions-list">
                      {daySessions.map((s) => (
                        <div key={s.id} className="agenda-session-snippet">
                          <div className="agenda-snippet-time">
                            <ClockIcon />
                            {new Date(s.scheduledAt).toLocaleTimeString(undefined, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                          <div className="agenda-snippet-title">{s.gameName}</div>
                          <div className="agenda-snippet-host">
                            {t("friendsPage.host")}: {s.creatorName}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {viewMode === "past" && (
        <div className="sessions-content-view">
          {pastSessions.length === 0 ? (
            <div className="friends-empty-state">
              <CalendarIcon />
              <p>{t("friendsPage.noPastSessions")}</p>
            </div>
          ) : (
            <div className="sessions-grid past-sessions">
              {pastSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  profile={profile}
                  friends={friends}
                  viewerTimezone={viewerTimezone}
                  gameCover={getCoverForSession(session)}
                  onRsvp={onRsvp}
                  onEdit={openEdit}
                  onDelete={onDeleteSession}
                  onLaunch={onLaunchGame ? (s) => onLaunchGame(s.gameId) : undefined}
                  onVotePoll={onVotePoll}
                  onFinalizePoll={onFinalizePoll}
                  onSetRole={onSetRole}
                  onAddGuest={onAddGuest}
                  onRemoveGuest={onRemoveGuest}
                  onSetRsvpNote={onSetRsvpNote}
                  onSendMessage={onSendMessage}
                  onTogglePinMessage={onTogglePinMessage}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Session Modal */}
      {showCreateModal &&
        createPortal(
          <div className="friends-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="friends-modal-box friends-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="friends-modal-header">
              <h2 className="friends-modal-title">
                <CalendarIcon /> {editingSession ? t("friendsPage.editSession") : t("friends.scheduleSession")}
              </h2>
              <button
                type="button"
                className="friends-modal-close"
                onClick={() => setShowCreateModal(false)}
                title={t("common.close")}
              >
                <XIcon />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="friends-modal-body">
                <div className="form-group">
                  <label className="form-label">{t("friendsPage.selectGame")}</label>
                  <GamePicker
                    libraryGames={libraryGames}
                    friends={friends}
                    selectedGameId={gameId}
                    selectedGameName={gameName}
                    onSelect={(g) => {
                      setGameId(g.id);
                      setGameName(g.name);
                    }}
                  />
                </div>

                <div className="form-row-grid">
                  <div className="form-group">
                    {!editingSession && (
                      <label className="invitee-check-pill session-poll-toggle">
                        <input
                          type="checkbox"
                          checked={pollMode}
                          onChange={(e) => setPollMode(e.target.checked)}
                        />
                        <span>{t("friendsPage.pollPropose")}</span>
                      </label>
                    )}
                    {!pollMode ? (
                      <>
                        <label className="form-label">{t("friendsPage.dateAndTime")}</label>
                        <input
                          type="datetime-local"
                          className="profile-input"
                          value={dateTime}
                          onChange={(e) => setDateTime(e.target.value)}
                          required
                        />
                        {viewerTimezone && (
                          <span className="form-helper-text">
                            {t("friendsPage.yourTimezone")}: {viewerTimezone.replace(/_/g, " ")}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <label className="form-label">{t("friendsPage.pollOptions")}</label>
                        <div className="session-poll-form-options">
                          {pollOptions.map((opt, i) => (
                            <div key={i} className="session-poll-form-option">
                              <input
                                type="datetime-local"
                                className="profile-input"
                                value={opt}
                                onChange={(e) => updatePollOption(i, e.target.value)}
                              />
                              <button
                                type="button"
                                className="btn btn-secondary btn--mini"
                                onClick={() => removePollOption(i)}
                                title={t("friendsPage.removeOption")}
                              >
                                <XIcon />
                              </button>
                            </div>
                          ))}
                          {pollOptions.length < 4 && (
                            <button
                              type="button"
                              className="btn btn-secondary btn--mini"
                              onClick={addPollOption}
                            >
                              <PlusIcon /> {t("friendsPage.addOption")}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t("friendsPage.durationMin")}</label>
                    <input
                      type="number"
                      className="profile-input"
                      min={15}
                      max={720}
                      step={15}
                      value={durationMin}
                      onChange={(e) => setDurationMin(Number(e.target.value))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t("friends.maxPlayers")}</label>
                    <input
                      type="number"
                      className="profile-input"
                      min={2}
                      max={32}
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(Number(e.target.value))}
                    />
                  </div>
                </div>

                {potentialConflict && (
                  <div className="session-conflict-banner">
                    {t("friendsPage.overlapsWarning", {
                      game: potentialConflict.gameName,
                      time: formatDateTime(potentialConflict.scheduledAt, potentialConflict.creatorTimezone),
                    })}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">{t("friendsPage.repeatLabel")}</label>
                  <div className="session-recurrence-row">
                    <select
                      className="profile-input"
                      value={recurrenceFreq}
                      onChange={(e) => setRecurrenceFreq(e.target.value as any)}
                    >
                      <option value="none">{t("friendsPage.repeatNone")}</option>
                      <option value="daily">{t("friendsPage.recurrence.daily")}</option>
                      <option value="weekly">{t("friendsPage.recurrence.weekly")}</option>
                      <option value="monthly">{t("friendsPage.recurrence.monthly")}</option>
                    </select>
                    {recurrenceFreq !== "none" && (
                      <input
                        type="date"
                        className="profile-input"
                        value={recurrenceUntil}
                        onChange={(e) => setRecurrenceUntil(e.target.value)}
                        title={t("friendsPage.repeatUntilTitle")}
                      />
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">{t("friends.description")}</label>
                  <textarea
                    className="profile-input"
                    rows={2}
                    placeholder={t("friendsPage.sessionNotesPlaceholder")}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">{t("friendsPage.inviteSpecificFriends")}</label>
                  <div className="session-invitees-selector">
                    {friends.map((f) => (
                      <label key={f.id} className="invitee-check-pill">
                        <input
                          type="checkbox"
                          checked={invitedFriends.includes(f.name)}
                          onChange={() => toggleInviteFriend(f.name)}
                        />
                        <span>{f.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="friends-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    !gameName.trim() ||
                    (!pollMode && !dateTime) ||
                    (pollMode && pollOptions.filter(Boolean).length === 0)
                  }
                >
                  <PlusIcon /> {editingSession ? t("common.save") : t("friends.createSession")}
                </button>
              </div>
            </form>
          </div>
          </div>,
          document.body
        )}
    </div>
  );
}
