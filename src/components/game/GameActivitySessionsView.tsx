import { useState, useMemo } from "react";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import type { TempUnit } from "../../context/SettingsContext";
import { GameSessionDetail } from "./GameSessionDetail";
import { SessionInspectorModal } from "../activity/SessionInspectorModal";
import { EmptyState } from "../activity/EmptyState";
import { useFocusProps, useFocusableNative } from "../activity/focusable";
import * as Icons from "../activity/Icons";

export interface GameActivitySessionsViewProps {
  game: Game;
  sessions: GameSession[];
  sessionsWithHw: GameSession[];
  hasTemps: boolean;
  tempUnit: TempUnit;
  onRequestDelete: (sessionId: string) => void;
}

type SortField = "date" | "duration" | "fps" | "gpuTemp";
type SortOrder = "asc" | "desc";

export function GameActivitySessionsView({
  game,
  sessions,
  sessionsWithHw,
  hasTemps,
  tempUnit,
  onRequestDelete,
}: GameActivitySessionsViewProps) {
  const { t } = useLanguage();
  const { getNote, setNote, setTags } = useSessionNotes();

  const [searchQuery, setSearchQuery] = useState("");
  const [telemetryFilter, setTelemetryFilter] = useState<"all" | "telemetry" | "notes">("all");
  const [durationFilter, setDurationFilter] = useState<"all" | "quick" | "medium" | "long">("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [inspectingSession, setInspectingSession] = useState<GameSession | null>(null);

  // Inline Note Editor State
  const [editingSessionNoteId, setEditingSessionNoteId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tagsList, setTagsList] = useState<string[]>([]);

  const clearSearchFocus = useFocusProps(() => setSearchQuery(""));
  const telemetrySelectFocus = useFocusableNative<HTMLSelectElement>();
  const durationSelectFocus = useFocusableNative<HTMLSelectElement>();
  const sortSelectFocus = useFocusableNative<HTMLSelectElement>();
  const sortDirFocus = useFocusProps(() =>
    setSortOrder((o) => (o === "asc" ? "desc" : "asc")),
  );

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = sessions.filter((s) => {
      const noteData = getNote(s.id);
      if (q) {
        const matchesDate = s.date.toLowerCase().includes(q);
        const matchesNote = noteData.note.toLowerCase().includes(q);
        const matchesTags = noteData.tags.some((tag) => tag.toLowerCase().includes(q));
        if (!matchesDate && !matchesNote && !matchesTags) return false;
      }

      if (telemetryFilter === "telemetry" && (!s.metrics || s.metrics.avgCpuUsage === 0)) {
        return false;
      }
      if (telemetryFilter === "notes") {
        if (!noteData.note && noteData.tags.length === 0) return false;
      }

      if (durationFilter === "quick" && s.durationMin >= 30) return false;
      if (durationFilter === "medium" && (s.durationMin < 30 || s.durationMin > 120)) return false;
      if (durationFilter === "long" && s.durationMin <= 120) return false;

      return true;
    });

    return list.sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      if (sortField === "duration") {
        return (a.durationMin - b.durationMin) * dir;
      }
      if (sortField === "fps") {
        const fpsA = a.metrics?.avgFps || 0;
        const fpsB = b.metrics?.avgFps || 0;
        return (fpsA - fpsB) * dir;
      }
      if (sortField === "gpuTemp") {
        const tempA = a.metrics?.avgGpuTemp || 0;
        const tempB = b.metrics?.avgGpuTemp || 0;
        return (tempA - tempB) * dir;
      }
      return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir;
    });
  }, [sessions, searchQuery, telemetryFilter, durationFilter, sortField, sortOrder, getNote]);

  const openNoteEditor = (session: GameSession) => {
    const current = getNote(session.id);
    setNoteInput(current.note);
    setTagsList(current.tags);
    setEditingSessionNoteId(session.id);
  };

  const handleSaveNote = (sessionId: string) => {
    setNote(sessionId, noteInput);
    setTags(sessionId, tagsList);
    setEditingSessionNoteId(null);
  };

  const handleAddTag = (e?: React.KeyboardEvent | React.MouseEvent) => {
    if (e && "key" in e && e.key !== "Enter") return;
    const clean = tagInput.trim();
    if (clean && !tagsList.includes(clean) && editingSessionNoteId) {
      const next = [...tagsList, clean];
      setTagsList(next);
      setTags(editingSessionNoteId, next);
      setTagInput("");
    }
  };

  return (
    <div id="game-activity-panel-sessions" role="tabpanel" className="act-stack">
      {/* Search & Filter Toolbar */}
      <div className="activity-sessions-toolbar">
        <div className="activity-sessions-toolbar__search">
          <Icons.Search size={13} className="activity-sessions-toolbar__search-icon" />
          <input
            type="text"
            className="activity-sessions-toolbar__search-input"
            placeholder={t("activitySessions.searchNotesOrDate")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              ref={clearSearchFocus.ref}
              tabIndex={clearSearchFocus.tabIndex}
              type="button"
              className="activity-sessions-toolbar__clear-btn"
              onClick={clearSearchFocus.onClick}
            >
              <Icons.X size={12} />
            </button>
          )}
        </div>

        <div className="activity-sessions-toolbar__filters">
          <select
            ref={telemetrySelectFocus.setRef}
            tabIndex={telemetrySelectFocus.tabIndex}
            className="act-toolbar__select"
            value={telemetryFilter}
            onChange={(e) => setTelemetryFilter(e.target.value as "all" | "telemetry" | "notes")}
            aria-label={t("activitySessions.filterType")}
          >
            <option value="all">{t("activitySessions.filterAll")}</option>
            <option value="telemetry">{t("activitySessions.filterWithTelemetry")}</option>
            <option value="notes">{t("activitySessions.filterWithNotes")}</option>
          </select>

          <select
            ref={durationSelectFocus.setRef}
            tabIndex={durationSelectFocus.tabIndex}
            className="act-toolbar__select"
            value={durationFilter}
            onChange={(e) => setDurationFilter(e.target.value as "all" | "quick" | "medium" | "long")}
            aria-label={t("activitySessions.durationFilter")}
          >
            <option value="all">{t("activitySessions.allDurations")}</option>
            <option value="quick">&lt; 30m ({t("activityInsights.sessionBucket.quick")})</option>
            <option value="medium">30m – 2h ({t("activityInsights.sessionBucket.short")})</option>
            <option value="long">&gt; 2h ({t("activityInsights.sessionBucket.long")})</option>
          </select>

          <div className="activity-sessions-toolbar__sort">
            <select
              ref={sortSelectFocus.setRef}
              tabIndex={sortSelectFocus.tabIndex}
              className="act-toolbar__select"
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              aria-label={t("activitySessions.sortBy")}
            >
              <option value="date">{t("activitySessions.sortDate")}</option>
              <option value="duration">{t("activitySessions.sortDuration")}</option>
              <option value="fps">{t("activitySessions.sortFps")}</option>
              <option value="gpuTemp">{t("activitySessions.sortGpuTemp")}</option>
            </select>
            <button
              ref={sortDirFocus.ref}
              tabIndex={sortDirFocus.tabIndex}
              type="button"
              className="activity-sessions-toolbar__sort-dir-btn"
              onClick={sortDirFocus.onClick}
              title={sortOrder === "asc" ? t("activitySessions.ascending") : t("activitySessions.descending")}
            >
              {sortOrder === "asc" ? <Icons.ChevronUp size={13} /> : <Icons.ChevronDown size={13} />}
            </button>
          </div>
        </div>
      </div>

      {/* Session list items */}
      {filteredSessions.length === 0 ? (
        <EmptyState
          icon={<Icons.History size={24} />}
          title={t("activitySessions.noMatchingSessions")}
          hint={t("activitySessions.noMatchingHint")}
        />
      ) : (
        <div className="act-session-list">
          {filteredSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              gameName={game.name}
              hasHw={sessionsWithHw.some((s) => s.id === session.id)}
              isExpanded={expandedSessionId === session.id}
              editingNote={editingSessionNoteId === session.id}
              noteInput={noteInput}
              tagInput={tagInput}
              tempUnit={tempUnit}
              hasTemps={hasTemps}
              onToggleExpand={() =>
                setExpandedSessionId(expandedSessionId === session.id ? null : session.id)
              }
              onInspect={() => setInspectingSession(session)}
              onDelete={() => onRequestDelete(session.id)}
              onOpenNoteEditor={() => openNoteEditor(session)}
              onChangeNoteInput={setNoteInput}
              onChangeTagInput={setTagInput}
              onAddTag={handleAddTag}
              onSaveNote={() => handleSaveNote(session.id)}
              onCancelNote={() => setEditingSessionNoteId(null)}
            />
          ))}
        </div>
      )}

      {/* Inspector Modal */}
      {inspectingSession && (
        <SessionInspectorModal
          session={inspectingSession}
          game={game}
          onClose={() => setInspectingSession(null)}
          onDeleteSession={(id) => {
            onRequestDelete(id);
            setInspectingSession(null);
          }}
        />
      )}
    </div>
  );
}

function SessionRow({
  session,
  gameName,
  hasHw,
  isExpanded,
  editingNote,
  noteInput,
  tagInput,
  tempUnit,
  hasTemps,
  onToggleExpand,
  onInspect,
  onDelete,
  onOpenNoteEditor,
  onChangeNoteInput,
  onChangeTagInput,
  onAddTag,
  onSaveNote,
  onCancelNote,
}: {
  session: GameSession;
  gameName: string;
  hasHw: boolean;
  isExpanded: boolean;
  editingNote: boolean;
  noteInput: string;
  tagInput: string;
  tempUnit: TempUnit;
  hasTemps: boolean;
  onToggleExpand: () => void;
  onInspect: () => void;
  onDelete: () => void;
  onOpenNoteEditor: () => void;
  onChangeNoteInput: (value: string) => void;
  onChangeTagInput: (value: string) => void;
  onAddTag: (e?: React.KeyboardEvent | React.MouseEvent) => void;
  onSaveNote: () => void;
  onCancelNote: () => void;
}) {
  const { t, language } = useLanguage();
  const { getNote } = useSessionNotes();

  const rowFocus = useFocusProps(onToggleExpand);
  const inspectFocus = useFocusProps(onInspect);
  const deleteFocus = useFocusProps(onDelete);
  const editNoteFocus = useFocusProps(onOpenNoteEditor);
  const addTagFocus = useFocusProps(() => onAddTag());
  const saveNoteFocus = useFocusProps(onSaveNote);
  const cancelNoteFocus = useFocusProps(onCancelNote);

  const noteData = getNote(session.id);
  const hasNote = Boolean(noteData.note || noteData.tags.length > 0);

  const formattedDate = new Date(session.date).toLocaleDateString(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const startTimeStr = new Date(session.date).toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTimeStr = new Date(
    new Date(session.date).getTime() + session.durationMin * 60000,
  ).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`act-session-wrap${isExpanded ? " act-session-wrap--expanded" : ""}`}>
      <div
        ref={rowFocus.ref}
        tabIndex={rowFocus.tabIndex}
        className={`act-session${isExpanded ? " act-session--active" : ""} act-session--selectable`}
        role="button"
        onClick={rowFocus.onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
      >
        <div className="act-session__icon">
          <Icons.Clock size={14} />
        </div>
        <div className="act-session__date">
          <span className="act-session__day">{formattedDate}</span>
          <span className="act-session__range">
            {startTimeStr} – {endTimeStr}
          </span>
        </div>

        <div className="act-session__pills">
          {session.metrics?.avgFps && session.metrics.avgFps > 0 ? (
            <span className="act-session__pill act-session__pill--fps">
              {session.metrics.avgFps} FPS
            </span>
          ) : null}
          {session.metrics?.resolution ? (
            <span className="act-session__pill act-session__pill--res">
              {session.metrics.resolution}
            </span>
          ) : null}
          {hasNote && (
            <span
              className="act-session__pill act-session__pill--note"
              title={noteData.note}
            >
              <Icons.FileText size={10} />{" "}
              {noteData.tags.length > 0 ? `${noteData.tags.length} tags` : "Note"}
            </span>
          )}
        </div>

        <div className="act-session__duration">
          <span>{formatPlayTime(session.durationMin)}</span>
          <span className="act-session__chevron" aria-hidden="true">
            {isExpanded ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}
          </span>
        </div>

        <div className="act-session__actions-cluster">
          <button
            ref={inspectFocus.ref}
            tabIndex={inspectFocus.tabIndex}
            type="button"
            className="act-session__inspect-btn"
            onClick={(e) => {
              e.stopPropagation();
              onInspect();
            }}
            title={t("activitySessions.inspectSession")}
            aria-label={t("activitySessions.inspectSession")}
          >
            <Icons.Maximize2 size={13} />
          </button>
          <button
            ref={deleteFocus.ref}
            tabIndex={deleteFocus.tabIndex}
            type="button"
            className="act-session__delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title={t("activity.deleteSessionBtn")}
            aria-label={t("activity.deleteSessionAria", { name: gameName })}
          >
            <Icons.Trash2 size={13} />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="act-session-expanded-body">
          {hasHw ? (
            <GameSessionDetail
              session={session}
              tempUnit={tempUnit}
              hasTemps={hasTemps}
            />
          ) : (
            <div className="act-empty act-empty--compact">
              <div className="act-empty__title">{t("activity.noTelemetryCaptured")}</div>
            </div>
          )}

          {/* Inline Session Notes in Game Page Activity Tab */}
          <div className="act-session-item__notes-box">
            <div className="act-session-item__notes-head">
              <span className="act-session-item__notes-title">
                <Icons.FileText size={13} /> {t("sessionNotes.title")}
              </span>
              {!editingNote && (
                <button
                  ref={editNoteFocus.ref}
                  tabIndex={editNoteFocus.tabIndex}
                  type="button"
                  className="act-inspector-btn act-inspector-btn--sm"
                  onClick={editNoteFocus.onClick}
                >
                  <Icons.Edit3 size={11} />{" "}
                  {noteData.note ? t("common.edit") : t("sessionNotes.addNote")}
                </button>
              )}
            </div>

            {editingNote ? (
              <div className="act-inspector-notes__editor">
                <textarea
                  className="act-inspector-notes__textarea"
                  rows={2}
                  placeholder={t("sessionNotes.placeholder")}
                  value={noteInput}
                  onChange={(e) => onChangeNoteInput(e.target.value)}
                />
                <div className="act-inspector-notes__tags-input-row">
                  <input
                    type="text"
                    className="act-inspector-notes__tag-input"
                    placeholder={t("sessionNotes.tagPlaceholder")}
                    value={tagInput}
                    onChange={(e) => onChangeTagInput(e.target.value)}
                    onKeyDown={(e) => onAddTag(e)}
                  />
                  <button
                    ref={addTagFocus.ref}
                    tabIndex={addTagFocus.tabIndex}
                    type="button"
                    className="act-inspector-btn act-inspector-btn--sm"
                    onClick={addTagFocus.onClick}
                  >
                    <Icons.Tag size={11} /> {t("sessionNotes.addTag")}
                  </button>
                </div>
                <div className="act-inspector-notes__editor-actions">
                  <button
                    ref={saveNoteFocus.ref}
                    tabIndex={saveNoteFocus.tabIndex}
                    type="button"
                    className="act-inspector-btn act-inspector-btn--primary act-inspector-btn--sm"
                    onClick={saveNoteFocus.onClick}
                  >
                    <Icons.Check size={12} /> {t("common.save")}
                  </button>
                  <button
                    ref={cancelNoteFocus.ref}
                    tabIndex={cancelNoteFocus.tabIndex}
                    type="button"
                    className="act-inspector-btn act-inspector-btn--ghost act-inspector-btn--sm"
                    onClick={cancelNoteFocus.onClick}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="activity-session-item__notes-content">
                {noteData.note ? (
                  <p className="activity-session-item__notes-text">{noteData.note}</p>
                ) : (
                  <p className="activity-session-item__notes-empty">
                    {t("sessionNotes.noNotes")}
                  </p>
                )}
                {noteData.tags.length > 0 && (
                  <div className="act-inspector-notes__tags">
                    {noteData.tags.map((tag) => (
                      <span key={tag} className="act-inspector-tag">
                        <Icons.Tag size={10} /> {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
