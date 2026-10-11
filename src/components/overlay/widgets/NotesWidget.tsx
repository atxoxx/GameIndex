import { useEffect, useState } from "react";
import {
  StickyNote,
  Plus,
  Pin,
  Trash2,
  Eye,
  Edit3,
  FileText,
  Tag,
  Check,
} from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useOptionalGames } from "../../../context/GameContext";
import { useGameNotes, type GameNoteDraft } from "../../../hooks/useGameNotes";
import { useLanguage } from "../../../context/LanguageContext";
import { useIncrementalList } from "../useIncrementalList";
import type { GameNote } from "../../../types/gameNote";
import { Card, Button, Skeleton } from "../../ui";
import Markdown from "../../game/notes/markdown";

interface TemplateOption {
  id: string;
  name: string;
  title: string;
  content: string;
}

const TEMPLATES: TemplateOption[] = [
  {
    id: "blank",
    name: "Blank",
    title: "",
    content: "",
  },
  {
    id: "quest",
    name: "Quests",
    title: "Quest Log",
    content: "## Active Quests\n- [ ] Main Quest: \n- [ ] Side Quest: \n\n## Clues & Objectives\n- \n",
  },
  {
    id: "boss",
    name: "Boss Strategy",
    title: "Boss Strategy",
    content: "## Boss Name\n- **Location:** \n- **Weakness:** \n\n### Attack Phases\n1. Phase 1: \n2. Phase 2: \n\n### Strategy Notes\n",
  },
  {
    id: "checklist",
    name: "Checklist",
    title: "To Do List",
    content: "## Objectives\n- [ ] Collect items: \n- [ ] Upgrade gear: \n- [ ] Unlock area: \n- [ ] Defeat mini-boss: \n",
  },
  {
    id: "build",
    name: "Build & Gear",
    title: "Build Setup",
    content: "## Build: \n- **Weapon:** \n- **Armor:** \n- **Skills / Talents:** \n- **Stat Priority:** \n",
  },
  {
    id: "journal",
    name: "Journal",
    title: "Session Journal",
    content: "## Session Log\n**Date:** \n\n### Progress Today\n- \n\n### Next Objectives\n- \n",
  },
];

export default function NotesWidget() {
  const { session } = useOverlay();
  const gameCtx = useOptionalGames();
  const games = gameCtx?.games ?? [];
  const { t } = useLanguage();

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  // Sync selected game with active session when session changes
  useEffect(() => {
    if (session?.gameId) {
      setSelectedGameId(session.gameId);
    } else if (!selectedGameId && games.length > 0) {
      setSelectedGameId(games[0].id);
    }
  }, [session, games, selectedGameId]);

  const targetGameId = selectedGameId || session?.gameId || (games[0]?.id ?? "");
  const activeGame = games.find((g) => g.id === targetGameId);

  if (!targetGameId) {
    return (
      <Card variant="glass" className="overlay-widget overlay-notes-widget">
        <div className="overlay-widget__head">
          <span className="overlay-widget__icon" aria-hidden>
            <StickyNote />
          </span>
          <h3 className="overlay-widget__title">{t("overlay.widget.notes")}</h3>
        </div>
        <p className="overlay-widget__empty">{t("overlay.noSession")}</p>
      </Card>
    );
  }

  return (
    <Card variant="glass" className="overlay-widget overlay-notes-widget">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <StickyNote />
        </span>
        <h3 className="overlay-widget__title">{t("overlay.widget.notes")}</h3>

        {/* Game Switcher dropdown if multiple games exist */}
        {games.length > 1 && (
          <div className="overlay-notes__game-select">
            <select
              value={targetGameId}
              onChange={(e) => setSelectedGameId(e.target.value)}
              className="overlay-select-mini"
              aria-label={t("overlay.notes.selectGame")}
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <NotesManager key={targetGameId} gameId={targetGameId} gameTitle={activeGame?.name ?? ""} />
    </Card>
  );
}

function NotesManager({ gameId, gameTitle }: { gameId: string; gameTitle: string }) {
  const { t } = useLanguage();
  const { notes, loading, createNote, updateNote, deleteNote } = useGameNotes(gameId);
  const {
    visible: visibleNotes,
    hasMore,
    showMore,
  } = useIncrementalList(notes);

  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [isPinned, setIsPinned] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [showTagForm, setShowTagForm] = useState(false);

  // Sync active note on list load
  useEffect(() => {
    if (loading) return;
    if (notes.length === 0) {
      setActiveNoteId(null);
      setDraftTitle("");
      setDraftContent("");
      setDraftTags([]);
      setIsPinned(false);
      return;
    }

    const current = notes.find((n) => n.id === activeNoteId) ?? notes[0];
    if (current && current.id !== activeNoteId) {
      setActiveNoteId(current.id);
      setDraftTitle(current.title || "");
      setDraftContent(current.content || "");
      setDraftTags(current.tags || []);
      setIsPinned(current.pinned);
    }
  }, [loading, notes, activeNoteId]);

  const activeNote = notes.find((n) => n.id === activeNoteId);

  // Debounced autosave
  useEffect(() => {
    if (!activeNoteId || !activeNote) return;
    if (
      draftTitle === (activeNote.title || "") &&
      draftContent === (activeNote.content || "") &&
      isPinned === activeNote.pinned &&
      JSON.stringify(draftTags) === JSON.stringify(activeNote.tags || [])
    ) {
      return;
    }

    const timer = setTimeout(() => {
      void (async () => {
        await updateNote({
          ...activeNote,
          title: draftTitle,
          content: draftContent,
          pinned: isPinned,
          tags: draftTags,
        });
        setSaved(true);
      })();
    }, 600);

    return () => clearTimeout(timer);
  }, [draftTitle, draftContent, isPinned, draftTags, activeNoteId, activeNote, updateNote]);

  const handleSelectNote = (note: GameNote) => {
    setActiveNoteId(note.id);
    setDraftTitle(note.title || "");
    setDraftContent(note.content || "");
    setDraftTags(note.tags || []);
    setIsPinned(note.pinned);
    setSaved(false);
  };

  const handleCreateNote = async (template?: TemplateOption) => {
    const draft: GameNoteDraft = {
      title: template?.title || `${gameTitle} Note`,
      content: template?.content || "",
      tags: [],
    };
    const created = await createNote(draft);
    if (created) {
      setActiveNoteId(created.id);
      setDraftTitle(created.title || "");
      setDraftContent(created.content || "");
      setDraftTags(created.tags || []);
      setIsPinned(created.pinned);
      setSaved(true);
      setIsPreview(false);
    }
  };

  const handleDelete = async () => {
    if (!activeNoteId) return;
    await deleteNote(activeNoteId);
  };

  const handleAddTag = () => {
    const val = tagInput.trim();
    if (!val || draftTags.includes(val)) return;
    setDraftTags((prev) => [...prev, val]);
    setTagInput("");
    setShowTagForm(false);
    setSaved(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setDraftTags((prev) => prev.filter((t) => t !== tagToRemove));
    setSaved(false);
  };

  if (loading) {
    return <Skeleton shape="rect" height="10em" />;
  }

  return (
    <div className="overlay-notes-container">
      {notes.length === 0 ? (
        <div className="overlay-notes-empty-state">
          <div className="overlay-notes-empty-icon-wrap">
            <FileText size={32} className="overlay-notes-empty-icon" />
          </div>
          <p className="overlay-notes-empty-title">{t("overlay.notes.noNotes")}</p>
          <p className="overlay-text-muted">{t("overlay.notes.createPrompt")}</p>
          <div className="overlay-notes-empty-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCreateNote()}
              className="overlay-notes-create-btn"
            >
              <Plus size={14} />
              <span>{t("overlay.notes.newNote")}</span>
            </Button>
            <div className="overlay-notes-templates-dropdown">
              <select
                onChange={(e) => {
                  const tmpl = TEMPLATES.find((x) => x.id === e.target.value);
                  if (tmpl) void handleCreateNote(tmpl);
                  e.target.value = "";
                }}
                defaultValue=""
                className="overlay-select-mini"
                aria-label={t("overlay.notes.templates")}
              >
                <option value="" disabled>
                  {t("overlay.notes.templates")}…
                </option>
                {TEMPLATES.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Note Tabs & Actions */}
          <div className="overlay-notes-nav">
            <div className="overlay-notes-tabs-scroll">
              {visibleNotes.map((n) => {
                const isSelected = n.id === activeNoteId;
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`overlay-notes-tab-pill${isSelected ? " active" : ""}`}
                    onClick={() => handleSelectNote(n)}
                  >
                    {n.pinned && <Pin size={11} className="overlay-notes-pin-icon" />}
                    <span>{n.title || t("overlay.notes.newNote")}</span>
                  </button>
                );
              })}
              {hasMore && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="overlay-list-more"
                  onClick={showMore}
                >
                  {t("overlay.list.showMore")}
                </Button>
              )}
            </div>

            <div className="overlay-notes-actions-bar">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCreateNote()}
                title={t("overlay.notes.newNote")}
                className="overlay-notes-add-btn"
              >
                <Plus size={14} />
              </Button>

              <div className="overlay-notes-templates-dropdown">
                <select
                  onChange={(e) => {
                    const tmpl = TEMPLATES.find((x) => x.id === e.target.value);
                    if (tmpl) void handleCreateNote(tmpl);
                    e.target.value = "";
                  }}
                  defaultValue=""
                  className="overlay-select-mini"
                  aria-label={t("overlay.notes.templates")}
                >
                  <option value="" disabled>
                    {t("overlay.notes.templates")}…
                  </option>
                  {TEMPLATES.map((tmpl) => (
                    <option key={tmpl.id} value={tmpl.id}>
                      {tmpl.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="overlay-notes-editor-card">
            {/* Editor Header: Title, Pin, Delete, Preview toggle */}
            <div className="overlay-notes-editor-head">
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => {
                  setSaved(false);
                  setDraftTitle(e.target.value);
                }}
                placeholder={t("overlay.notes.noteTitle")}
                className="overlay-notes-title-input"
              />

              <div className="overlay-notes-tools">
                {saved && (
                  <span className="overlay-notes-saved-badge">
                    <Check size={11} />
                    {t("overlay.notes.saved")}
                  </span>
                )}

                <button
                  type="button"
                  className={`overlay-btn-mini${isPinned ? " active" : ""}`}
                  onClick={() => {
                    setSaved(false);
                    setIsPinned(!isPinned);
                  }}
                  title={isPinned ? t("overlay.notes.unpin") : t("overlay.notes.pin")}
                  aria-label={isPinned ? t("overlay.notes.unpin") : t("overlay.notes.pin")}
                >
                  <Pin size={13} />
                </button>

                <button
                  type="button"
                  className={`overlay-btn-mini${isPreview ? " active" : ""}`}
                  onClick={() => setIsPreview(!isPreview)}
                  title={isPreview ? t("overlay.notes.edit") : t("overlay.notes.preview")}
                  aria-label={isPreview ? t("overlay.notes.edit") : t("overlay.notes.preview")}
                >
                  {isPreview ? <Edit3 size={13} /> : <Eye size={13} />}
                </button>

                <button
                  type="button"
                  className="overlay-btn-mini overlay-btn-danger"
                  onClick={() => void handleDelete()}
                  title={t("overlay.notes.delete")}
                  aria-label={t("overlay.notes.delete")}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Tags row */}
            <div className="overlay-notes-tags-row">
              {draftTags.map((tag) => (
                <span key={tag} className="overlay-notes-tag-chip">
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="overlay-tag-del"
                    aria-label={`Remove tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {showTagForm ? (
                <div className="overlay-notes-tag-add-inline">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddTag();
                      if (e.key === "Escape") setShowTagForm(false);
                    }}
                    autoFocus
                    placeholder={t("overlay.notes.addTag")}
                    className="overlay-tag-input"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="overlay-btn-mini"
                    aria-label="Confirm tag"
                  >
                    ✓
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowTagForm(true)}
                  className="overlay-notes-add-tag-btn"
                  title={t("overlay.notes.addTag")}
                >
                  <Tag size={11} />
                  <span>+</span>
                </button>
              )}
            </div>

            {/* Editor Body or Markdown Preview */}
            <div className="overlay-notes-body-area">
              {isPreview ? (
                <div className="overlay-notes-preview-scroll">
                  <Markdown text={draftContent || "_No content_"} />
                </div>
              ) : (
                <textarea
                  value={draftContent}
                  onChange={(e) => {
                    setSaved(false);
                    setDraftContent(e.target.value);
                  }}
                  placeholder={t("overlay.notes.placeholder")}
                  rows={8}
                  className="overlay-notes-textarea"
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
