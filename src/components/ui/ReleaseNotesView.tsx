import { useState, type ReactNode } from "react";
import {
  BookOpen,
  Bug,
  ChevronDown,
  CircleDot,
  FlaskConical,
  Gauge,
  Hammer,
  Info,
  Package,
  Recycle,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import {
  countCommits,
  groupCommits,
  isSafeHref,
  parseInfoNote,
  parseInline,
  type CommitCategory,
  type CommitGroup,
  type InfoNote,
  type ParsedCommit,
  type ReleaseBlock,
} from "../../utils/releaseNotes";

/**
 * ReleaseNotesView — renders a parsed release body. Bullet lists that look
 * like conventional commits are bucketed into labelled, colour-coded sections
 * (Features, Fixes, …) while headings/quotes/prose keep their markdown shape.
 */

interface CategoryMeta {
  icon: LucideIcon;
  labelKey: string;
}

const CATEGORY_META: Record<CommitCategory, CategoryMeta> = {
  feat: { icon: Sparkles, labelKey: "updater.changelogGroup.features" },
  fix: { icon: Bug, labelKey: "updater.changelogGroup.fixes" },
  perf: { icon: Gauge, labelKey: "updater.changelogGroup.performance" },
  refactor: { icon: Recycle, labelKey: "updater.changelogGroup.refactor" },
  test: { icon: FlaskConical, labelKey: "updater.changelogGroup.tests" },
  build: { icon: Hammer, labelKey: "updater.changelogGroup.build" },
  docs: { icon: BookOpen, labelKey: "updater.changelogGroup.docs" },
  chore: { icon: Wrench, labelKey: "updater.changelogGroup.maintenance" },
  release: { icon: Package, labelKey: "updater.changelogGroup.release" },
  other: { icon: CircleDot, labelKey: "updater.changelogGroup.other" },
};

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return parseInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "link":
        return isSafeHref(token.href) ? (
          <a key={key} href={token.href} target="_blank" rel="noreferrer">
            {token.label}
          </a>
        ) : (
          <span key={key}>{token.label}</span>
        );
      case "code":
        return <code key={key}>{token.value}</code>;
      case "strong":
        return <strong key={key}>{token.value}</strong>;
      case "em":
        return <em key={key}>{token.value}</em>;
      default:
        return <span key={key}>{token.value}</span>;
    }
  });
}

function CommitRow({ commit }: { commit: ParsedCommit }) {
  const { t } = useLanguage();
  return (
    <li className={`release-commit${commit.breaking ? " release-commit--breaking" : ""}`}>
      <span className="release-commit-bullet" aria-hidden="true" />
      <span className="release-commit-body">
        {commit.scope && <span className="release-commit-scope">{commit.scope}</span>}
        <span className="release-commit-desc">
          {renderInline(commit.description, "commit")}
        </span>
        {commit.breaking && (
          <span className="release-commit-breaking" title={t("updater.changelogBreaking")}>
            !
          </span>
        )}
      </span>
      {commit.hash &&
        (commit.href && isSafeHref(commit.href) ? (
          <a
            className="release-commit-hash"
            href={commit.href}
            target="_blank"
            rel="noreferrer"
            title={t("updater.changelogViewCommit")}
          >
            {commit.hash}
          </a>
        ) : (
          <span className="release-commit-hash">{commit.hash}</span>
        ))}
    </li>
  );
}

function CommitSection({ group }: { group: CommitGroup }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const meta = CATEGORY_META[group.category];
  const Icon = meta.icon;
  return (
    <section className={`release-group${open ? " open" : ""}`} data-type={group.category}>
      <button
        type="button"
        className="release-group-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="release-group-icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <span className="release-group-label">{t(meta.labelKey)}</span>
        <span className="release-group-count">{group.commits.length}</span>
        <ChevronDown className="release-group-chevron" size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul className="release-group-list">
          {group.commits.map((commit, index) => (
            <CommitRow key={`${commit.hash ?? "c"}-${index}`} commit={commit} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InfoCallout({ note }: { note: InfoNote }) {
  const { t } = useLanguage();
  return (
    <aside className="release-info" role="note">
      <span className="release-info-head">
        <Info size={14} aria-hidden="true" />
        <span className="release-info-label">{t("updater.changelogInfo")}</span>
      </span>
      <span className="release-info-text">{renderInline(note.text, "info")}</span>
      {note.hash &&
        (note.href && isSafeHref(note.href) ? (
          <a
            className="release-commit-hash"
            href={note.href}
            target="_blank"
            rel="noreferrer"
            title={t("updater.changelogViewCommit")}
          >
            {note.hash}
          </a>
        ) : (
          <span className="release-commit-hash">{note.hash}</span>
        ))}
    </aside>
  );
}

/**
 * Pull a leading `info:` note off the top of the release body. Headings are
 * skipped so `## What's Changed` may sit above it, but scanning stops at the
 * first real content block that isn't an info note.
 */
function splitInfoNote(blocks: ReleaseBlock[]): { info: InfoNote | null; rest: ReleaseBlock[] } {
  let info: InfoNote | null = null;
  let scanning = true;
  const rest: ReleaseBlock[] = [];
  for (const block of blocks) {
    if (!scanning) {
      rest.push(block);
      continue;
    }
    if (block.type === "heading") {
      rest.push(block);
      continue;
    }
    if (block.type === "paragraph") {
      const note = parseInfoNote(block.text);
      scanning = false;
      if (note) {
        info = note;
        continue;
      }
      rest.push(block);
      continue;
    }
    if (block.type === "list" && !block.ordered && block.items.length) {
      const note = parseInfoNote(block.items[0]);
      scanning = false;
      if (note) {
        info = note;
        const remaining = block.items.slice(1);
        if (remaining.length) rest.push({ ...block, items: remaining });
        continue;
      }
      rest.push(block);
      continue;
    }
    scanning = false;
    rest.push(block);
  }
  return { info, rest };
}

export interface ReleaseNotesViewProps {
  blocks: ReleaseBlock[];
  /** Tighter spacing/typography for the narrower update prompt. */
  compact?: boolean;
  className?: string;
}

export function ReleaseNotesView({ blocks, compact = false, className }: ReleaseNotesViewProps) {
  const renderBlock = (block: ReleaseBlock, index: number): ReactNode => {
    const key = `block-${index}`;
    switch (block.type) {
      case "heading":
        return (
          <div key={key} className={`release-notes-heading release-notes-heading--${block.level}`}>
            {renderInline(block.text, key)}
          </div>
        );
      case "list": {
        if (!block.ordered && countCommits(block.items) > 0) {
          const groups = groupCommits(block.items);
          const visible = groups.filter((group) => group.category !== "release");
          const sections = visible.length ? visible : groups;
          return (
            <div key={key} className="release-groups">
              {sections.map((group) => (
                <CommitSection key={group.category} group={group} />
              ))}
            </div>
          );
        }
        const items = block.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
        ));
        return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      case "quote":
        return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
      case "rule":
        return <hr key={key} />;
      default:
        return <p key={key}>{renderInline(block.text, key)}</p>;
    }
  };

  const { info, rest } = splitInfoNote(blocks);

  return (
    <div
      className={[
        "release-notes",
        compact ? "release-notes--compact" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {info && <InfoCallout note={info} />}
      {rest.map(renderBlock)}
    </div>
  );
}
