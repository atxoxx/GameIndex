import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Bold,
  Check,
  Code,
  Columns2,
  Copy,
  Download,
  Eye,
  Heading,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Quote,
  SquareCode,
  Strikethrough,
  Trash2,
} from "lucide-react";
import type { GameNote } from "../../../types/gameNote";
import {
  applyMarkdownFormat,
  formatNoteTime,
  noteCharCount,
  noteFileName,
  noteWordCount,
  type MarkdownFormatAction,
} from "../../../utils/gameNotes";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { TagInput } from "../../ui/TagInput";
import Markdown from "./markdown";

/**
 * NoteEditor
 *
 *  Editor pane for a single note: title, Markdown body with a
 *  formatting toolbar + live preview, tags, pin/copy/export/delete
 *  actions, and debounced auto-save. A pending edit is flushed on
 *  blur, note switch, unmount, and Ctrl/Cmd+S so keystrokes are never
 *  silently dropped when the user navigates away quickly.
 */

interface NoteEditorProps {
  note: GameNote;
  gameName: string;
  onSave: (note: GameNote) => Promise<void>;
  onRequestDelete: (note: GameNote) => void;
}

type EditorMode = "write" | "preview" | "split";
type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 600;

const FORMAT_ACTIONS: {
  action: MarkdownFormatAction;
  icon: typeof Bold;
  labelKey: string;
}[] = [
  { action: "heading", icon: Heading, labelKey: "notes.format.heading" },
  { action: "bold", icon: Bold, labelKey: "notes.format.bold" },
  { action: "italic", icon: Italic, labelKey: "notes.format.italic" },
  { action: "strike", icon: Strikethrough, labelKey: "notes.format.strike" },
  { action: "inlineCode", icon: Code, labelKey: "notes.format.inlineCode" },
  { action: "codeBlock", icon: SquareCode, labelKey: "notes.format.codeBlock" },
  { action: "quote", icon: Quote, labelKey: "notes.format.quote" },
  { action: "bulletList", icon: List, labelKey: "notes.format.bulletList" },
  { action: "orderedList", icon: ListOrdered, labelKey: "notes.format.orderedList" },
  { action: "taskList", icon: ListChecks, labelKey: "notes.format.taskList" },
  { action: "link", icon: LinkIcon, labelKey: "notes.format.link" },
];

export default function NoteEditor({
  note,
  gameName,
  onSave,
  onRequestDelete,
}: NoteEditorProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState(note.tags);
  const [mode, setMode] = useState<EditorMode>("write");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [copied, setCopied] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | null>(null);
  const saveSeqRef = useRef(0);
  const pendingRef = useRef<{
    note: GameNote;
    title: string;
    content: string;
    tags: string[];
  } | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Reset drafts when the selected note changes; pending edits for the
  // previous note are flushed by the cleanup effect below.
  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags);
    setSaveState("idle");
  }, [note.id]);

  const saveNote = useCallback(async (payload: GameNote) => {
    // Only the newest in-flight save owns the final status: a slow save
    // that resolves after a newer keystroke must not flip the footer
    // back to "Saved" while a newer save is still pending.
    const seq = ++saveSeqRef.current;
    setSaveState("saving");
    try {
      await onSaveRef.current(payload);
      if (seq === saveSeqRef.current) setSaveState("saved");
    } catch (err) {
      console.error("Failed to save note:", err);
      if (seq === saveSeqRef.current) setSaveState("error");
    }
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    void saveNote({
      ...pending.note,
      title: pending.title.trim(),
      content: pending.content,
      tags: pending.tags,
    });
  }, [saveNote]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, [note.id]);

  const queueChange = useCallback(
    (patch: { title?: string; content?: string; tags?: string[] }) => {
      const current = pendingRef.current;
      const base = current ?? { note, title, content, tags };
      pendingRef.current = {
        note: current?.note ?? note,
        title: patch.title ?? base.title,
        content: patch.content ?? base.content,
        tags: patch.tags ?? base.tags,
      };
      setSaveState("saving");
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => flushRef.current(), SAVE_DEBOUNCE_MS);
    },
    [note, title, content, tags],
  );

  const saveImmediately = useCallback(
    (override: Partial<GameNote>) => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
      void saveNote({ ...note, title: title.trim(), content, tags, ...override });
    },
    [note, title, content, tags, saveNote],
  );

  const applyAction = (action: MarkdownFormatAction) => {
    const ta = textareaRef.current;
    if (!ta || mode === "preview") return;
    const result = applyMarkdownFormat(ta.value, ta.selectionStart, ta.selectionEnd, action);
    setContent(result.value);
    queueChange({ content: result.value });
    window.requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = `${content.slice(0, start)}  ${content.slice(end)}`;
      setContent(next);
      queueChange({ content: next });
      window.requestAnimationFrame(() => ta.setSelectionRange(start + 2, start + 2));
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      flushRef.current();
    }
  };

  const handleCopy = async () => {
    flush();
    const payload = `# ${title.trim() || t("notes.untitled")}\n\n${content}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      showToast(t("notes.copied"), "success");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy note:", err);
      showToast(t("notes.copyFailed"), "error");
    }
  };

  const handleExport = () => {
    flush();
    const body = `# ${title.trim() || t("notes.untitled")}\n\n${content}`;
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = noteFileName(title, gameName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(t("notes.exported"), "success");
  };

  const words = noteWordCount(content);
  const chars = noteCharCount(content);

  return (
    <div className="note-editor">
      <div className="note-editor__header">
        <input
          className="note-editor__title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queueChange({ title: e.target.value });
          }}
          onBlur={flush}
          placeholder={t("notes.titlePlaceholder")}
          aria-label={t("notes.titlePlaceholder")}
        />
        <div className="note-editor__actions">
          <button
            type="button"
            className={`note-editor__action${note.pinned ? " is-active" : ""}`}
            onClick={() => saveImmediately({ pinned: !note.pinned })}
            title={note.pinned ? t("notes.unpin") : t("notes.pin")}
            aria-label={note.pinned ? t("notes.unpin") : t("notes.pin")}
          >
            {note.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button
            type="button"
            className="note-editor__action"
            onClick={handleCopy}
            title={t("notes.copy")}
            aria-label={t("notes.copy")}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <button
            type="button"
            className="note-editor__action"
            onClick={handleExport}
            title={t("notes.export")}
            aria-label={t("notes.export")}
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            className="note-editor__action note-editor__action--danger"
            onClick={() => onRequestDelete(note)}
            title={t("notes.delete")}
            aria-label={t("notes.delete")}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="note-editor__meta">
        <TagInput
          value={tags}
          onChange={(next) => {
            setTags(next);
            queueChange({ tags: next });
          }}
          placeholder={t("notes.tagPlaceholder")}
          ariaLabel={t("notes.tagsLabel")}
        />
        <span className="note-editor__updated">
          {t("notes.lastEdited", { time: formatNoteTime(note.updatedAt, t) })}
        </span>
      </div>

      <div className="note-editor__toolbar">
        <div className="note-editor__format" role="toolbar" aria-label={t("notes.formatting")}>
          {FORMAT_ACTIONS.map(({ action, icon: Icon, labelKey }) => (
            <button
              key={action}
              type="button"
              className="note-editor__format-btn"
              onClick={() => applyAction(action)}
              disabled={mode === "preview"}
              title={t(labelKey)}
              aria-label={t(labelKey)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <div className="note-editor__modes">
          {(
            [
              { id: "write", icon: Pencil, labelKey: "notes.write" },
              { id: "preview", icon: Eye, labelKey: "notes.preview" },
              { id: "split", icon: Columns2, labelKey: "notes.split" },
            ] as const
          ).map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              className={`note-editor__mode-btn${mode === id ? " is-active" : ""}`}
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
            >
              <Icon size={14} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={`note-editor__body note-editor__body--${mode}`}>
        {mode !== "preview" && (
          <textarea
            ref={textareaRef}
            className="note-editor__textarea"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              queueChange({ content: e.target.value });
            }}
            onBlur={flush}
            onKeyDown={handleTextareaKeyDown}
            placeholder={t("notes.contentPlaceholder")}
            spellCheck
          />
        )}
        {mode !== "write" && (
          <div className="note-editor__preview">
            {content.trim() ? (
              <Markdown text={content} />
            ) : (
              <p className="note-editor__preview-empty">{t("notes.previewEmpty")}</p>
            )}
          </div>
        )}
      </div>

      <div className="note-editor__footer">
        <span className="note-editor__stats">
          {t("notes.words", { count: words })} · {t("notes.characters", { count: chars })}
        </span>
        <span className={`note-editor__save note-editor__save--${saveState}`}>
          {saveState === "saving" && (
            <>
              <Loader2 size={12} className="note-editor__save-spinner" />
              {t("notes.saving")}
            </>
          )}
          {saveState === "saved" && (
            <>
              <Check size={12} />
              {t("notes.saved")}
            </>
          )}
          {saveState === "error" && t("notes.saveError")}
        </span>
      </div>
    </div>
  );
}
