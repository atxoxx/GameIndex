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
  Star,
  X,
} from "lucide-react";

import Markdown from "../../components/game/notes/markdown";
import { ArtworkImage } from "../../components/ui/ArtworkImage";
import { Button } from "../../components/ui/Button";
import { SubTabs } from "../../components/ui/SubTabs";
import { useLanguage } from "../../context/LanguageContext";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import type { PortLink, PortProject, PortReadme } from "../../types/port";
import "../../styles/game-notes.css";
import {
  formatCount,
  formatDate,
  originTone,
  platformAccent,
  statusTone,
} from "./portFormat";
import { RepoMark } from "./portIcons";
import { usePortCover } from "./usePortCover";

type PortTab = "overview" | "readme";

interface PortDetailModalProps {
  project: PortProject;
  onClose: () => void;
}

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
 * The README comes from the project's repository and is rendered with the
 * app's dependency-free Markdown renderer, so no remote HTML is ever injected.
 * Repository facts (description, stars, last push) ride along with the same
 * backend call and are cached for hours.
 */
export default function PortDetailModal({ project, onClose }: PortDetailModalProps) {
  const { t } = useLanguage();
  const copyText = useCopyToClipboard();
  const [tab, setTab] = useState<PortTab>("overview");
  const [readme, setReadme] = useState<PortReadme | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cover = usePortCover(project.game, true);
  const repoLink = primaryRepo(project);
  const repo = readme?.repo ?? null;

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

  useEffect(() => {
    if (!repoLink) {
      setReadme({
        markdown: "",
        sourceUrl: "",
        repo: null,
        error: t("ports.readme.noRepo"),
      });
      return;
    }
    let mounted = true;
    setLoading(true);
    setReadme(null);
    invoke<PortReadme>("get_port_readme", { url: repoLink.url })
      .then((result) => {
        if (mounted) setReadme(result);
      })
      .catch((error) => {
        if (mounted) {
          setReadme({
            markdown: "",
            sourceUrl: repoLink.url,
            repo: null,
            error: String(error),
          });
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [project.id, repoLink, t]);

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
            <span className="ports-modal__eyebrow">{project.platform}</span>
            <h2 className="ports-modal__title" id="ports-modal-title">
              {project.game}
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
              {project.realRating != null ? (
                <span
                  className="ports-chip is-default"
                  title={t("ports.facts.realRatingHint")}
                >
                  <Star size={12} aria-hidden /> REAL {project.realRating}/5
                </span>
              ) : null}
            </div>
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
                {repo?.description ? (
                  <section className="ports-modal__section">
                    <h3>{t("ports.about.title")}</h3>
                    <p className="ports-modal__description">{repo.description}</p>
                  </section>
                ) : null}

                {project.notes ? (
                  <section className="ports-modal__section">
                    <h3>{t("ports.notes.title")}</h3>
                    <p className="ports-modal__description">{project.notes}</p>
                  </section>
                ) : null}

                {repo && (repo.stars != null || repo.updatedAt || repo.license) ? (
                  <section className="ports-modal__section">
                    <h3>{t("ports.repo.title")}</h3>
                    <div className="ports-modal__repo">
                      <span className="ports-modal__repo-name">
                        <RepoMark kind={repo.host === "gitlab" ? "gitlab" : "github"} width={15} height={15} />
                        {repo.owner}/{repo.repo}
                      </span>
                      <span className="ports-modal__repo-stats">
                        {repo.stars != null ? (
                          <span>
                            <Star size={13} aria-hidden /> {formatCount(repo.stars)}
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

                {project.links.length === 0 && !project.notes ? (
                  <section className="ports-modal__section">
                    <p className="ports-modal__muted">{t("ports.noDetails")}</p>
                  </section>
                ) : null}
              </>
            ) : (
              <section className="ports-modal__readme">
                {loading ? (
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
              onClick={() => open("https://www.pcgamingwiki.com/wiki/List_of_unofficial_ports")}
            >
              PCGamingWiki
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
