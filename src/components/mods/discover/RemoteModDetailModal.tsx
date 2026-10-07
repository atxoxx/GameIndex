import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Calendar,
  Clock,
  Download,
  ExternalLink,
  FileArchive,
  HardDriveDownload,
  Heart,
  Images,
  Info,
  Share2,
  Tag,
  ThumbsUp,
  User,
  X,
} from "lucide-react";
import { Button, Skeleton } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { useRemoteInstall, useRemoteModDetail } from "../../../hooks/useModDiscover";
import type { RemoteModFile, RemoteModSummary } from "../../../types/mods";
import {
  formatBytes,
  formatCount,
  relativeTime,
  sourceLabel,
} from "./format";
import { buildMediaItem, parseDescription, type MediaItem } from "./description";
import ModMediaLightbox from "./ModMediaLightbox";
import InstallProgress from "./InstallProgress";
import "./mods-discover.css";

interface RemoteModDetailModalProps {
  open: boolean;
  gameId: string;
  source: string;
  externalId: string;
  summary: RemoteModSummary;
  isBookmarked?: boolean;
  onClose: () => void;
  onInstalled: () => void;
  onToggleBookmark?: (mod: RemoteModSummary) => void;
}

type DetailTab = "overview" | "files" | "gallery";

function fileKindLabel(kind: RemoteModFile["downloadKind"]): "install" | "open" | "steam" {
  if (kind === "steam") return "steam";
  if (kind === "external") return "open";
  return "install";
}

function kindButtonLabel(
  kind: "install" | "open" | "steam",
  t: (k: string) => string,
): string {
  if (kind === "steam") return t("mods.discover.openInSteam");
  if (kind === "open") return t("mods.discover.openPage");
  return t("mods.discover.install");
}

export default function RemoteModDetailModal({
  open,
  gameId,
  source,
  externalId,
  summary,
  isBookmarked,
  onClose,
  onInstalled,
  onToggleBookmark,
}: RemoteModDetailModalProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { detail, loading, error, load } = useRemoteModDetail();
  const { busy, install } = useRemoteInstall();
  const [installingFile, setInstallingFile] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");

  useEffect(() => {
    if (!open) return;
    void load(source, externalId, summary.id);
    setTab("overview");
    setLightboxIndex(null);
  }, [open, source, externalId, summary.id, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const files = detail?.files ?? [];
  const primaryFile = useMemo(
    () => files.find((f) => f.isPrimary) ?? files[0] ?? null,
    [files],
  );

  const descriptionText = detail?.description?.trim() || summary.summary?.trim() || "";
  const parsed = descriptionText
    ? parseDescription(
        descriptionText,
        setLightboxIndex,
        t("mods.discover.spoiler"),
        (url) => void openUrl(url),
      )
    : null;

  const hasDistinctLeadSummary = Boolean(
    summary.summary &&
      summary.summary.trim() !== descriptionText &&
      summary.summary.trim().length <= 280 &&
      !summary.summary.includes("[h1]") &&
      !summary.summary.includes("[h2]") &&
      !summary.summary.includes("[b]") &&
      !summary.summary.includes("[list]") &&
      !summary.summary.includes("[img]") &&
      !summary.summary.includes("[url]") &&
      !summary.summary.includes("\n\n"),
  );
  const descMedia: MediaItem[] = parsed?.media ?? [];
  const galleryMedia: MediaItem[] = (detail?.gallery ?? []).map(buildMediaItem);
  const allMedia: MediaItem[] = [...descMedia, ...galleryMedia];

  if (!open) return null;

  const updated = relativeTime(summary.updatedAt, language);
  const created = relativeTime(summary.createdAt, language);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(summary.url);
      showToast(t("common.copiedToClipboard", { label: "Link" }), "info");
    } catch {
      showToast(t("common.copyFailed"), "error");
    }
  };

  const handleInstall = async (file?: RemoteModFile | null) => {
    setInstallingFile(file?.id ?? "primary");
    try {
      const res = await install({
        gameId,
        source,
        externalId,
        modId: summary.id,
        fileId: file?.id,
        name: summary.name,
        author: summary.author,
        version: file?.version ?? summary.version,
        remoteUrl: summary.url,
      });

      if (res.status === "installed") {
        showToast(
          t("mods.discover.installedBody", {
            count: String(res.installedFiles),
          }),
          "success",
        );
        onInstalled();
      } else if (res.status === "manual") {
        showToast(res.message ?? t("mods.discover.manualNeeded"), "info");
      } else if (res.status === "steam") {
        if (res.url) void openUrl(res.url);
      } else if (res.status === "external") {
        if (res.url) void openUrl(res.url);
      }
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setInstallingFile(null);
    }
  };

  const modal = (
    <div
      className="modal-backdrop mods-discover-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mods-detail-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mods-discover-modal">
        {/* Modal Header */}
        <div className="mods-discover-modal-head">
          <div className="mods-discover-modal-thumb">
            {summary.thumbnailUrl ? (
              <img src={summary.thumbnailUrl} alt="" />
            ) : (
              <span>{summary.name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>

          <div className="mods-discover-modal-titlegroup">
            <div className="mods-discover-modal-tags">
              <span className={`mods-discover-modal-source source-${summary.source}`}>
                {sourceLabel(summary.source)}
              </span>
              {summary.category && (
                <span className="mods-discover-modal-category">{summary.category}</span>
              )}
              {summary.version && (
                <span className="mods-discover-modal-version">v{summary.version}</span>
              )}
            </div>

            <h2 id="mods-detail-title" className="mods-discover-modal-title">
              {summary.name}
            </h2>

            {summary.author && (
              <span className="mods-discover-modal-author">
                <User size={13} /> {summary.author}
              </span>
            )}
          </div>

          <div className="mods-discover-modal-top-actions">
            {onToggleBookmark && (
              <button
                type="button"
                className={`mods-discover-icon-btn ${isBookmarked ? "is-bookmarked" : ""}`}
                onClick={() => onToggleBookmark(summary)}
                title={isBookmarked ? t("mods.discover.removeBookmark") : t("mods.discover.addBookmark")}
                aria-label={isBookmarked ? t("mods.discover.removeBookmark") : t("mods.discover.addBookmark")}
              >
                <Heart size={16} fill={isBookmarked ? "currentColor" : "none"} />
              </button>
            )}

            <button
              type="button"
              className="mods-discover-icon-btn"
              onClick={handleCopyLink}
              title={t("mods.copyModUrl")}
              aria-label={t("mods.copyModUrl")}
            >
              <Share2 size={16} />
            </button>

            <button
              type="button"
              className="mods-discover-icon-btn"
              onClick={() => void openUrl(summary.url)}
              title={t("mods.discover.openPage")}
              aria-label={t("mods.discover.openPage")}
            >
              <ExternalLink size={16} />
            </button>

            <button
              type="button"
              className="mods-discover-icon-btn mods-discover-modal-close"
              onClick={onClose}
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="mods-discover-modal-stats">
          {summary.downloads != null && (
            <div className="mods-discover-modal-stat">
              <Download size={14} />
              <span className="mods-discover-modal-stat-value">
                {formatCount(summary.downloads)}
              </span>
              <span className="mods-discover-modal-stat-label">
                {t("mods.discover.downloads")}
              </span>
            </div>
          )}

          {summary.endorsements != null && (
            <div className="mods-discover-modal-stat">
              <ThumbsUp size={14} />
              <span className="mods-discover-modal-stat-value">
                {formatCount(summary.endorsements)}
              </span>
              <span className="mods-discover-modal-stat-label">
                {t("mods.discover.endorsements")}
              </span>
            </div>
          )}

          {created && (
            <div className="mods-discover-modal-stat">
              <Calendar size={14} />
              <span className="mods-discover-modal-stat-value">{created}</span>
              <span className="mods-discover-modal-stat-label">
                {t("mods.discover.created")}
              </span>
            </div>
          )}

          {updated && (
            <div className="mods-discover-modal-stat">
              <Clock size={14} />
              <span className="mods-discover-modal-stat-value">{updated}</span>
              <span className="mods-discover-modal-stat-label">
                {t("mods.discover.updatedLabel")}
              </span>
            </div>
          )}
        </div>

        {/* Modal Navigation Tabs */}
        <div className="mods-discover-modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "overview"}
            className={`mods-discover-modal-tab${tab === "overview" ? " active" : ""}`}
            onClick={() => setTab("overview")}
          >
            <Info size={14} />
            <span>{t("mods.discover.tabOverview")}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            className={`mods-discover-modal-tab${tab === "files" ? " active" : ""}`}
            onClick={() => setTab("files")}
          >
            <FileArchive size={14} />
            <span>{t("mods.discover.tabFiles")}</span>
            {files.length > 0 && (
              <span className="mods-discover-modal-tab-badge">{files.length}</span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === "gallery"}
            className={`mods-discover-modal-tab${tab === "gallery" ? " active" : ""}`}
            onClick={() => setTab("gallery")}
          >
            <Images size={14} />
            <span>{t("mods.discover.tabGallery")}</span>
            {allMedia.length > 0 && (
              <span className="mods-discover-modal-tab-badge">{allMedia.length}</span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="mods-discover-modal-body">
          {loading ? (
            <div className="mods-discover-modal-skeleton">
              <Skeleton width="100%" height="80px" />
              <Skeleton width="90%" height="20px" />
              <Skeleton width="75%" height="20px" />
              <Skeleton width="60%" height="20px" />
            </div>
          ) : error ? (
            <div className="mods-discover-empty">
              <p>{error}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void load(source, externalId, summary.id)}
              >
                {t("mods.discover.retry")}
              </Button>
            </div>
          ) : (
            <>
              {tab === "overview" && (
                <div className="mods-discover-overview">
                  {hasDistinctLeadSummary && summary.summary && (
                    <div className="mods-discover-lead-summary">
                      {summary.summary}
                    </div>
                  )}

                  {parsed?.node ? (
                    <div className="mods-discover-description-rendered">
                      {parsed.node}
                    </div>
                  ) : (
                    <p className="mods-discover-hint">{t("about.empty")}</p>
                  )}

                  {summary.tags && summary.tags.length > 0 && (
                    <div className="mods-discover-modal-taglist">
                      <span className="mods-discover-taglist-label">
                        <Tag size={13} /> {t("mods.discover.tags")}:
                      </span>
                      {summary.tags.map((tag) => (
                        <span key={tag} className="mods-discover-tag-pill">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === "files" && (
                <div className="mods-discover-files">
                  {files.length === 0 ? (
                    <p className="mods-discover-hint">{t("mods.discover.noFiles")}</p>
                  ) : (
                    <ul className="mods-discover-files-list">
                      {files.map((file) => {
                        const kind = fileKindLabel(file.downloadKind);
                        const isThisInstalling = busy && installingFile === file.id;

                        return (
                          <li key={file.id} className={`mods-discover-file-item ${file.isPrimary ? "is-primary" : ""}`}>
                            <div className="mods-discover-file-info">
                              <div className="mods-discover-file-head">
                                <span className="mods-discover-file-name">{file.name}</span>
                                {file.isPrimary && (
                                  <span className="mods-discover-file-primary-badge">
                                    {t("mods.discover.primaryFile")}
                                  </span>
                                )}
                                {file.version && (
                                  <span className="mods-discover-file-version">v{file.version}</span>
                                )}
                              </div>

                              <div className="mods-discover-file-meta">
                                {file.sizeBytes != null && (
                                  <span>{formatBytes(file.sizeBytes)}</span>
                                )}
                                {file.uploadedAt && (
                                  <span>{relativeTime(file.uploadedAt, language)}</span>
                                )}
                                {file.category && <span>{file.category}</span>}
                              </div>
                            </div>

                            <Button
                              variant={file.isPrimary ? "primary" : "secondary"}
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleInstall(file)}
                              leftIcon={
                                isThisInstalling ? (
                                  <div className="mods-discover-spinner-sm" />
                                ) : (
                                  <Download size={13} />
                                )
                              }
                            >
                              {kindButtonLabel(kind, t)}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {tab === "gallery" && (
                <div className="mods-discover-gallery">
                  {allMedia.length === 0 ? (
                    <p className="mods-discover-hint">{t("mods.discover.noGallery")}</p>
                  ) : (
                    <div className="mods-discover-gallery-grid">
                      {allMedia.map((m, idx) => (
                        <button
                          key={m.url + idx}
                          type="button"
                          className="mods-discover-gallery-item"
                          onClick={() => setLightboxIndex(idx)}
                        >
                          {m.type === "video" && m.poster ? (
                            <img src={m.poster} alt="" loading="lazy" />
                          ) : (
                            <img src={m.url} alt="" loading="lazy" />
                          )}
                          {m.type === "video" && (
                            <span className="mods-discover-video-badge">▶</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Sticky Footer Action Bar */}
        <div className="mods-discover-modal-foot">
          {busy && (
            <div className="mods-discover-modal-progress">
              <InstallProgress active={busy} label={primaryFile?.name ?? summary.name} />
            </div>
          )}

          <div className="mods-discover-modal-foot-actions">
            <Button variant="ghost" size="md" onClick={onClose}>
              {t("common.close")}
            </Button>

            <Button
              variant="primary"
              size="md"
              disabled={busy}
              onClick={() => void handleInstall(primaryFile)}
              leftIcon={
                busy && !installingFile ? (
                  <div className="mods-discover-spinner-sm" />
                ) : (
                  <HardDriveDownload size={16} />
                )
              }
            >
              {kindButtonLabel(
                fileKindLabel(primaryFile?.downloadKind ?? "direct"),
                t,
              )}
            </Button>
          </div>
        </div>
      </div>

      {lightboxIndex != null && allMedia.length > 0 && (
        <ModMediaLightbox
          items={allMedia}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );

  return createPortal(modal, document.body);
}
