// Rich detail modal for a remote mod: formatted description (BBCode or
// HTML), clickable/expandable media, a file list, and the download /
// install action (which may hand off to a browser or Steam).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Download,
  ExternalLink,
  FileArchive,
  HardDriveDownload,
  Package,
} from "lucide-react";
import { Button, Skeleton } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import {
  useRemoteInstall,
  useRemoteModDetail,
} from "../../../hooks/useModDiscover";
import type { RemoteModFile, RemoteModSummary } from "../../../types/mods";
import { formatBytes, formatCount, formatRemoteDate, sourceLabel } from "./format";
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

function fileKindLabel(kind: RemoteModFile["downloadKind"]): "install" | "open" | "steam" {
  if (kind === "steam") return "steam";
  if (kind === "external") return "open";
  return "install";
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

  useEffect(() => {
    if (!open) return;
    void load(source, externalId, summary.id);
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

  if (!open) return null;

  const files = detail?.files ?? [];
  const updated = formatRemoteDate(summary.updatedAt);

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

  const handleInstall = async (file?: RemoteModFile) => {
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
            {summary.thumbnailUrl ? (
              <img src={summary.thumbnailUrl} alt="" />
            ) : (
              <Package size={28} />
            )}
          </div>
          <div className="mods-remote-modal-title">
            <span className="mods-remote-modal-source">{sourceLabel(summary.source)}</span>
            <h2>{summary.name}</h2>
            <div className="mods-remote-modal-sub">
              {summary.author && <span>{summary.author}</span>}
              {summary.version && <span>v{summary.version}</span>}
              {summary.category && <span>{summary.category}</span>}
            </div>
            <div className="mods-remote-modal-stats">
              {summary.downloads != null && (
                <span>
                  <Download size={13} /> {formatCount(summary.downloads)}
                </span>
              )}
              {updated && <span>{t("mods.discover.updated", { date: updated })}</span>}
            </div>
          </div>
          <div className="mods-remote-modal-header-actions">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ExternalLink size={13} />}
              onClick={() => void openUrl(summary.url)}
            >
              {t("mods.discover.openPage")}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("mods.source.close")}
            </Button>
          </div>
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

          {!loading && parsed && (
            <section className="mods-remote-modal-section">
              <h3>{t("mods.discover.description")}</h3>
              <div className="mods-remote-modal-description">{parsed.node}</div>
            </section>
          )}

          {!loading && galleryMedia.length > 0 && (
            <section className="mods-remote-modal-section">
              <h3>{t("mods.discover.gallery")}</h3>
              <div className="mods-remote-modal-gallery">
                {galleryMedia.slice(0, 12).map((item, i) => (
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
            </section>
          )}

          <section className="mods-remote-modal-section">
            <h3>{t("mods.discover.files")}</h3>
            {files.length === 0 && !loading ? (
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
                          {formatBytes(file.sizeBytes) && (
                            <span>{formatBytes(file.sizeBytes)}</span>
                          )}
                          {file.isPrimary && (
                            <span className="mods-remote-file-primary">
                              {t("mods.discover.primary")}
                            </span>
                          )}
                        </span>
                      </div>
                      <Button
                        variant={file.isPrimary ? "primary" : "secondary"}
                        size="sm"
                        isLoading={busy && installingFile === file.id}
                        onClick={() => void handleInstall(file)}
                      >
                        {label === "steam"
                          ? t("mods.discover.openInSteam")
                          : label === "open"
                            ? t("mods.discover.openPage")
                            : t("mods.discover.install")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
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
