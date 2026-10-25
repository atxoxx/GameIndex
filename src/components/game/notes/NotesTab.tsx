import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../../styles/game-notes.css";
import {
  BookOpen,
  CalendarClock,
  ChevronDown,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  NotebookPen,
  Plus,
  ScrollText,
  Search,
  Skull,
  Swords,
} from "lucide-react";
import type { Game } from "../../../types/game";
import type { GameNote } from "../../../types/gameNote";
import type { GameNoteDraft } from "../../../hooks/useGameNotes";
import { formatNoteTime } from "../../../utils/gameNotes";
import { useLanguage } from "../../../context/LanguageContext";
import { useGames } from "../../../context/GameContext";
import { Button, ConfirmModal, DetailDrawer } from "../../ui";
import {
  GameTabSearch,
  GameTabShell,
  GameTabToolbar,
  GameTabViewSwitch,
  useGameTabState,
} from "../tabs";
import NoteEditor from "./NoteEditor";
import NoteListItem from "./NoteListItem";
import NoteSearchItem from "./NoteSearchItem";
import Markdown from "./markdown";
import { useGameNotesSearch } from "./useGameNotesSearch";

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
  {
    id: "boss",
    icon: Skull,
    labelKey: "notes.template.boss",
    hintKey: "notes.template.bossHint",
    contentKey: "notes.template.bossBody",
  },
  {
    id: "build",
    icon: Swords,
    labelKey: "notes.template.build",
    hintKey: "notes.template.buildHint",
    contentKey: "notes.template.buildBody",
  },
  {
    id: "quests",
    icon: ScrollText,
    labelKey: "notes.template.quests",
    hintKey: "notes.template.questsHint",
    contentKey: "notes.template.questsBody",
  },
  {
    id: "journal",
    icon: CalendarClock,
    labelKey: "notes.template.journal",
    hintKey: "notes.template.journalHint",
    contentKey: "notes.template.journalBody",
  },
];

interface NotesTabState {
  scope: "game" | "all";
  item: string;
}

const DEFAULT_STATE: NotesTabState = { scope: "game", item: "" };

/**
 * Notes — a per-game writing workspace with a library-wide search scope.
 *
 * This game keeps the master–detail editor. All games turns the roster into
 * search results across every note; notes from other games open in a read-only
 * drawer so the current note is never lost, with a direct jump to their game.
 */
export default function NotesTab({
  game,
  notes,
  loading,
  onCreate,
  onUpdate,
  onDelete,
}: NotesTabProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { games } = useGames();
  const [state, setState] = useGameTabState<NotesTabState>({
    prefix: "notes",
    defaults: DEFAULT_STATE,
    allowed: { scope: ["game", "all"] },
  });
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GameNote | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const searchStore = useGameNotesSearch(search, state.scope === "all", notes);
  const gamesById = useMemo(
    () => new Map(games.map((entry) => [entry.id, entry])),
    [games],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuOpen]);

  const baseNotes = state.scope === "game" ? notes : searchStore.results;

  const allTags = useMemo(
    () => Array.from(new Set(baseNotes.flatMap((note) => note.tags))).sort((a, b) => a.localeCompare(b)),
    [baseNotes],
  );

  const filtered = useMemo(() => {
    const query = state.scope === "game" ? search.trim().toLowerCase() : "";
    return baseNotes.filter((note) => {
      if (tagFilter && !note.tags.includes(tagFilter)) return false;
      if (!query) return true;
      return (
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query) ||
        note.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [baseNotes, search, state.scope, tagFilter]);

  const selectedCurrent = notes.find((note) => note.id === state.item) ?? null;
  const selectedGlobal =
    state.scope === "all"
      ? searchStore.results.find((note) => note.id === state.item) ?? null
      : null;
  const previewNote =
    selectedGlobal && selectedGlobal.gameId !== game.id ? selectedGlobal : null;
  const selected =
    state.scope === "all"
      ? selectedCurrent
      : selectedCurrent ?? filtered[0] ?? null;

  const previewGame = previewNote ? gamesById.get(previewNote.gameId) : null;

  const createFromTemplate = async (template: NoteTemplate) => {
    setMenuOpen(false);
    const created = await onCreate({
      title: template.contentKey ? t(template.labelKey) : "",
      content: template.contentKey ? t(template.contentKey) : "",
      tags: [],
    });
    if (created) {
      setState({ scope: "game", item: created.id });
      setSearch("");
      setTagFilter(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    if (state.item === id) setState({ item: "" });
    await onDelete(id);
  };

  const selectScope = (scope: "game" | "all") => {
    setState({ scope, item: "" });
    setTagFilter(null);
  };

  const selectNote = (note: GameNote) => {
    setState({ item: note.id });
  };

  const openGameNote = (note: GameNote) => {
    navigate(`/library/${note.gameId}?tab=notes&notesItem=${encodeURIComponent(note.id)}`);
  };

  const newNoteButton = (
    <div className="notes-new" ref={menuRef}>
      <button
        type="button"
        className="notes-new-btn"
        onClick={() => void createFromTemplate(TEMPLATES[0])}
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
                onClick={() => void createFromTemplate(template)}
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
  );

  return (
    <GameTabShell
      eyebrow={t("game.tab.notes")}
      title={t("notes.title")}
      description={
        state.scope === "game"
          ? t("notes.tabSummary", { count: notes.length })
          : t("notes.allGamesSummary", { count: searchStore.results.length })
      }
      icon={<NotebookPen size={20} />}
      actions={newNoteButton}
      toolbar={
        <GameTabToolbar
          search={
            <GameTabSearch
              value={search}
              onChange={setSearch}
              placeholder={
                state.scope === "game"
                  ? t("notes.searchPlaceholder")
                  : t("notes.searchAllPlaceholder")
              }
              label={t("notes.searchPlaceholder")}
              clearLabel={t("notes.clearSearch")}
            />
          }
          filters={
            <GameTabViewSwitch
              items={[
                { id: "game" as const, label: t("notes.scopeGame"), icon: FileText },
                { id: "all" as const, label: t("notes.scopeAll"), icon: FolderOpen },
              ]}
              value={state.scope}
              onChange={selectScope}
              ariaLabel={t("notes.scopeLabel")}
            />
          }
          actions={
            state.scope === "all" ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Search size={14} />}
                onClick={searchStore.refresh}
              >
                {t("common.refresh")}
              </Button>
            ) : undefined
          }
        />
      }
    >
      <div className="notes-tab">
        <aside className="notes-sidebar">
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

          <div className="notes-sidebar__count">
            {state.scope === "game"
              ? t("notes.listCount", { count: filtered.length, total: notes.length })
              : t("notes.searchResultsCount", { count: filtered.length })}
          </div>

          <div className="notes-sidebar__list">
            {loading && notes.length === 0 && state.scope === "game" ? (
              <div className="notes-sidebar__loading">
                <Loader2 size={16} className="note-editor__save-spinner" />
              </div>
            ) : searchStore.loading && state.scope === "all" ? (
              <div className="notes-sidebar__loading">
                <Loader2 size={16} className="note-editor__save-spinner" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="notes-sidebar__empty">
                {state.scope === "all"
                  ? t("notes.noCrossGameResults")
                  : notes.length === 0
                    ? t("notes.noNotes")
                    : t("notes.noResults")}
              </p>
            ) : state.scope === "all" ? (
              filtered.map((note) => {
                const owner = gamesById.get(note.gameId);
                return (
                  <NoteSearchItem
                    key={note.id}
                    note={note}
                    gameName={owner?.name ?? note.gameId}
                    coverUrl={owner?.coverArtUrl}
                    active={state.item === note.id}
                    updatedLabel={formatNoteTime(note.updatedAt, t)}
                    onSelect={selectNote}
                  />
                );
              })
            ) : (
              filtered.map((note) => (
                <NoteListItem
                  key={note.id}
                  note={note}
                  active={selected?.id === note.id}
                  updatedLabel={formatNoteTime(note.updatedAt, t)}
                  onSelect={(id) => setState({ item: id })}
                />
              ))
            )}
          </div>

          {searchStore.error && state.scope === "all" && (
            <p className="notes-sidebar__error" role="status">
              {t("notes.searchFailed")}
            </p>
          )}
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
          ) : previewNote ? (
            <div className="notes-empty">
              <NotebookPen size={42} strokeWidth={1.25} aria-hidden />
              <h3 className="notes-empty__title">{t("notes.previewOpenTitle")}</h3>
              <p className="notes-empty__body">{t("notes.previewOpenBody")}</p>
            </div>
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
                      onClick={() => void createFromTemplate(template)}
                    >
                      <Icon size={18} />
                      <span className="notes-empty__template-label">
                        {t(template.labelKey)}
                      </span>
                      <span className="notes-empty__template-hint">
                        {t(template.hintKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>

      <DetailDrawer
        open={previewNote !== null}
        onClose={() => setState({ item: "" })}
        eyebrow={previewGame?.name ?? t("notes.scopeAll")}
        title={previewNote?.title.trim() || t("notes.untitled")}
        description={
          previewNote
            ? t("notes.previewMeta", {
                game: previewGame?.name ?? previewNote.gameId,
                when: formatNoteTime(previewNote.updatedAt, t),
              })
            : undefined
        }
        closeLabel={t("common.close")}
        footer={
          previewNote ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setState({ scope: "game", item: "" });
                  openGameNote(previewNote);
                }}
              >
                {t("notes.openGame")}
              </Button>
              <span className="notes-drawer__spacer" />
              <Button
                variant="primary"
                size="sm"
                onClick={() => openGameNote(previewNote)}
              >
                {t("notes.editInGame")}
              </Button>
            </>
          ) : undefined
        }
      >
        {previewNote && (
          <>
            <div className="notes-drawer__meta">
              {previewNote.tags.map((tag) => (
                <span key={tag} className="note-tag">
                  {tag}
                </span>
              ))}
            </div>
            <div className="notes-drawer__body">
              <Markdown text={previewNote.content} />
            </div>
          </>
        )}
      </DetailDrawer>

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("notes.deleteConfirmTitle")}
        message={t("notes.deleteConfirmBody", {
          title: deleteTarget?.title.trim() || t("notes.untitled"),
        })}
        confirmLabel={t("notes.delete")}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </GameTabShell>
  );
}
