import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  FolderOpen,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useGallery } from "../gallery/useGallery";
import { MediaWall } from "../gallery/MediaWall";
import { CaptureLightbox } from "../gallery/CaptureLightbox";
import { AddFolderModal } from "../gallery/AddFolderModal";
import { AlbumCover } from "../gallery/AlbumCover";
import { fileName, formatCaptureDate, SOURCE_IDS, sourceLabel } from "../gallery/mediaUtils";
import { Button, ConfirmModal } from "../../../components/ui";
import type { Game, MediaFile, TimeframePreset } from "../statsTypes";

interface GalleryTabProps {
  games: Game[];
  range: TimeframePreset;
  onCountChange: (count: number) => void;
}

/**
 * Gallery — captures as albums rather than one long list.
 *
 * Albums are sorted by their newest capture, so the most recent session is
 * always the first thing on screen. Opening an album shows its wall and the
 * shared lightbox; the toolbar filters both levels at once.
 */
export function GalleryTab({ games, range, onCountChange }: GalleryTabProps) {
  const { t } = useLanguage();
  const gallery = useGallery(games, range, onCountChange);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const deleted = await gallery.deleteMedia(pendingDelete);
    setDeleting(false);
    if (deleted) {
      setPendingDelete(null);
      setLightboxIndex(null);
    }
  };

  const pathIndex = useMemo(() => {
    const map = new Map<string, number>();
    gallery.visibleMedia.forEach((item, index) => map.set(item.media.path, index));
    return map;
  }, [gallery.visibleMedia]);

  // Filters can shrink the wall under an open lightbox; close rather than
  // showing a stale frame.
  useEffect(() => {
    if (lightboxIndex === null) return;
    if (lightboxIndex >= gallery.visibleMedia.length) setLightboxIndex(null);
  }, [gallery.visibleMedia.length, lightboxIndex]);

  const openMedia = (path: string) => {
    const index = pathIndex.get(path);
    if (index !== undefined) setLightboxIndex(index);
  };

  const shownCaptures = gallery.albums.reduce((sum, album) => sum + album.media.length, 0);
  const selected = gallery.selectedAlbum;

  return (
    <div className="profile-gallery">
      <div className="profile-toolbar">
        <div className="profile-toolbar__left">
          <Button
            variant="primary"
            onClick={() => void gallery.detect()}
            disabled={gallery.isDetecting}
            leftIcon={<RefreshCw size={14} className={gallery.isDetecting ? "is-spinning" : undefined} />}
          >
            {gallery.isDetecting ? t("community.detecting") : t("profile.scanCaptures")}
          </Button>
          <Button
            variant="secondary"
            onClick={gallery.openAddFolder}
            disabled={gallery.isDetecting}
            leftIcon={<FolderOpen size={14} />}
          >
            {t("community.addCustomFolder")}
          </Button>
        </div>

        <div className="profile-toolbar__right">
          <span className="profile-toolbar__count" title={t("profile.tab.gallery")}>
            <Camera size={13} aria-hidden="true" />
            {range === "all"
              ? t("profile.captureCount", { count: gallery.totalCaptures })
              : t("profile.galleryInRange", { shown: shownCaptures, total: gallery.totalCaptures })}
          </span>
        </div>
      </div>

      <div className="profile-toolbar profile-toolbar--filters">
        <label className="profile-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={gallery.search}
            placeholder={t("community.searchGamesPlaceholder")}
            onChange={(event) => gallery.setSearch(event.target.value)}
          />
        </label>

        <button
          type="button"
          className={`profile-chip${gallery.favoritesOnly ? " is-active" : ""}`}
          aria-pressed={gallery.favoritesOnly}
          onClick={() => gallery.setFavoritesOnly(!gallery.favoritesOnly)}
        >
          <Star size={13} fill={gallery.favoritesOnly ? "currentColor" : "none"} aria-hidden="true" />
          {t("common.favorites")}
          {gallery.favorites.size > 0 && <span className="profile-chip__count">{gallery.favorites.size}</span>}
        </button>

        <select
          className="profile-select"
          value={gallery.mediaKind}
          onChange={(event) => gallery.setMediaKind(event.target.value as typeof gallery.mediaKind)}
          aria-label={t("game.tab.media")}
        >
          <option value="all">{t("common.all")} ({t("game.tab.media")})</option>
          <option value="images">{t("stats.captures.screenshotsOnly")}</option>
          <option value="videos">{t("stats.captures.clipsOnly")}</option>
        </select>

        <select
          className="profile-select"
          value={gallery.sourceFilter ?? "all"}
          onChange={(event) =>
            gallery.setSourceFilter(event.target.value === "all" ? null : event.target.value)
          }
          aria-label={t("library.filter.source")}
        >
          <option value="all">{t("common.all")} ({t("library.filter.source")})</option>
          {SOURCE_IDS.map((source) => (
            <option key={source} value={source}>
              {sourceLabel(source)}
            </option>
          ))}
        </select>

        {gallery.filtersActive && (
          <button type="button" className="profile-chip" onClick={gallery.clearFilters}>
            <X size={13} aria-hidden="true" /> {t("common.clear")}
          </button>
        )}
      </div>

      {(gallery.isDetecting || gallery.isScanning) && (
        <div className="profile-gallery__skeleton" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, index) => (
            <span key={index} className="profile-gallery__skeleton-tile" />
          ))}
        </div>
      )}

      {!gallery.isDetecting && !gallery.isScanning && gallery.albums.length === 0 && (
        <div className="profile-empty profile-empty--page">
          {gallery.totalCaptures === 0 ? <Camera size={24} aria-hidden="true" /> : <AlertTriangle size={24} aria-hidden="true" />}
          <h3>{t("community.browseScreenshots")}</h3>
          <p>
            {gallery.totalCaptures === 0
              ? t("community.screenshotsHint")
              : t("profile.noCapturesInRange")}
          </p>
          {gallery.filtersActive ? (
            <button type="button" className="profile-link" onClick={gallery.clearFilters}>
              {t("common.clear")}
            </button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => void gallery.detect()}
              leftIcon={<RefreshCw size={14} />}
            >
              {t("profile.scanCaptures")}
            </Button>
          )}
        </div>
      )}

      {!gallery.isDetecting && !gallery.isScanning && selected && (
        <section className="profile-album" aria-label={selected.group.gameName}>
          <div className="profile-album__head">
            <button type="button" className="profile-back" onClick={() => gallery.selectAlbum(null)}>
              <ArrowLeft size={15} aria-hidden="true" /> {t("profile.allAlbums")}
            </button>

            <div className="profile-album__identity">
              <span className="profile-album__cover">
                <AlbumCover
                  game={selected.game}
                  cachedCoverUrl={selected.group.coverArtUrl}
                  media={selected.media}
                  isCustom={selected.isCustom}
                />
              </span>
              <div>
                <h2>{selected.group.gameName}</h2>
                <span className="profile-album__meta">
                  {t("community.screenshotCount", {
                    count: selected.media.length,
                    plural: selected.media.length !== 1 ? "s" : "",
                  })}
                  {selected.latest > 0 && <> · {formatCaptureDate(selected.latest)}</>}
                  {selected.group.source && <span className="profile-source">{sourceLabel(selected.group.source)}</span>}
                </span>
              </div>
            </div>

            {selected.isCustom && selected.group.customFolderId && (
              <button
                type="button"
                className="profile-link profile-link--danger"
                onClick={() => gallery.removeFolder(selected.group.customFolderId!)}
              >
                <X size={13} aria-hidden="true" /> {t("community.removeFolder")}
              </button>
            )}
          </div>

          <MediaWall
            key={selected.group.key}
            media={selected.media}
            albumLabel={selected.group.gameName}
            favorites={gallery.favorites}
            onOpen={openMedia}
            onToggleFavorite={gallery.toggleFavorite}
            onDelete={setPendingDelete}
          />
        </section>
      )}

      {!gallery.isDetecting && !gallery.isScanning && !selected && gallery.albums.length > 0 && (
        <section aria-label={t("profile.allAlbums")}>
          <div className="profile-section__head">
            <h2>{t("profile.albums")}</h2>
            <span className="profile-section__meta">
              {t("profile.albumCount", { count: gallery.albums.length })}
            </span>
          </div>

          <div className="profile-album-grid">
            {gallery.albums.map((album) => (
              <div
                key={album.group.key}
                className="profile-album-card"
                role="button"
                tabIndex={0}
                onClick={() => gallery.selectAlbum(album.group.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    gallery.selectAlbum(album.group.key);
                  }
                }}
              >
                <span className="profile-album-card__cover">
                  <AlbumCover
                    game={album.game}
                    cachedCoverUrl={album.group.coverArtUrl}
                    media={album.media}
                    isCustom={album.isCustom}
                  />
                  <span className="profile-album-card__count">
                    {album.media.length}
                  </span>
                </span>
                <span className="profile-album-card__body">
                  <span className="profile-album-card__name" title={album.group.gameName}>
                    {album.group.gameName}
                  </span>
                  <span className="profile-album-card__meta">
                    {album.latest > 0 ? formatCaptureDate(album.latest) : t("profile.noDate")}
                    {album.group.source && <span className="profile-source">{sourceLabel(album.group.source)}</span>}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {gallery.isAddFolderOpen && (
        <AddFolderModal
          isAdding={gallery.isScanning}
          onCancel={gallery.closeAddFolder}
          onConfirm={(name, path) => void gallery.addFolder(name, path)}
        />
      )}

      {lightboxIndex !== null && (
        <CaptureLightbox
          items={gallery.visibleMedia}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          favorites={gallery.favorites}
          onToggleFavorite={gallery.toggleFavorite}
          onDelete={setPendingDelete}
        />
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("profile.deleteCaptureTitle")}
        message={t("profile.deleteCaptureBody", {
          name: pendingDelete ? fileName(pendingDelete.path) : "",
        })}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
