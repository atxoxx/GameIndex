import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  Globe,
  Languages,
  Layers,
  Star,
  X,
} from "lucide-react";

import Markdown from "../../components/game/notes/markdown";
import { ArtworkImage } from "../../components/ui/ArtworkImage";
import { Button } from "../../components/ui/Button";
import { SubTabs } from "../../components/ui/SubTabs";
import { useLanguage } from "../../context/LanguageContext";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import type {
  PortLink,
  PortProject,
  PortReadme,
  PortRepoMeta,
} from "../../types/port";
import { PORT_SOURCES } from "../../types/port";
import "../../styles/game-notes.css";
import "./PortDetailModal.css";
import {
  formatCount,
  formatDate,
  originTone,
  platformAccent,
  statusTone,
} from "./portFormat";
import { RepoMark } from "./portIcons";
import type { PortGameGroup } from "./portGroups";
import { usePortCover } from "./usePortCover";

type PortTab = "overview" | "readme";

interface PortDetailModalProps {
  group: PortGameGroup;
  onClose: () => void;
}

/**
 * Session caches for the two optional network responses, keyed by merged
 * project id. Reopening the modal (or flipping back to a project) then paints
 * instantly instead of showing the README skeleton again.
 */
const repoMetaCache = new Map<string, PortRepoMeta | null>();
const readmeCache = new Map<string, PortReadme>();

function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function primaryRepo(project: PortProject): PortLink | null {
  return project.links.find((link) => link.kind !== "website") ?? null;
}

/**
 * Detail view for one catalog row.
 *
 * Everything on the overview - about text, rating, platforms, origin, status,
 * links and sources - comes from the merged catalog row, so the modal paints
 * with no network round trip. On open it only asks the main process for the
 * repository facts card (`get_port_repo`, disk-cached for hours); the README
 * itself is fetched lazily when its tab is selected and then cached per
 * project. The README is rendered with the app's dependency-free Markdown
 * renderer, so no remote HTML is ever injected.
 */
export default function PortDetailModal({ group, onClose }: PortDetailModalProps) {
  const { t } = useLanguage();
  const copyText = useCopyToClipboard();
  const [tab, setTab] = useState<PortTab>("overview");
  const [activeIndex, setActiveIndex] = useState(0);
  const [readmeState, setReadmeState] = useState<{
    id: string;
    data: PortReadme;
  } | null>(null);
  const [readmeLoadingId, setReadmeLoadingId] = useState<string | null>(null);
  const [repoMetaState, setRepoMetaState] = useState<{
    id: string;
    meta: PortRepoMeta | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const activeProjectIndex = Math.min(activeIndex, group.projects.length - 1);
  const project: PortProject =
    group.projects[activeProjectIndex] ?? group.primary;
  const cover = usePortCover(group.game, {
    initialUrl: project.imageUrl ?? group.primary.imageUrl ?? null,
  });
  const repoLink = primaryRepo(project);
  const repoUrl = repoLink?.url ?? null;
  const readme = readmeState?.id === project.id ? readmeState.data : null;
  const repo =
    (repoMetaState?.id === project.id ? repoMetaState.meta : null) ??
    readme?.repo ??
    null;
  const repoStars = repo?.stars ?? project.stars;
  const aboutText = project.notes || repo?.description || "";
  // The README tab owns its own skeleton/error state; nothing README-shaped is
  // requested until the tab is opened.
  const readmeLoading =
    tab === "readme" &&
    !!repoUrl &&
    (readmeLoadingId === project.id || readme === null);

  // Opening another group (same mounted modal) starts on its first project.
  useEffect(() => {
    setActiveIndex(0);
    setTab("overview");
  }, [group.key]);

  // Scroll lock + focus restore, matching the edit modal's behavior.
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

  // Repository facts for the overview card. Cheap (the main process caches it
  // on disk for hours) and never required for the first paint.
  useEffect(() => {
    if (!repoUrl) return;
    const cached = repoMetaCache.get(project.id);
    if (cached !== undefined) {
      setRepoMetaState({ id: project.id, meta: cached });
      return;
    }
    let mounted = true;
    invoke<PortRepoMeta | null>("get_port_repo", { url: repoUrl })
      .then((result) => {
        const meta = result ?? null;
        repoMetaCache.set(project.id, meta);
        if (mounted) setRepoMetaState({ id: project.id, meta });
      })
      .catch(() => {
        repoMetaCache.set(project.id, null);
        if (mounted) setRepoMetaState({ id: project.id, meta: null });
      });
    return () => {
      mounted = false;
    };
  }, [project.id, repoUrl]);

  // The README is fetched only once its tab is opened, then cached per project.
  useEffect(() => {
    if (tab !== "readme") return;
    if (!repoUrl) {
      setReadmeState({
        id: project.id,
        data: {
          markdown: "",
          sourceUrl: "",
          repo: null,
          error: t("ports.readme.noRepo"),
        },
      });
      setReadmeLoadingId(null);
      return;
    }
    const cached = readmeCache.get(project.id);
    if (cached) {
      setReadmeState({ id: project.id, data: cached });
      setReadmeLoadingId(null);
      return;
    }
    let mounted = true;
    setReadmeLoadingId(project.id);
    invoke<PortReadme>("get_port_readme", { url: repoUrl })
      .then((result) => {
        readmeCache.set(project.id, result);
        if (mounted) setReadmeState({ id: project.id, data: result });
      })
      .catch((error) => {
        if (mounted) {
          setReadmeState({
            id: project.id,
            data: {
              markdown: "",
              sourceUrl: repoUrl,
              repo: null,
              error: String(error),
            },
          });
        }
      })
      .finally(() => {
        if (mounted) setReadmeLoadingId(null);
      });
    return () => {
      mounted = false;
    };
  }, [tab, project.id, repoUrl, t]);

  const open = (url: string) => {
    void openUrl(url);
  };

  const copy = async () => {
    const url = repoLink?.url ?? project.links[0]?.url;
    if (!url) return;
    const copied = await copyText(url);
    if (copied) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const facts: { label: string; value: string }[] = [
    { label: t("ports.facts.platform"), value: project.platform },
    ...(project.group && project.group !== project.platform
      ? [{ label: t("ports.facts.family"), value: project.group }]
      : []),
    ...(project.origin ? [{ label: t("ports.facts.origin"), value: project.origin }] : []),
    { label: t("ports.facts.status"), value: project.status || t("ports.status.unknown") },
    ...(project.languages
      ? [{ label: t("ports.facts.language"), value: project.languages }]
      : []),
    ...(project.platforms.length
      ? [{ label: t("ports.facts.platforms"), value: project.platforms.join(", ") }]
      : []),
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
        aria-labelledby="ports-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ports-modal__head">
          <span
            className="ports-modal__art"
            style={{ "--port-accent": platformAccent(project.platform) } as CSSProperties}
          >
            {cover?.url ? (
              <ArtworkImage
                className="ports-modal__art-img"
                src={cover.url}
                alt=""
                keepLoaded
                onError={(event) => {
                  if (cover.fallbackUrl) event.currentTarget.src = cover.fallbackUrl;
                }}
              />
            ) : (
              <span className="ports-modal__art-empty" aria-hidden>
                <RepoMark kind={repoLink?.kind ?? "website"} width={26} height={26} />
              </span>
            )}
          </span>

          <div className="ports-modal__headings">
            <span className="ports-modal__eyebrow">{group.platform}</span>
            <h2 className="ports-modal__title" id="ports-modal-title">
              {group.game}
            </h2>
            <p className="ports-modal__subtitle">{project.portName}</p>
            <div className="ports-modal__badges">
              <span className={`ports-chip is-${originTone(project.origin)}`}>
                {project.origin || t("ports.origin.unknown")}
              </span>
              <span className={`ports-chip is-${statusTone(project.status)}`}>
                {project.status || t("ports.status.unknown")}
              </span>
              {project.languages ? (
                <span className="ports-chip is-default">
                  <Languages size={12} aria-hidden /> {project.languages}
                </span>
              ) : null}
              {project.stars != null ? (
                <span className="ports-chip is-default" title={t("ports.stars")}>
                  <Star size={12} aria-hidden /> {formatCount(project.stars)}
                </span>
              ) : null}
              {project.communityRating != null ? (
                <span className="ports-chip is-accent" title={t("ports.rating")}>
                  {project.communityRating.toFixed(1)}/5
                </span>
              ) : null}
              {project.realRating != null ? (
                <span
                  className="ports-chip is-default"
                  title={t("ports.facts.realRatingHint")}
                >
                  <Star size={12} aria-hidden /> REAL {project.realRating}/5
                </span>
              ) : null}
              {group.projects.length > 1 ? (
                <span className="ports-chip is-accent">
                  <Layers size={12} aria-hidden />{" "}
                  {t("ports.projectCount", { count: group.projects.length })}
                </span>
              ) : null}
            </div>
            {group.projects.length > 1 ? (
              <label className="ports-modal__project-select">
                <span>{t("ports.projectTabs")}</span>
                <select
                  value={String(activeProjectIndex)}
                  onChange={(event) => setActiveIndex(Number(event.target.value))}
                >
                  {group.projects.map((item, index) => (
                    <option key={item.id} value={index}>
                      {item.status
                        ? `${item.portName} · ${item.status}`
                        : item.portName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="ports-modal__head-actions">
            {repoLink ? (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<RepoMark kind={repoLink.kind} width={14} height={14} />}
                rightIcon={<ArrowUpRight size={14} />}
                onClick={() => open(repoLink.url)}
              >
                {t("ports.openProject")}
              </Button>
            ) : null}
            <button
              type="button"
              className="ports-modal__icon-btn"
              onClick={onClose}
              aria-label={t("ports.close")}
              title={t("ports.close")}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <SubTabs
          className="ports-modal__subtabs"
          ariaLabel={t("ports.modalTabs")}
          value={tab}
          onChange={(next) => setTab(next as PortTab)}
          items={[
            { id: "overview", label: t("ports.tab.overview"), icon: BookOpen },
            { id: "readme", label: t("ports.tab.readme"), icon: FileText },
          ]}
        />

        <div className="ports-modal__body">
          <div className="ports-modal__main">
            {tab === "overview" ? (
              <>
                {aboutText ? (
                  <section className="ports-modal__section">
                    <h3>{t("ports.about.title")}</h3>
                    <p className="ports-modal__description">{aboutText}</p>
                  </section>
                ) : null}

                {repo ? (
                  <section className="ports-modal__section">
                    <h3>{t("ports.repo.title")}</h3>
                    <div className="ports-modal__repo">
                      <span className="ports-modal__repo-name">
                        <RepoMark kind={repo.host === "gitlab" ? "gitlab" : "github"} width={15} height={15} />
                        {repo.owner}/{repo.repo}
                      </span>
                      {project.notes && repo.description ? (
                        <span className="ports-modal__repo-desc">
                          {repo.description}
                        </span>
                      ) : null}
                      <span className="ports-modal__repo-stats">
                        {repoStars != null ? (
                          <span>
                            <Star size={13} aria-hidden /> {formatCount(repoStars)}
                          </span>
                        ) : null}
                        {repo.updatedAt ? (
                          <span>
                            <Clock size={13} aria-hidden /> {formatDate(repo.updatedAt)}
                          </span>
                        ) : null}
                        {repo.language ? (
                          <span>
                            <Languages size={13} aria-hidden /> {repo.language}
                          </span>
                        ) : null}
                        {repo.license ? <span>{repo.license}</span> : null}
                      </span>
                      {repo.topics.length > 0 ? (
                        <span className="ports-modal__topics">
                          {repo.topics.map((topic) => (
                            <span key={topic} className="ports-chip is-default">
                              {topic}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {project.links.length === 0 && !aboutText ? (
                  <section className="ports-modal__section">
                    <p className="ports-modal__muted">{t("ports.noDetails")}</p>
                  </section>
                ) : null}
              </>
            ) : (
              <section className="ports-modal__readme">
                {readmeLoading ? (
                  <div className="ports-readme-skeleton" aria-hidden>
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                ) : readme?.markdown ? (
                  <>
                    <div className="ports-modal__readme-bar">
                      <span>
                        <RepoMark kind={repoLink?.kind ?? "website"} width={14} height={14} />
                        {repoLink ? `${repoLink.label} · README` : "README"}
                      </span>
                      {readme.sourceUrl ? (
                        <button
                          type="button"
                          className="ports-link-btn"
                          onClick={() => open(readme.sourceUrl)}
                        >
                          <ArrowUpRight size={13} /> {t("ports.readme.openRaw")}
                        </button>
                      ) : null}
                    </div>
                    <Markdown text={readme.markdown} />
                  </>
                ) : (
                  <div className="ports-modal__readme-empty">
                    <AlertTriangle size={18} aria-hidden />
                    <div>
                      <strong>{t("ports.readme.unavailable")}</strong>
                      <p>{readme?.error ?? t("ports.readme.noRepo")}</p>
                      {repoLink ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<RepoMark kind={repoLink.kind} width={13} height={13} />}
                          onClick={() => open(repoLink.url)}
                        >
                          {t("ports.readme.openOnRepo")}
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
              <h3>{t("ports.facts.title")}</h3>
              <dl className="ports-modal__facts">
                {facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
                {project.realRating != null ? (
                  <div>
                    <dt>{t("ports.facts.realRating")}</dt>
                    <dd>
                      {project.realRating}/5
                      <span className="ports-modal__fact-hint">
                        {t("ports.facts.realRatingHint")}
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {project.links.length > 0 ? (
              <section className="ports-modal__section">
                <h3>{t("ports.links.title")}</h3>
                <div className="ports-modal__links">
                  {project.links.map((link) => (
                    <button
                      key={`${link.url}-${link.label}`}
                      type="button"
                      className="ports-link-row"
                      onClick={() => open(link.url)}
                    >
                      <span className="ports-link-row__icon">
                        <RepoMark kind={link.kind} width={15} height={15} />
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
              <h3>{t("ports.sources.title")}</h3>
              <div className="ports-modal__links">
                {(project.sources.length > 0
                  ? project.sources
                  : [
                      {
                        id: project.source,
                        name: PORT_SOURCES[project.source].name,
                        url: project.sourceUrl || PORT_SOURCES[project.source].url,
                      },
                    ]
                ).map((source) => (
                  <button
                    key={`${source.id}-${source.url}`}
                    type="button"
                    className="ports-link-row"
                    onClick={() => open(source.url)}
                  >
                    <span className="ports-link-row__icon">
                      <Layers size={15} />
                    </span>
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
                disabled={!repoLink && project.links.length === 0}
              >
                {copied ? t("ports.copied") : t("ports.copyLink")}
              </Button>
              {project.wikiUrl ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Globe size={14} />}
                  onClick={() => open(project.wikiUrl as string)}
                >
                  {t("ports.openWiki")}
                </Button>
              ) : null}
            </div>
          </aside>
        </div>

        <footer className="ports-modal__foot">
          <span>
            {t("ports.source")}{" "}
            <button
              type="button"
              className="ports-link-btn"
              onClick={() =>
                open(project.sourceUrl || PORT_SOURCES[project.source].url)
              }
            >
              {PORT_SOURCES[project.source].name}
            </button>
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("ports.close")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
