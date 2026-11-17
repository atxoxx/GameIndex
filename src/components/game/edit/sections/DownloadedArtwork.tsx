import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";

import { Button, ConfirmModal } from "../../../ui";
import { useEditGame } from "../EditGameContext";
import { useToast } from "../../../../context/ToastContext";
import { IMAGE_SUBTAB_CONFIG } from "../editConstants";
import type {
  DeleteGameArtworkResult,
  GameArtworkFile,
} from "../../../../types/artwork";
import { formatSize } from "../../../../types/game";
import { toWebviewAssetUrl } from "../../../../utils/artworkUrl";

/**
 * Every artwork file stored for the game, including replaced versions that
 * are no longer referenced by a slot. Deleting one removes it from disk and
 * clears whichever slot still pointed at it.
 */
export function DownloadedArtwork() {
  const { t, game, sizeUnit, artworkFilesVersion, clearArtworkSlots } = useEditGame();
  const { showToast } = useToast();
  const [files, setFiles] = useState<GameArtworkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmFile, setConfirmFile] = useState<GameArtworkFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<GameArtworkFile[]>("list_game_artwork", { gameId: game.id })
      .then((rows) => {
        if (!cancelled) setFiles(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setFiles([]);
          setError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [game.id, artworkFilesVersion]);

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);

  async function confirmDelete() {
    const file = confirmFile;
    if (!file) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await invoke<DeleteGameArtworkResult>("delete_game_artwork", {
        gameId: game.id,
        fileKey: file.fileKey,
      });
      setFiles((prev) => prev.filter((entry) => entry.fileKey !== file.fileKey));
      clearArtworkSlots(result.clearedSlots);
      showToast(
        t("edit.artwork.fileDeleted", {
          name: file.fileName,
          size: formatSize(result.freedBytes, sizeUnit),
        }),
        "success",
      );
      setConfirmFile(null);
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(false);
    }
  }

  function slotLabel(file: GameArtworkFile): string {
    return file.slot
      ? t(IMAGE_SUBTAB_CONFIG[file.slot].labelKey)
      : t("edit.section.artwork");
  }

  return (
    <section className="edit-downloaded" aria-labelledby="edit-downloaded-title">
      <div className="edit-downloaded-head">
        <div>
          <h3 className="edit-subheading" id="edit-downloaded-title">
            {t("edit.artwork.downloadedTitle")}
          </h3>
          <p className="edit-muted-note">{t("edit.artwork.downloadedHint")}</p>
        </div>
        {files.length > 0 && (
          <span className="edit-downloaded-total">
            {t("edit.artwork.downloadedSummary", {
              count: files.length,
              size: formatSize(totalBytes, sizeUnit),
            })}
          </span>
        )}
      </div>

      {loading ? (
        <p className="edit-muted-note">{t("common.loading")}</p>
      ) : error ? (
        <p className="edit-muted-note">{t("edit.artwork.filesLoadFailed")}</p>
      ) : files.length === 0 ? (
        <p className="edit-muted-note">{t("edit.artwork.downloadedEmpty")}</p>
      ) : (
        <div className="edit-downloaded-grid">
          {files.map((file) => (
            <article
              key={file.fileKey}
              className={`edit-downloaded-card${file.referenced ? " is-referenced" : ""}`}
            >
              <div className="edit-downloaded-preview">
                <img
                  src={toWebviewAssetUrl(file.url)}
                  alt={file.fileName}
                  loading="lazy"
                  decoding="async"
                />
                {file.referenced && (
                  <span className="edit-downloaded-badge">{t("edit.artwork.inUse")}</span>
                )}
              </div>
              <div className="edit-downloaded-meta">
                <span className="edit-downloaded-name" title={file.fileName}>
                  {file.fileName}
                </span>
                <span className="edit-downloaded-sub">
                  {slotLabel(file)} - {formatSize(file.sizeBytes, sizeUnit)}
                  {file.location === "legacy"
                    ? ` - ${t("edit.artwork.previousInstall")}`
                    : ""}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                onClick={() => {
                  setDeleteError(null);
                  setConfirmFile(file);
                }}
                aria-label={t("edit.artwork.deleteFileAria", { name: file.fileName })}
                title={t("edit.artwork.deleteFileAria", { name: file.fileName })}
                leftIcon={<Trash2 size={14} />}
              />
            </article>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmFile !== null}
        title={t("edit.artwork.deleteFileTitle")}
        message={
          confirmFile
            ? t("edit.artwork.deleteFileBody", {
                name: confirmFile.fileName,
                size: formatSize(confirmFile.sizeBytes, sizeUnit),
                slot: slotLabel(confirmFile),
              })
            : undefined
        }
        warning={deleteError ?? undefined}
        busy={deleting}
        confirmLabel={t("common.delete")}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleting) {
            setConfirmFile(null);
            setDeleteError(null);
          }
        }}
      />
    </section>
  );
}
