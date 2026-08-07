// SessionsTab — the Game Lobbies surface of the Big Screen hub.
//
// Console translation of the desktop Sessions planner: upcoming / past /
// agenda views with filters + search, a create-session modal (game
// picker, time, players, duration, invitees, notes), RSVP strips, and a
// consolidated lobby-detail modal (participants + roles + guests + RSVP
// notes + pinned chat). Every interactive element is a dedicated
// component so useFocusable counts stay stable.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import { useGames } from "../../../context/GameContext";
import { type GameSession, type SessionParticipant, displayName } from "../../../pages/friendsStorage";
import type { UseFriendsSocialResult } from "../../../hooks/useFriendsSocial";
import { FilterChip, Icons, countdownLabel, formatDateTime, useFocusableInput, useOverlayEscape } from "./friendsUtils";

export type SessionView = "upcoming" | "past" | "agenda";
export type SessionFilter = "all" | "mine" | "invited";

export interface SessionsTabProps {
  social: UseFriendsSocialResult;
  profileName: string;
  /** Friends pre-selected by the friend-card "Invite to Lobby" action. */
  initialInvites: string[];
  onConsumeInitialInvites: () => void;
}

export default function SessionsTab({ social, profileName, initialInvites, onConsumeInitialInvites }: SessionsTabProps) {
  const { t } = useLanguage();
  const [view, setView] = useState<SessionView>("upcoming");
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { sessions } = social;
  const detailSession = sessions.find((s) => s.id === detailId) || null;

  const activeSessions = useMemo(() => sessions.filter((s) => !s.deleted), [sessions]);

  const visible = useMemo(() => {
    const now = Date.now();
    const bufferMs = 6 * 60 * 60 * 1000;
    const q = search.trim().toLowerCase();
    let pool = activeSessions;
    if (filter === "mine") pool = pool.filter((s) => s.creatorName === profileName);
    else if (filter === "invited") pool = pool.filter((s) => s.creatorName !== profileName && (s.invited || []).includes(profileName));
    if (q) {
      pool = pool.filter(
        (s) =>
          s.gameName.toLowerCase().includes(q) ||
          (s.description || "").toLowerCase().includes(q) ||
          (s.participants || []).some((p) => p.name.toLowerCase().includes(q)),
      );
    }
    if (view === "past") {
      return pool
        .filter((s) => new Date(s.scheduledAt).getTime() + bufferMs < now)
        .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    }
    return pool
      .filter((s) => new Date(s.scheduledAt).getTime() + bufferMs >= now)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [activeSessions, filter, search, view, profileName]);

  // Agenda view: group upcoming by month.
  const agendaGroups = useMemo(() => {
    const groups = new Map<string, GameSession[]>();
    visible.forEach((s) => {
      const d = new Date(s.scheduledAt);
      const key = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    });
    return Array.from(groups.entries());
  }, [visible]);

  return (
    <div className="bigscreen-friends-sessions">
      {/* Toolbar: view chips + filter + search + create */}
      <div className="bigscreen-friends-controls">
        <div className="bigscreen-filter-chips" role="group" aria-label={t("bigscreen.friends.sessionsFilters")}>
          <FilterChip label={t("friendsPage.upcoming")} active={view === "upcoming"} onActivate={() => setView("upcoming")} />
          <FilterChip label={t("friendsPage.agenda")} active={view === "agenda"} onActivate={() => setView("agenda")} />
          <FilterChip label={t("friendsPage.past")} active={view === "past"} onActivate={() => setView("past")} />
          <span className="bigscreen-friends-controls-divider" aria-hidden />
          <FilterChip label={t("common.all")} active={filter === "all"} onActivate={() => setFilter("all")} />
          <FilterChip label={t("friendsPage.sessionFilterMine")} active={filter === "mine"} onActivate={() => setFilter("mine")} />
          <FilterChip label={t("friendsPage.sessionFilterInvited")} active={filter === "invited"} onActivate={() => setFilter("invited")} />
        </div>
        <div className="bigscreen-friends-controls-tools">
          <SessionSearch value={search} onChange={setSearch} />
          <CreateSessionButton
            onActivate={() => {
              setShowCreate(true);
            }}
          />
        </div>
      </div>

      {activeSessions.length === 0 ? (
        <div className="system-view-empty">
          <p>{t("friendsPage.noEventsScheduled")}</p>
          <p>{t("friendsPage.emptySessionsHint")}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="system-view-empty">
          <p>{view === "past" ? t("friendsPage.noPastSessions") : t("friendsPage.noEventsScheduled")}</p>
          <p>{view === "past" ? t("friendsPage.completedSessionsHint") : t("friendsPage.emptySessionsHint")}</p>
        </div>
      ) : view === "agenda" ? (
        <div className="bigscreen-sessions-agenda">
          {agendaGroups.map(([month, group]) => (
            <div key={month} className="bigscreen-sessions-agenda-month">
              <div className="bigscreen-sessions-agenda-label">{month}</div>
              <div className="bigscreen-sessions-list">
                {group.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    profileName={profileName}
                    onOpenDetail={() => setDetailId(session.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bigscreen-sessions-list">
          {visible.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              profileName={profileName}
              onOpenDetail={() => setDetailId(session.id)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateSessionModal
          social={social}
          initialInvites={initialInvites}
          onClose={() => {
            setShowCreate(false);
            onConsumeInitialInvites();
          }}
        />
      )}

      {detailSession && (
        <LobbyDetailModal
          session={detailSession}
          social={social}
          profileName={profileName}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// ─── Session search ───────────────────────────────────────────────

function SessionSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage();
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  return (
    <div className="bigscreen-friends-search">
      <span className="bigscreen-friends-search-icon">{Icons.search()}</span>
      <input
        ref={setInputRef}
        type="text"
        className="bigscreen-input"
        placeholder={t("friendsPage.searchSessionsPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={inputProps.tabIndex}
        role={inputProps.role}
        onClick={inputProps.onClick}
      />
    </div>
  );
}

// ─── Create button ────────────────────────────────────────────────

function CreateSessionButton({ onActivate }: { onActivate: () => void }) {
  const { t } = useLanguage();
  const btnProps = useFocusable(onActivate);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
      {...btnProps}
    >
      {Icons.plus()}
      {t("friendsPage.planEvent")}
    </button>
  );
}

// ─── Session row ──────────────────────────────────────────────────

function SessionRow({
  session,
  profileName,
  onOpenDetail,
}: {
  session: GameSession;
  profileName: string;
  onOpenDetail: () => void;
}) {
  const { t } = useLanguage();
  const openProps = useFocusable(onOpenDetail);
  const attendees = Object.entries(session.rsvps || {}).filter(([, status]) => status === "going");
  const countdown =
    new Date(session.scheduledAt).getTime() > Date.now() ? countdownLabel(session.scheduledAt, t) : "";

  return (
    <div className="bigscreen-widget-card bigscreen-session-row">
      <div className="bigscreen-session-main">
        <div className="bigscreen-session-title-row">
          <h4 className="bigscreen-session-title">{session.gameName}</h4>
          {session.creatorName === profileName && (
            <span className="bigscreen-session-mine-pill">{t("friendsPage.sessionFilterMine")}</span>
          )}
          {countdown && <span className="bigscreen-session-countdown">{countdown}</span>}
        </div>
        <div className="bigscreen-session-meta">
          {t("bigscreen.friends.sessionMeta", { date: formatDateTime(session.scheduledAt, session.creatorTimezone), going: attendees.length, max: session.maxPlayers })}
          <span className="bigscreen-session-meta-dot" aria-hidden />
          {t("friendsPage.activitySession", { who: session.creatorName === profileName ? t("friendsPage.me") : session.creatorName, game: session.gameName })}
        </div>
        {session.description && <div className="bigscreen-session-desc">"{session.description}"</div>}
        <div className="bigscreen-session-attendees">
          {attendees.slice(0, 8).map(([name]) => (
            <span key={name} className="bigscreen-session-attendee">
              {name === profileName ? t("friendsPage.me") : name}
            </span>
          ))}
          {attendees.length > 8 && (
            <span className="bigscreen-session-attendee-more">+{attendees.length - 8}</span>
          )}
        </div>
      </div>

      <div className="bigscreen-session-actions">
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
          {...openProps}
        >
          {Icons.chat()}
          {t("bigscreen.friends.lobbyDetails")}
        </button>
      </div>
    </div>
  );
}

// ─── Create session modal ─────────────────────────────────────────

function CreateSessionModal({
  social,
  initialInvites,
  onClose,
}: {
  social: UseFriendsSocialResult;
  initialInvites: string[];
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { games } = useGames();
  const [gameId, setGameId] = useState("");
  const [gameName, setGameName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [duration, setDuration] = useState(120);
  const [description, setDescription] = useState("");
  const [invited, setInvited] = useState<string[]>(initialInvites);

  const closeProps = useFocusable(onClose);
  useOverlayEscape(onClose);
  const createProps = useFocusable(() => {
    void (async () => {
      const ok = await social.handleCreateSession({
        gameId,
        gameName,
        scheduledAt,
        maxPlayers,
        durationMin: duration,
        description,
        invited,
      });
      if (ok) onClose();
    })();
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
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-sessioncreate-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bigscreen-overlay-drawer-header">
          <h3>{t("friendsPage.scheduleGameSession")}</h3>
          <button type="button" className="bigscreen-overlay-drawer-close" aria-label={t("common.close")} {...closeProps}>
            {Icons.x()}
          </button>
        </div>

        <div className="bigscreen-overlay-drawer-content bigscreen-sessioncreate-content">
          <GameSearchPicker
            games={games}
            selectedGameId={gameId}
            onSelect={(id, name) => {
              setGameId(id);
              setGameName(name);
            }}
          />

          <DateTimeField value={scheduledAt} onChange={setScheduledAt} />

          <div className="bigscreen-sessioncreate-row">
            <NumberField
              label={t("friendsPage.maxPlayers")}
              value={maxPlayers}
              min={2}
              max={16}
              onChange={setMaxPlayers}
            />
            <NumberField
              label={t("friendsPage.durationMin")}
              value={duration}
              min={15}
              max={480}
              step={15}
              onChange={setDuration}
            />
          </div>

          <div className="bigscreen-input-group">
            <label>{t("friendsPage.eventNotes")}</label>
            <NoteField value={description} onChange={setDescription} />
          </div>

          <div className="bigscreen-input-group">
            <label>{t("friendsPage.inviteOptional")}</label>
            <div className="bigscreen-sessioncreate-invites">
              {social.friends.map((f) => (
                <InviteChip
                  key={f.id}
                  label={displayName(f)}
                  active={invited.includes(f.name)}
                  onToggle={() =>
                    setInvited((prev) =>
                      prev.includes(f.name) ? prev.filter((n) => n !== f.name) : [...prev, f.name],
                    )
                  }
                />
              ))}
              {social.friends.length === 0 && (
                <span className="bigscreen-sessioncreate-invites-empty">{t("friendsPage.addFriendOptional")}</span>
              )}
            </div>
            {social.circles.length > 0 && (
              <div className="bigscreen-sessioncreate-invites">
                {social.circles.map((c) => (
                  <InviteChip
                    key={c.id}
                    label={c.name}
                    active={false}
                    onToggle={() => {
                      const members = social.friends
                        .filter((f) => (f.groups || []).includes(c.id))
                        .map((f) => f.name);
                      setInvited((prev) => Array.from(new Set([...prev, ...members])));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
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
            disabled={!gameId || !scheduledAt}
            {...createProps}
          >
            {Icons.calendar()}
            {t("friendsPage.planEvent")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Game search picker ───────────────────────────────────────────

function GameSearchPicker({
  games,
  selectedGameId,
  onSelect,
}: {
  games: { id: string; name: string }[];
  selectedGameId: string;
  onSelect: (id: string, name: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games.slice(0, 8);
    return games.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 8);
  }, [games, query]);

  const selected = games.find((g) => g.id === selectedGameId);

  return (
    <div className="bigscreen-input-group">
      <label>{t("friendsPage.selectGame")}</label>
      {selected ? (
        <div className="bigscreen-gamepick-selected">
          <span className="bigscreen-gamepick-selected-name">{selected.name}</span>
          <ChangeGameButton
            onActivate={() => {
              onSelect("", "");
              setQuery("");
            }}
          />
        </div>
      ) : (
        <div className="bigscreen-gamepick">
          <input
            ref={setInputRef}
            type="text"
            className="bigscreen-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("friends.typeGameName")}
            tabIndex={inputProps.tabIndex}
            role={inputProps.role}
            onClick={inputProps.onClick}
          />
          <div className="bigscreen-gamepick-results">
            {results.map((g) => (
              <GamePickRow key={g.id} name={g.name} onPick={() => onSelect(g.id, g.name)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChangeGameButton({ onActivate }: { onActivate: () => void }) {
  const { t } = useLanguage();
  const btnProps = useFocusable(onActivate);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
      {...btnProps}
    >
      {t("common.change")}
    </button>
  );
}

function GamePickRow({ name, onPick }: { name: string; onPick: () => void }) {
  const rowProps = useFocusable(onPick);
  return (
    <button type="button" className="bigscreen-gamepick-row" {...rowProps}>
      {name}
    </button>
  );
}

// ─── Date/time field ──────────────────────────────────────────────

function DateTimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage();
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  return (
    <div className="bigscreen-input-group">
      <label>{t("friendsPage.scheduledTime", { tz: detectTzLabel() })}</label>
      <input
        ref={setInputRef}
        type="datetime-local"
        className="bigscreen-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={inputProps.tabIndex}
        role={inputProps.role}
        onClick={inputProps.onClick}
      />
    </div>
  );
}

function detectTzLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** Compact "2h" / "45m" duration from minutes. */
function formatDuration(minutes: number, t: (key: string, vars?: Record<string, unknown>) => string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t("bigscreen.friends.playtimeMin", { m });
  if (m === 0) return t("friendsPage.hoursH", { h });
  return t("bigscreen.friends.playtimeDetailed", { h, m });
}

// ─── Number field ─────────────────────────────────────────────────

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  return (
    <div className="bigscreen-input-group">
      <label>{label}</label>
      <input
        ref={setInputRef}
        type="number"
        className="bigscreen-input"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        tabIndex={inputProps.tabIndex}
        role={inputProps.role}
        onClick={inputProps.onClick}
      />
    </div>
  );
}

// ─── Note field ───────────────────────────────────────────────────

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage();
  const { setInputRef, inputProps } = useFocusableInput<HTMLTextAreaElement>();
  return (
    <textarea
      ref={setInputRef}
      className="bigscreen-input bigscreen-input--textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("friendsPage.eventNotesPlaceholder")}
      tabIndex={inputProps.tabIndex}
      role={inputProps.role}
      onClick={inputProps.onClick}
    />
  );
}

// ─── Invite chip ──────────────────────────────────────────────────

function InviteChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  const chipProps = useFocusable(onToggle);
  return (
    <button
      type="button"
      className={`bigscreen-invite-chip${active ? " active" : ""}`}
      {...chipProps}
    >
      {label}
      {active && <span className="bigscreen-invite-chip-check">{Icons.check()}</span>}
    </button>
  );
}

// ─── Lobby detail modal ───────────────────────────────────────────

function LobbyDetailModal({
  session,
  social,
  profileName,
  onClose,
}: {
  session: GameSession;
  social: UseFriendsSocialResult;
  profileName: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const closeProps = useFocusable(onClose);
  useOverlayEscape(onClose);
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [guestDraft, setGuestDraft] = useState("");
  const noteInput = useFocusableInput<HTMLInputElement>();
  const guestInput = useFocusableInput<HTMLInputElement>();
  const messageInput = useFocusableInput<HTMLInputElement>();
  const sendProps = useFocusable(() => {
    const text = draft.trim();
    if (!text) return;
    void social.handleSendSessionMessage(session.id, text);
    setDraft("");
  });

  const myRsvp = session.rsvps?.[profileName] || "none";
  const isCreator = session.creatorName === profileName;
  const pinned = (session.messages || []).filter((m) => m.pinned);
  const regular = (session.messages || []).filter((m) => !m.pinned);
  const myParticipant = (session.participants || []).find((p) => p.name === profileName);
  const attendeesCount = Object.values(session.rsvps || {}).filter((v) => v === "going").length;
  const countdown =
    new Date(session.scheduledAt).getTime() > Date.now() ? countdownLabel(session.scheduledAt, t) : "";
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.messages?.length]);

  return (
    <div
      data-bigscreen-overlay="true"
      role="dialog"
      aria-modal="true"
      className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
      onMouseDown={onClose}
    >
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-lobby-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bigscreen-lobby-head">
          <div className="bigscreen-lobby-title-group">
            <h3>{session.gameName}</h3>
            {countdown && <span className="bigscreen-session-countdown">{countdown}</span>}
          </div>
          <button type="button" className="bigscreen-overlay-drawer-close" aria-label={t("common.close")} {...closeProps}>
            {Icons.x()}
          </button>
        </div>

        <div className="bigscreen-overlay-drawer-content bigscreen-lobby-content" ref={bodyRef}>
          <div className="bigscreen-lobby-meta-grid">
            <div className="bigscreen-modal-stat">
              <span className="bigscreen-modal-stat-label">{t("friendsPage.upcoming")}</span>
              <span className="bigscreen-modal-stat-value">{formatDateTime(session.scheduledAt, session.creatorTimezone)}</span>
            </div>
            <div className="bigscreen-modal-stat">
              <span className="bigscreen-modal-stat-label">{t("friendsPage.maxPlayers")}</span>
              <span className="bigscreen-modal-stat-value">{attendeesCount} / {session.maxPlayers}</span>
            </div>
            <div className="bigscreen-modal-stat">
              <span className="bigscreen-modal-stat-label">{t("friendsPage.durationMin")}</span>
              <span className="bigscreen-modal-stat-value">{formatDuration(session.durationMin || 120, t)}</span>
            </div>
            <div className="bigscreen-modal-stat">
              <span className="bigscreen-modal-stat-label">{t("friends.host")}</span>
              <span className="bigscreen-modal-stat-value">{session.creatorName === profileName ? t("friendsPage.me") : session.creatorName}</span>
            </div>
          </div>

          {session.description && (
            <div className="bigscreen-lobby-desc">"{session.description}"</div>
          )}

          <RsvpStrip
            myRsvp={myRsvp}
            onSet={(status) => void social.handleSetRsvp(session.id, status)}
          />

          {/* My "what I'm bringing" note */}
          <div className="bigscreen-lobby-note-row">
            <input
              ref={noteInput.setInputRef}
              type="text"
              className="bigscreen-input"
              value={noteDraft || myParticipant?.note || ""}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={t("friends.whatBringing")}
              tabIndex={noteInput.inputProps.tabIndex}
              role={noteInput.inputProps.role}
              onClick={noteInput.inputProps.onClick}
            />
            <SaveNoteButton
              onSave={() => {
                void social.handleSetRsvpNote(session.id, noteDraft);
                setNoteDraft("");
              }}
            />
          </div>

          {/* Participants */}
          <div className="bigscreen-lobby-section-title">{t("bigscreen.friends.participants")}</div>
          <div className="bigscreen-lobby-participants">
            {(session.participants || []).map((p) => (
              <ParticipantRow
                key={p.name}
                participant={p}
                profileName={profileName}
                isCreator={isCreator}
                onChangeRole={(role) => void social.handleSetRole(session.id, p.name, role)}
                onRemoveGuest={() => void social.handleRemoveGuest(session.id, p.name)}
              />
            ))}
          </div>

          {/* Add guest */}
          <div className="bigscreen-lobby-note-row">
            <input
              ref={guestInput.setInputRef}
              type="text"
              className="bigscreen-input"
              value={guestDraft}
              onChange={(e) => setGuestDraft(e.target.value)}
              placeholder={t("friends.bringGuest")}
              tabIndex={guestInput.inputProps.tabIndex}
              role={guestInput.inputProps.role}
              onClick={guestInput.inputProps.onClick}
            />
            <AddGuestButton
              onAdd={() => {
                void social.handleAddGuest(session.id, guestDraft);
                setGuestDraft("");
              }}
            />
          </div>

          {/* Chat */}
          <div className="bigscreen-lobby-section-title">{t("friends.sessionChat")}</div>
          {pinned.length > 0 && (
            <div className="bigscreen-lobby-pinned">
              {pinned.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  profileName={profileName}
                  canPin={isCreator}
                  onTogglePin={() => void social.handleTogglePinMessage(session.id, m.id)}
                />
              ))}
            </div>
          )}
          <div className="bigscreen-lobby-messages">
            {regular.length === 0 && pinned.length === 0 ? (
              <div className="bigscreen-chat-empty">{t("bigscreen.friends.noMessages")}</div>
            ) : (
              regular.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  profileName={profileName}
                  canPin={isCreator}
                  onTogglePin={() => void social.handleTogglePinMessage(session.id, m.id)}
                />
              ))
            )}
          </div>

          <div className="bigscreen-chat-input-row">
            <input
              ref={messageInput.setInputRef}
              type="text"
              className="bigscreen-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("bigscreen.friends.typeMessage")}
              tabIndex={messageInput.inputProps.tabIndex}
              role={messageInput.inputProps.role}
              onClick={messageInput.inputProps.onClick}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendProps.onClick();
              }}
            />
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
              {...sendProps}
            >
              {t("bigscreen.friends.send")}
            </button>
          </div>
        </div>

        {isCreator && (
          <div className="bigscreen-modal-footer">
            <CancelSessionButton
              onCancel={() => {
                void social.handleDeleteSession(session.id);
                onClose();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RSVP strip ───────────────────────────────────────────────────

function RsvpStrip({
  myRsvp,
  onSet,
}: {
  myRsvp: string;
  onSet: (status: "going" | "maybe" | "declined") => void;
}) {
  const { t } = useLanguage();
  const goingProps = useFocusable(() => onSet("going"));
  const maybeProps = useFocusable(() => onSet("maybe"));
  const declinedProps = useFocusable(() => onSet("declined"));
  return (
    <div className="bigscreen-rsvp-group">
      <button type="button" className={`bigscreen-rsvp-btn ${myRsvp === "going" ? "is-selected-going" : ""}`} {...goingProps}>
        {t("bigscreen.friends.going")}
      </button>
      <button type="button" className={`bigscreen-rsvp-btn ${myRsvp === "maybe" ? "is-selected-maybe" : ""}`} {...maybeProps}>
        {t("bigscreen.friends.maybe")}
      </button>
      <button type="button" className={`bigscreen-rsvp-btn ${myRsvp === "declined" ? "is-selected-declined" : ""}`} {...declinedProps}>
        {t("bigscreen.friends.decline")}
      </button>
    </div>
  );
}

// ─── Save-note / add-guest / cancel buttons ───────────────────────

function SaveNoteButton({ onSave }: { onSave: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onSave);
  return (
    <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact" {...props}>
      {Icons.check()}
      {t("bigscreen.friends.saveNote")}
    </button>
  );
}

function AddGuestButton({ onAdd }: { onAdd: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onAdd);
  return (
    <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact" {...props}>
      {Icons.plus()}
      {t("friends.bringGuest")}
    </button>
  );
}

function CancelSessionButton({ onCancel }: { onCancel: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onCancel);
  return (
    <button type="button" className="bigscreen-details-btn bigscreen-details-btn--danger bigscreen-details-btn--compact" {...props}>
      {t("bigscreen.friends.cancel")}
    </button>
  );
}

// ─── Participant row ──────────────────────────────────────────────

function ParticipantRow({
  participant,
  profileName,
  isCreator,
  onChangeRole,
  onRemoveGuest,
}: {
  participant: SessionParticipant;
  profileName: string;
  isCreator: boolean;
  onChangeRole: (role: "host" | "cohost" | "player") => void;
  onRemoveGuest: () => void;
}) {
  const { t } = useLanguage();
  const isMe = participant.name === profileName;
  const roleLabel =
    participant.role === "host"
      ? t("friends.host")
      : participant.role === "cohost"
        ? t("friends.cohost")
        : t("friends.player");

  return (
    <div className={`bigscreen-lobby-participant${participant.guest ? " is-guest" : ""}`}>
      <span className={`bigscreen-lobby-participant-role role-${participant.role}`}>{roleLabel}</span>
      <span className="bigscreen-lobby-participant-name">
        {isMe ? t("friendsPage.me") : participant.name}
        {participant.guest && <span className="bigscreen-lobby-guest-pill">{t("bigscreen.friends.guest")}</span>}
      </span>
      {participant.note && <span className="bigscreen-lobby-participant-note">"{participant.note}"</span>}
      {isCreator && !isMe && !participant.guest && (
        <RoleCycleButton
          label={roleLabel}
          onCycle={() => {
            const next: "host" | "cohost" | "player" =
              participant.role === "host" ? "cohost" : participant.role === "cohost" ? "player" : "host";
            onChangeRole(next);
          }}
        />
      )}
      {isCreator && participant.guest && (
        <RemoveGuestButton onRemove={onRemoveGuest} />
      )}
    </div>
  );
}

function RoleCycleButton({ label, onCycle }: { label: string; onCycle: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onCycle);
  return (
    <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact" {...props} title={t("friends.changeRole")}>
      {Icons.edit()}
      {label}
    </button>
  );
}

function RemoveGuestButton({ onRemove }: { onRemove: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onRemove);
  return (
    <button type="button" className="bigscreen-details-btn bigscreen-details-btn--danger bigscreen-details-btn--compact" {...props}>
      {Icons.x()}
      {t("friends.removeGuest")}
    </button>
  );
}

// ─── Chat message row ─────────────────────────────────────────────

function MessageRow({
  message,
  profileName,
  canPin,
  onTogglePin,
}: {
  message: { id: string; author: string; text: string; timestamp: number; pinned?: boolean };
  profileName: string;
  canPin: boolean;
  onTogglePin: () => void;
}) {
  const { t } = useLanguage();
  const mine = message.author === profileName;
  const pinProps = useFocusable(onTogglePin);
  return (
    <div className={`bigscreen-chat-bubble ${mine ? "bigscreen-chat-bubble--me" : "bigscreen-chat-bubble--them"}${message.pinned ? " is-pinned" : ""}`}>
      <div className="bigscreen-chat-bubble-head">
        <div className={`bigscreen-chat-bubble-author${mine ? " bigscreen-chat-bubble-author--right" : ""}`}>
          {message.pinned && <span className="bigscreen-chat-pin-flag">{Icons.pin(true)}</span>}
          {mine ? t("friendsPage.me") : message.author}
        </div>
        {canPin && (
          <button
            type="button"
            className="bigscreen-chat-pin-btn"
            aria-label={message.pinned ? t("bigscreen.friends.unpinMessage") : t("bigscreen.friends.pinMessage")}
            {...pinProps}
          >
            {Icons.pin(!!message.pinned)}
          </button>
        )}
      </div>
      <div className="bigscreen-chat-bubble-text">{message.text}</div>
    </div>
  );
}
