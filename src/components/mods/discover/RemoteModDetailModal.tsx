// Rich detail modal for a remote mod: tabbed Overview / Files / Gallery,
// a stats grid, clickable media, and a sticky install action footer.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Calendar,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  HardDriveDownload,
  Package,
  Tag,
  ThumbsUp,
  User,
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
  onClose: () => void;
  onInstalled: () => void;
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
  onClose,
  onInstalled,
}: RemoteModDetailModalProps) {
  const { t } = useLanguage();
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

  const parsed = detail?.description
    ? parseDescription(
        detail.description,
        setLightboxIndex,
        t("mods.discover.spoiler"),
        (url) => void openUrl(url),
      )
    : null;
  const descMedia: MediaItem[] = parsed?.media ?? [];
  const galleryMedia: MediaItem[] = (detail?.gallery ?? []).map(buildMediaItem);
  const allMedia: MediaItem[] = [...descMedia, ...galleryMedia];

  if (!open) return null;

  const updated = relativeTime(summary.updatedAt);
  const created = relativeTime(summary.createdAt);

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
            path: res.installedPath ?? "",
          }),
          "success",
        );
        onInstalled();
        onClose();
      } else if (res.status === "manual") {
        showToast(res.message ?? t("mods.discover.manualTitle"), "warning");
        onInstalled();
      } else {
        if (res.url) await openUrl(res.url);
        showToast(
          res.status === "steam"
            ? t("mods.discover.steamTitle")
            : (res.message ?? t("mods.discover.externalTitle")),
          "info",
        );
      }
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setInstallingFile(null);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary.url);
      showToast(t("mods.discover.linkCopied"), "success");
    } catch {
      showToast(summary.url, "info");
    }
  };

  const tabs: { id: DetailTab; label: string; count?: number }[] = [
    { id: "overview", label: t("mods.discover.tab.overview") },
    { id: "files", label: t("mods.discover.tab.files"), count: files.length },
    ...(galleryMedia.length > 0
      ? [{ id: "gallery" as DetailTab, label: t("mods.discover.tab.gallery"), count: galleryMedia.length }]
      : []),
  ];

  const stats: { icon: ReactNode; label: string; value: ReactNode }[] = [
    {
      icon: <Download size={14} />,
      label: t("mods.discover.stat.downloads"),
      value: formatCount(summary.downloads),
    },
    {
      icon: <ThumbsUp size={14} />,
      label: t("mods.discover.stat.endorsements"),
      value: formatCount(summary.endorsements),
    },
    {
      icon: <Tag size={14} />,
      label: t("mods.discover.stat.category"),
      value: summary.category ?? "—",
    },
    {
      icon: <FileArchive size={14} />,
      label: t("mods.discover.stat.version"),
      value: summary.version ? `v${summary.version}` : "—",
    },
    {
      icon: <Clock size={14} />,
      label: t("mods.discover.stat.updated"),
      value: updated ?? "—",
    },
    {
      icon: <Calendar size={14} />,
      label: t("mods.discover.stat.created"),
      value: created ?? "—",
    },
    {
      icon: <User size={14} />,
      label: t("mods.discover.stat.author"),
      value: summary.author ?? "—",
    },
    {
      icon: <FileArchive size={14} />,
      label: t("mods.discover.stat.files"),
      value: files.length > 0 ? String(files.length) : (summary.fileCount ?? "—"),
    },
  ];

  const primaryLabel = primaryFile ? fileKindLabel(primaryFile.downloadKind) : "install";

  return createPortal(
    <div
      className="modal-backdrop mods-discover-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={summary.name}
    >
      <div className="modal mods-remote-modal">
        <div className="mods-remote-modal-header">
          <div className="mods-remote-modal-art">
            {summary.thumbnailUrl ? <img src={summary.thumbnailUrl} alt="" /> : <Package size={28} />}
          </div>
          <div className="mods-remote-modal-title">
            <span className="mods-remote-modal-source">{sourceLabel(summary.source)}</span>
            <h2>{summary.name}</h2>
            <div className="mods-remote-modal-sub">
              {summary.author && <span>{summary.author}</span>}
              {summary.version && <span>v{summary.version}</span>}
              {summary.category && <span>{summary.category}</span>}
            </div>
          </div>
          <div className="mods-remote-modal-header-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleCopy()}
              leftIcon={<Copy size={13} />}
            >
              {t("mods.discover.copyLink")}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("mods.source.close")}
            </Button>
          </div>
        </div>

        <div className="mods-remote-modal-tabs" role="tablist">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={tab === tb.id}
              className={`mods-remote-modal-tab${tab === tb.id ? " is-active" : ""}`}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
              {tb.count != null && <span className="mods-remote-modal-tab-count">{tb.count}</span>}
            </button>
          ))}
        </div>

        <div className="mods-remote-modal-body">
          {busy && <InstallProgress active label={summary.name} />}

          {loading && (
            <div className="mods-remote-modal-loading">
              <Skeleton width="30%" height="1.4em" />
              <Skeleton width="100%" />
              <Skeleton width="92%" />
              <Skeleton width="70%" />
            </div>
          )}

          {!loading && error && <p className="mods-remote-modal-error">{error}</p>}

          {!loading && tab === "overview" && (
            <>
              <div className="mods-remote-stats">
                {stats.map((s) => (
                  <div key={s.label} className="mods-remote-stat">
                    <span className="mods-remote-stat-icon">{s.icon}</span>
                    <span className="mods-remote-stat-label">{s.label}</span>
                    <span className="mods-remote-stat-value">{s.value}</span>
                  </div>
                ))}
              </div>
              {parsed && (
                <section className="mods-remote-modal-section">
                  <h3>{t("mods.discover.description")}</h3>
                  <div className="mods-remote-modal-description">{parsed.node}</div>
                </section>
              )}
            </>
          )}

          {!loading && tab === "files" && (
            <section className="mods-remote-modal-section">
              {files.length === 0 ? (
                <div className="mods-remote-modal-nofiles">
                  <p>{t("mods.discover.noFiles")}</p>
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={busy && installingFile === "primary"}
                    leftIcon={<HardDriveDownload size={14} />}
                    onClick={() => void handleInstall(undefined)}
                  >
                    {t("mods.discover.install")}
                  </Button>
                </div>
              ) : (
                <ul className="mods-remote-modal-files">
                  {files.map((file) => {
                    const label = fileKindLabel(file.downloadKind);
                    return (
                      <li key={file.id || file.name} className="mods-remote-file">
                        <span className="mods-remote-file-icon">
                          <FileArchive size={16} />
                        </span>
                        <div className="mods-remote-file-info">
                          <span className="mods-remote-file-name">{file.name}</span>
                          <span className="mods-remote-file-meta">
                            {file.category && <span>{file.category}</span>}
                            {file.version && <span>v{file.version}</span>}
                            {formatBytes(file.sizeBytes) && <span>{formatBytes(file.sizeBytes)}</span>}
                            {file.isPrimary && (
                              <span className="mods-remote-file-primary">
                                {t("mods.discover.primary")}
                              </span>
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="mods-discover-icon-btn"
                          title={t("mods.discover.openPage")}
                          aria-label={t("mods.discover.openPage")}
                          onClick={() => void openUrl(file.downloadUrl ?? summary.url)}
                        >
                          <ExternalLink size={14} />
                        </button>
                        <Button
                          variant={file.isPrimary ? "primary" : "secondary"}
                          size="sm"
                          isLoading={busy && installingFile === file.id}
                          onClick={() => void handleInstall(file)}
                        >
                          {kindButtonLabel(label, t)}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {!loading && tab === "gallery" && (
            <section className="mods-remote-modal-section">
              {galleryMedia.length === 0 ? (
                <p className="mods-remote-modal-error">{t("mods.discover.noGallery")}</p>
              ) : (
                <div className="mods-remote-modal-gallery">
                  {galleryMedia.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      className="mods-remote-modal-gallery-item"
                      onClick={() => setLightboxIndex(descMedia.length + i)}
                    >
                      {item.type === "video" ? (
                        <>
                          {item.poster ? (
                            <img src={item.poster} alt="" loading="lazy" />
                          ) : (
                            <span className="mods-remote-modal-gallery-video-fallback" />
                          )}
                          <span className="mods-remote-modal-gallery-play" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </>
                      ) : (
                        <img src={item.url} alt="" loading="lazy" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="mods-remote-modal-footer">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ExternalLink size={14} />}
            onClick={() => void openUrl(summary.url)}
          >
            {t("mods.discover.openPage")}
          </Button>
          <Button
            variant="primary"
            size="md"
            isLoading={busy && installingFile === (primaryFile?.id ?? "primary")}
            leftIcon={<HardDriveDownload size={15} />}
            onClick={() => void handleInstall(primaryFile)}
          >
            {kindButtonLabel(primaryLabel, t)}
          </Button>
        </div>
      </div>

      {lightboxIndex != null && allMedia.length > 0 && (
        <ModMediaLightbox
          items={allMedia}
          index={Math.min(lightboxIndex, allMedia.length - 1)}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>,
    document.body,
  );
}
