import { useEffect, useMemo, useRef, useState } from "react";
import "../../../styles/game-notes.css";
import {
  BookOpen,
  ChevronDown,
  FileText,
  ListChecks,
  Loader2,
  NotebookPen,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { Game } from "../../../types/game";
import type { GameNote } from "../../../types/gameNote";
import type { GameNoteDraft } from "../../../hooks/useGameNotes";
import { formatNoteTime } from "../../../utils/gameNotes";
import { useLanguage } from "../../../context/LanguageContext";
import { ConfirmModal } from "../../ui";
import NoteEditor from "./NoteEditor";
import NoteListItem from "./NoteListItem";

/**
 * NotesTab
 *
 *  Full-page per-game notes workspace: a searchable, tag-filterable
 *  list of Markdown notes (guides, checklists, quick thoughts) on the
 *  left, and the editor for the selected note on the right. Notes are
 *  persisted by the parent through `useGameNotes`.
 */

interface NotesTabProps {
  game: Game;
  notes: GameNote[];
  loading: boolean;
  onCreate: (draft: GameNoteDraft) => Promise<GameNote | null>;
  onUpdate: (note: GameNote) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface NoteTemplate {
  id: string;
  icon: typeof FileText;
  labelKey: string;
  hintKey: string;
  contentKey: string | null;
}

const TEMPLATES: NoteTemplate[] = [
  {
    id: "blank",
    icon: FileText,
    labelKey: "notes.template.blank",
    hintKey: "notes.template.blankHint",
    contentKey: null,
  },
  {
    id: "guide",
    icon: BookOpen,
    labelKey: "notes.template.guide",
    hintKey: "notes.template.guideHint",
    contentKey: "notes.template.guideBody",
  },
  {
    id: "checklist",
    icon: ListChecks,
    labelKey: "notes.template.checklist",
    hintKey: "notes.template.checklistHint",
    contentKey: "notes.template.checklistBody",
  },
];

export default function NotesTab({
  game,
  notes,
  loading,
  onCreate,
  onUpdate,
  onDelete,
}: NotesTabProps) {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GameNote | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuOpen]);

  const allTags = useMemo(
    () => Array.from(new Set(notes.flatMap((n) => n.tags))).sort((a, b) => a.localeCompare(b)),
    [notes],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return notes.filter((note) => {
      if (tagFilter && !note.tags.includes(tagFilter)) return false;
      if (!query) return true;
      return (
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query) ||
        note.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [notes, search, tagFilter]);

  const selected =
    notes.find((n) => n.id === selectedId) ?? filtered[0] ?? null;

  const createFromTemplate = async (template: NoteTemplate) => {
    setMenuOpen(false);
    const created = await onCreate({
      title: template.contentKey ? t(template.labelKey) : "",
      content: template.contentKey ? t(template.contentKey) : "",
      tags: [],
    });
    if (created) setSelectedId(created.id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    if (selectedId === id) setSelectedId(null);
    await onDelete(id);
  };

  return (
    <div className="notes-tab">
      <aside className="notes-sidebar">
        <div className="notes-sidebar__head">
          <h3 className="notes-sidebar__title">
            {t("notes.title")}
            {notes.length > 0 && <span className="notes-sidebar__count">{notes.length}</span>}
          </h3>
          <div className="notes-sidebar__new" ref={menuRef}>
            <button
              type="button"
              className="notes-new-btn"
              onClick={() => createFromTemplate(TEMPLATES[0])}
            >
              <Plus size={14} />
              <span>{t("notes.newNote")}</span>
            </button>
            <button
              type="button"
              className="notes-new-caret"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={t("notes.templates")}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <ChevronDown size={14} />
            </button>
            {menuOpen && (
              <div className="notes-new-menu" role="menu">
                {TEMPLATES.map((template) => {
                  const Icon = template.icon;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      role="menuitem"
                      className="notes-new-menu__item"
                      onClick={() => createFromTemplate(template)}
                    >
                      <Icon size={15} className="notes-new-menu__icon" />
                      <span className="notes-new-menu__text">
                        <span className="notes-new-menu__label">{t(template.labelKey)}</span>
                        <span className="notes-new-menu__hint">{t(template.hintKey)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="notes-sidebar__search">
          <Search size={14} aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("notes.searchPlaceholder")}
            aria-label={t("notes.searchPlaceholder")}
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label={t("notes.clearSearch")}>
              <X size={13} />
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="notes-sidebar__tags">
            <button
              type="button"
              className={`note-tag-filter${tagFilter === null ? " is-active" : ""}`}
              onClick={() => setTagFilter(null)}
            >
              {t("notes.allNotes")}
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`note-tag-filter${tagFilter === tag ? " is-active" : ""}`}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <div className="notes-sidebar__list">
          {loading && notes.length === 0 ? (
            <div className="notes-sidebar__loading">
              <Loader2 size={16} className="note-editor__save-spinner" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="notes-sidebar__empty">
              {notes.length === 0 ? t("notes.noNotes") : t("notes.noResults")}
            </p>
          ) : (
            filtered.map((note) => (
              <NoteListItem
                key={note.id}
                note={note}
                active={selected?.id === note.id}
                updatedLabel={formatNoteTime(note.updatedAt, t)}
                onSelect={setSelectedId}
              />
            ))
          )}
        </div>
      </aside>

      <section className="notes-tab__pane">
        {selected ? (
          <NoteEditor
            key={selected.id}
            note={selected}
            gameName={game.name}
            onSave={onUpdate}
            onRequestDelete={setDeleteTarget}
          />
        ) : (
          <div className="notes-empty">
            <NotebookPen size={42} strokeWidth={1.25} aria-hidden />
            <h3 className="notes-empty__title">{t("notes.emptyTitle")}</h3>
            <p className="notes-empty__body">{t("notes.emptyBody")}</p>
            <div className="notes-empty__templates">
              {TEMPLATES.map((template) => {
                const Icon = template.icon;
                return (
                  <button
                    key={template.id}
                    type="button"
                    className="notes-empty__template"
                    onClick={() => createFromTemplate(template)}
                  >
                    <Icon size={18} />
                    <span className="notes-empty__template-label">{t(template.labelKey)}</span>
                    <span className="notes-empty__template-hint">{t(template.hintKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("notes.deleteConfirmTitle")}
        message={t("notes.deleteConfirmBody", {
          title: deleteTarget?.title.trim() || t("notes.untitled"),
        })}
        confirmLabel={t("notes.delete")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
