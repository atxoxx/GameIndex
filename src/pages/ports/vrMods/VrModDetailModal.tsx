import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Languages,
  Layers,
  Star,
  X,
} from "lucide-react";

import Markdown from "../../../components/game/notes/markdown";
import { ArtworkImage } from "../../../components/ui/ArtworkImage";
import { Button } from "../../../components/ui/Button";
import { SubTabs } from "../../../components/ui/SubTabs";
import { useLanguage } from "../../../context/LanguageContext";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import type {
  VrModDetails,
  VrModEntry,
  VrModGameGroup,
  VrModLink,
  VrReadme,
  VrRepoMeta,
} from "../../../types/vrMod";
import "../../../styles/game-notes.css";
import { formatCount, formatDate, platformAccent } from "../portFormat";
import { RepoMark } from "../portIcons";
import { dedupeLinks } from "./vrModData";
import { formatVrDate, vrKindLabelKey, vrKindTone } from "./vrModFormat";
import "./VrMods.css";

type VrTab = "overview" | "readme";

interface VrModDetailModalProps {
  group: VrModGameGroup;
  onClose: () => void;
}

const repoMetaCache = new Map<string, VrRepoMeta | null>();
const readmeCache = new Map<string, VrReadme>();
const detailsCache = new Map<string, string[]>();

/** The heavy details payload is one lazily fetched chunk, shared by every modal. */
let detailsPayload: Promise<VrModDetails> | null = null;
function getDetails(): Promise<VrModDetails> {
  detailsPayload ??= import("../../../data/vr-mods.details.json").then(
    (module) => (module.default ?? module) as VrModDetails,
  );
  return detailsPayload;
}

function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function iconKind(kind: string): "github" | "gitlab" | "website" {
  if (kind === "github" || kind === "gitlab") return kind;
  return "website";
}

/** Distinguish two repos on the same host with `owner/repo` in the dropdown. */
function repoLabel(url: string, repoKey: string | null): string {
  if (repoKey) return repoKey.replace(/^[^:]+:/, "");
  return linkHost(url);
}

/** The repository that backs an entry: its first GitHub/GitLab link. */
function entryRepoLink(entry: VrModEntry | null | undefined): VrModLink | null {
  if (!entry) return null;
  return entry.links.find((link) => link.kind === "github" || link.kind === "gitlab") ?? null;
}

/**
 * Dropdown label for one mod of the game. The mod name comes first because the
 * options select an *item*; the tail says where it lives (its repository, or
 * the source page when it has none).
 */
function itemLabel(entry: VrModEntry): string {
  const repo = entryRepoLink(entry);
  if (repo) return `${entry.modName} · ${repoLabel(repo.url, repo.repoKey)}`;
  const source = entry.sources[0]?.name ?? "";
  return source ? `${entry.modName} · ${source}` : entry.modName;
}

/**
 * Default item for a freshly opened modal: the entry with the most to show, so
 * a game never opens on a stub entry (many catalog entries are just a link with
 * no description while a sibling entry documents the same mod fully).
 */
function defaultItemIndex(entries: VrModEntry[]): number {
  let best = 0;
  let bestScore = -1;
  entries.forEach((entry, index) => {
    const score =
      (entry.description ? 2 : 0) + (entry.details ? 1 : 0) + (entryRepoLink(entry) ? 1 : 0);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/** Detail view for one VR mod game, mirroring the Ports project modal. */
export default function VrModDetailModal({ group, onClose }: VrModDetailModalProps) {
  const { t, language } = useLanguage();
  const copyText = useCopyToClipboard();
  const [tab, setTab] = useState<VrTab>("overview");
  const [itemIndex, setItemIndex] = useState(() => defaultItemIndex(group.entries));
  const [readmeState, setReadmeState] = useState<{ url: string; data: VrReadme } | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [repoMetaState, setRepoMetaState] = useState<{ url: string; meta: VrRepoMeta | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [detailState, setDetailState] = useState<{ key: string; lines: string[] } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // The dropdown picks one mod of this game, and everything below the header
  // follows it: description, details, facts, links and the repository/README.
  const activeIndex = Math.min(itemIndex, Math.max(0, group.entries.length - 1));
  const activeEntry = group.entries[activeIndex] ?? null;
  const repoLink = entryRepoLink(activeEntry);
  const repoUrl = repoLink?.url ?? null;
  // The header action and the copy button still need *something* to point at
  // when the mod is only published on a non-repository host (Patreon, a site).
  const primaryLink = repoLink ?? activeEntry?.links[0] ?? null;
  const allLinks = useMemo(() => dedupeLinks(activeEntry?.links ?? []), [activeEntry]);
  const primaryKind = activeEntry?.kind ?? group.kinds[0] ?? "unknown";
  const platforms =
    activeEntry && activeEntry.platforms.length > 0 ? activeEntry.platforms : group.platforms;
  const description = activeEntry?.description ?? "";
  const sources = activeEntry?.sources.length ? activeEntry.sources : group.sources;
  const { inlineDetails, detailKey } = useMemo(() => {
    const value = activeEntry?.details ?? "";
    if (!value) return { inlineDetails: [] as string[], detailKey: "" };
    if (value.startsWith("d:")) return { inlineDetails: [] as string[], detailKey: value };
    return {
      inlineDetails: value.split("\n").map((line) => line.trim()).filter(Boolean),
      detailKey: "",
    };
  }, [activeEntry]);
  const details = useMemo(
    () => [
      ...new Set([
        ...inlineDetails,
        ...(detailState?.key === detailKey ? detailState.lines : []),
      ]),
    ],
    [inlineDetails, detailState, detailKey],
  );
  const readme = readmeState?.url === repoUrl ? readmeState.data : null;
  const repo = (repoMetaState?.url === repoUrl ? repoMetaState.meta : null) ?? readme?.repo ?? null;
  const showReadmeLoading = tab === "readme" && !!repoUrl && (readmeLoading || readme === null);

  useEffect(() => {
    setItemIndex(defaultItemIndex(group.entries));
    setTab("overview");
  }, [group.key]);

  // Structured details live in a separate chunk: fetch it once, on first
  // Overview open, instead of shipping 1 MB in the grid bundle.
  useEffect(() => {
    if (tab !== "overview") return;
    if (!detailKey) {
      // Switching to an item without a details key must not leave the previous
      // item's skeleton on screen.
      setDetailsLoading(false);
      return;
    }
    const cached = detailsCache.get(detailKey);
    if (cached) {
      setDetailState({ key: detailKey, lines: cached });
      setDetailsLoading(false);
      return;
    }
    let mounted = true;
    setDetailsLoading(true);
    getDetails()
      .then((payload) => {
        const lines = [
          ...new Set(
            detailKey
              .split(",")
              .flatMap((key) => (payload.lines[key] ?? "").split("\n"))
              .map((line) => line.trim())
              .filter(Boolean),
          ),
        ];
        detailsCache.set(detailKey, lines);
        if (mounted) setDetailState({ key: detailKey, lines });
      })
      .catch(() => {
        if (mounted) setDetailState({ key: detailKey, lines: [] });
      })
      .finally(() => {
        if (mounted) setDetailsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [tab, detailKey]);

  useEffect(() => {
    const restoreFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      restoreFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!repoUrl) return;
    if (repoMetaCache.has(repoUrl)) {
      setRepoMetaState({ url: repoUrl, meta: repoMetaCache.get(repoUrl) ?? null });
      return;
    }
    let mounted = true;
    invoke<VrRepoMeta | null>("get_vr_mod_repo", { url: repoUrl })
      .then((result) => {
        repoMetaCache.set(repoUrl, result ?? null);
        if (mounted) setRepoMetaState({ url: repoUrl, meta: result ?? null });
      })
      .catch(() => {
        repoMetaCache.set(repoUrl, null);
        if (mounted) setRepoMetaState({ url: repoUrl, meta: null });
      });
    return () => {
      mounted = false;
    };
  }, [repoUrl]);

  useEffect(() => {
    if (tab !== "readme") return;
    if (!repoUrl) {
      setReadmeState({
        url: repoUrl ?? "",
        data: { markdown: "", sourceUrl: "", repo: null, error: t("ports.vrMods.readme.noRepo") },
      });
      setReadmeLoading(false);
      return;
    }
    const cached = readmeCache.get(repoUrl);
    if (cached) {
      setReadmeState({ url: repoUrl, data: cached });
      setReadmeLoading(false);
      return;
    }
    let mounted = true;
    setReadmeLoading(true);
    invoke<VrReadme>("get_vr_mod_readme", { url: repoUrl })
      .then((result) => {
        readmeCache.set(repoUrl, result);
        if (mounted) setReadmeState({ url: repoUrl, data: result });
      })
      .catch((error) => {
        if (mounted) {
          setReadmeState({
            url: repoUrl,
            data: { markdown: "", sourceUrl: repoUrl, repo: null, error: String(error) },
          });
        }
      })
      .finally(() => {
        if (mounted) setReadmeLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [tab, repoUrl, t]);

  const open = (url: string) => {
    void openUrl(url);
  };

  const copy = async () => {
    const url = primaryLink?.url;
    if (!url) return;
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const facts: { label: string; value: string }[] = [
    { label: t("ports.vrMods.facts.type"), value: t(vrKindLabelKey(primaryKind)) },
    { label: t("ports.vrMods.facts.platform"), value: platforms.join(", ") },
    ...(activeEntry?.author ? [{ label: t("ports.vrMods.facts.author"), value: activeEntry.author }] : []),
    ...(activeEntry?.date
      ? [{ label: t("ports.vrMods.facts.date"), value: formatVrDate(activeEntry.date, language) ?? activeEntry.date }]
      : []),
    {
      label: t("ports.vrMods.facts.source"),
      value: sources.map((source) => source.name).join(", "),
    },
  ];

  return createPortal(
    <div
      className="modal-backdrop ports-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal ports-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vrmod-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ports-modal__head">
          <span
            className="ports-modal__art"
            style={{ "--port-accent": platformAccent(platforms[0] ?? "PCVR") } as CSSProperties}
          >
            {group.image ? (
              <ArtworkImage className="ports-modal__art-img" src={group.image} alt="" keepLoaded />
            ) : (
              <span className="ports-modal__art-empty" aria-hidden>
                <RepoMark kind={iconKind(primaryLink?.kind ?? "website")} width={26} height={26} />
              </span>
            )}
          </span>

          <div className="ports-modal__headings">
            <span className="ports-modal__eyebrow">
              {t("ports.vrMods.modCount", { count: group.entries.length })}
            </span>
            <h2 className="ports-modal__title" id="vrmod-modal-title">
              {group.title}
            </h2>
            <p className="ports-modal__subtitle" title={activeEntry?.modName ?? undefined}>
              {activeEntry?.modName ?? group.entries[0]?.modName ?? ""}
            </p>
            <div className="ports-modal__badges">
              <span className={`ports-chip is-${vrKindTone(primaryKind)}`}>
                {t(vrKindLabelKey(primaryKind))}
              </span>
              {platforms.slice(0, 3).map((platform) => (
                <span key={platform} className="ports-chip is-default">
                  {platform}
                </span>
              ))}
              {group.githubLinks.length > 0 ? (
                <span className="ports-chip is-accent" title={t("ports.vrMods.githubLinks")}>
                  <Star size={12} aria-hidden /> {group.githubLinks.length}
                </span>
              ) : null}
            </div>
            {group.entries.length > 1 ? (
              <label className="ports-modal__project-select vrmod-item-select">
                <span>{t("ports.vrMods.itemSelect")}</span>
                <select
                  value={String(activeIndex)}
                  onChange={(event) => setItemIndex(Number(event.target.value))}
                >
                  {group.entries.map((entry, index) => (
                    <option key={entry.id} value={index} title={entry.modName}>
                      {itemLabel(entry)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="ports-modal__head-actions">
            {primaryLink ? (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<RepoMark kind={iconKind(primaryLink.kind)} width={14} height={14} />}
                rightIcon={<ArrowUpRight size={14} />}
                onClick={() => open(primaryLink.url)}
              >
                {t("ports.vrMods.openProject")}
              </Button>
            ) : null}
            <button
              type="button"
              className="ports-modal__icon-btn"
              onClick={onClose}
              aria-label={t("ports.vrMods.close")}
              title={t("ports.vrMods.close")}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <SubTabs
          className="ports-modal__subtabs"
          ariaLabel={t("ports.vrMods.modalTabs")}
          value={tab}
          onChange={(next) => setTab(next as VrTab)}
          items={[
            { id: "overview", label: t("ports.vrMods.tab.overview"), icon: BookOpen },
            { id: "readme", label: t("ports.vrMods.tab.readme"), icon: FileText },
          ]}
        />

        <div className="ports-modal__body">
          <div className="ports-modal__main">
            {tab === "overview" ? (
              <>
                {description ? (
                  <section className="ports-modal__section">
                    <h3>{t("ports.vrMods.about.title")}</h3>
                    <p className="ports-modal__description">{description}</p>
                  </section>
                ) : null}

                {details.length > 0 || detailsLoading ? (
                  <section className="ports-modal__section">
                    <h3>{t("ports.vrMods.details.title")}</h3>
                    {detailsLoading ? (
                      <div className="vrmod-details-skeleton" aria-hidden>
                        <span /><span /><span /><span />
                      </div>
                    ) : (
                    <dl className="vrmod-details">
                      {details.map((line) => {
                        const split = line.indexOf(":");
                        if (split < 0) {
                          return (
                            <dd key={line} className="vrmod-details__note">
                              {line}
                            </dd>
                          );
                        }
                        return (
                          <div key={line}>
                            <dt>{line.slice(0, split)}</dt>
                            <dd>{line.slice(split + 1).trim()}</dd>
                          </div>
                        );
                      })}
                    </dl>
                    )}
                  </section>
                ) : null}

                {repo ? (
                  <section className="ports-modal__section">
                    <h3>{t("ports.vrMods.repo.title")}</h3>
                    <div className="ports-modal__repo">
                      <span className="ports-modal__repo-name">
                        <RepoMark kind={repo.host === "gitlab" ? "gitlab" : "github"} width={15} height={15} />
                        {repo.owner}/{repo.repo}
                      </span>
                      {repo.description ? (
                        <span className="ports-modal__repo-desc">{repo.description}</span>
                      ) : null}
                      <span className="ports-modal__repo-stats">
                        {repo.stars != null ? (
                          <span><Star size={13} aria-hidden /> {formatCount(repo.stars)}</span>
                        ) : null}
                        {repo.updatedAt ? (
                          <span><Clock size={13} aria-hidden /> {formatDate(repo.updatedAt, language)}</span>
                        ) : null}
                        {repo.language ? (
                          <span><Languages size={13} aria-hidden /> {repo.language}</span>
                        ) : null}
                        {repo.license ? <span>{repo.license}</span> : null}
                      </span>
                      {(repo.topics ?? []).length > 0 ? (
                        <span className="ports-modal__topics">
                          {(repo.topics ?? []).map((topic) => (
                            <span key={topic} className="ports-chip is-default">{topic}</span>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {!description && details.length === 0 && allLinks.length === 0 ? (
                  <section className="ports-modal__section">
                    <p className="ports-modal__muted">{t("ports.vrMods.noDetails")}</p>
                  </section>
                ) : null}
              </>
            ) : (
              <section className="ports-modal__readme">
                {showReadmeLoading ? (
                  <div className="ports-readme-skeleton" aria-hidden>
                    <span /><span /><span /><span />
                  </div>
                ) : readme?.markdown ? (
                  <>
                    <div className="ports-modal__readme-bar">
                      <span>
                        <RepoMark kind={iconKind(repoLink?.kind ?? "website")} width={14} height={14} />
                        {repoLink ? `${repoLink.label} · README` : "README"}
                      </span>
                      {readme.sourceUrl ? (
                        <button type="button" className="ports-link-btn" onClick={() => open(readme.sourceUrl)}>
                          <ArrowUpRight size={13} /> {t("ports.vrMods.readme.openRaw")}
                        </button>
                      ) : null}
                    </div>
                    <Markdown text={readme.markdown} />
                  </>
                ) : (
                  <div className="ports-modal__readme-empty">
                    <AlertTriangle size={18} aria-hidden />
                    <div>
                      <strong>{t("ports.vrMods.readme.unavailable")}</strong>
                      <p>{readme?.error ?? t("ports.vrMods.readme.noRepo")}</p>
                      {repoLink ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<RepoMark kind={iconKind(repoLink.kind)} width={13} height={13} />}
                          onClick={() => open(repoLink.url)}
                        >
                          {t("ports.vrMods.readme.openOnRepo")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>

          <aside className="ports-modal__side">
            <section className="ports-modal__section">
              <h3>{t("ports.vrMods.facts.title")}</h3>
              <dl className="ports-modal__facts">
                {facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {allLinks.length > 0 ? (
              <section className="ports-modal__section">
                <h3>{t("ports.vrMods.links.title")}</h3>
                <div className="ports-modal__links">
                  {allLinks.map((link) => (
                    <button
                      key={link.url}
                      type="button"
                      className="ports-link-row"
                      onClick={() => open(link.url)}
                    >
                      <span className="ports-link-row__icon">
                        <RepoMark kind={iconKind(link.kind)} width={15} height={15} />
                      </span>
                      <span className="ports-link-row__text">
                        <span className="ports-link-row__label">{link.label}</span>
                        <span className="ports-link-row__host">{linkHost(link.url)}</span>
                      </span>
                      <ArrowUpRight size={14} className="ports-link-row__arrow" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="ports-modal__section">
              <h3>{t("ports.vrMods.sources.title")}</h3>
              <div className="ports-modal__links">
                {sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className="ports-link-row"
                    onClick={() => open(source.url)}
                  >
                    <span className="ports-link-row__icon"><Layers size={15} /></span>
                    <span className="ports-link-row__text">
                      <span className="ports-link-row__label">{source.name}</span>
                      <span className="ports-link-row__host">{linkHost(source.url)}</span>
                    </span>
                    <ArrowUpRight size={14} className="ports-link-row__arrow" />
                  </button>
                ))}
              </div>
            </section>

            <div className="ports-modal__side-actions">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                onClick={() => void copy()}
                disabled={allLinks.length === 0}
              >
                {copied ? t("ports.vrMods.copied") : t("ports.vrMods.copyLink")}
              </Button>
            </div>
          </aside>
        </div>

        <footer className="ports-modal__foot">
          <span>
            {t("ports.vrMods.source")}{" "}
            <button
              type="button"
              className="ports-link-btn"
              onClick={() => open(sources[0]?.url ?? "https://vrportnews.com")}
            >
              {sources[0]?.name ?? "VR Port News"}
            </button>
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("ports.vrMods.close")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
