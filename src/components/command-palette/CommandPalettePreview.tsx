import {
  Calendar,
  Check,
  Clock,
  Download,
  ExternalLink,
  Heart,
  Layers,
  Moon,
  Pin,
  PinOff,
  Play,
  Sparkles,
  Star,
  Trophy,
} from "lucide-react";
import type { PaletteItem } from "./commandPaletteTypes";
import { formatBytes, formatRelativeTime, formatSummaryParagraphs, itemHasDrawerActions } from "./commandPaletteUtils";
import { gameDisplayName } from "../../types/game";

interface CommandPalettePreviewProps {
  item: PaletteItem | null;
  t: (key: string, vars?: Record<string, unknown>) => string;
  locale?: string;
  isWishlisted?: (slug: string) => boolean;
  toggleWishlist?: (game: any) => void;
  onOpenDownloadModal?: (target: { name: string; id?: string; poster?: string }) => void;
  onOpenActionDrawer?: () => void;
  onClose?: () => void;
  navigate?: (path: string) => void;
  /** True only when the preview is a temporary peek (narrow window). */
  canClosePeek?: boolean;
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="cp-meta">
      <span className="cp-meta-label">
        {icon}
        {label}
      </span>
      <span className="cp-meta-value">{value}</span>
    </div>
  );
}

export default function CommandPalettePreview({
  item,
  t,
  locale,
  isWishlisted,
  toggleWishlist,
  onOpenDownloadModal,
  onOpenActionDrawer,
  onClose,
  navigate,
  canClosePeek = false,
}: CommandPalettePreviewProps) {
  if (!item) {
    return (
      <aside className="cp-preview" aria-label={t("commandPalette.previewTitle")}>
        <div className="cp-preview-empty">
          <Moon size={26} aria-hidden="true" />
          <span className="cp-preview-empty-title">{t("commandPalette.previewEmpty")}</span>
          <span className="cp-preview-empty-hint">{t("commandPalette.previewEmptyHint")}</span>
        </div>
      </aside>
    );
  }

  const pinButton = item.pinnable ? (
    <button
      type="button"
      className={`cp-preview-icon${item.pinned ? " is-active" : ""}`}
      onClick={item.onTogglePin}
      title={item.pinned ? t("commandPalette.unpin") : t("commandPalette.pin")}
      aria-label={item.pinned ? t("commandPalette.unpin") : t("commandPalette.pin")}
    >
      {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
    </button>
  ) : null;

  const actionsButton = itemHasDrawerActions(item) ? (
    <button
      type="button"
      className="cp-preview-secondary"
      onClick={onOpenActionDrawer}
      title={t("commandPalette.actionsMenu")}
    >
      <Layers size={13} />
      <span>{t("commandPalette.actionsMenu")}</span>
    </button>
  ) : null;

  const body = (() => {
    if (item.gameData || item.randomGameData) {
      const game = item.gameData ?? item.randomGameData!.game;
      const hero = game.bannerUrl || game.coverArtUrl;
      const summary = formatSummaryParagraphs(game.description).slice(0, 2);
      const lastPlayed = formatRelativeTime(game.lastPlayed, locale);

      return (
        <>
          <div className="cp-preview-head">
            <div className="cp-preview-art">
              {hero ? (
                <img src={hero} alt="" loading="lazy" />
              ) : (
                <span className="cp-preview-art-fallback">
                  <Play size={22} />
                </span>
              )}
            </div>
            <div className="cp-preview-heading">
              <h3 className="cp-preview-title">{gameDisplayName(game)}</h3>
              <div className="cp-preview-chips">
                {item.badgeType === "success" && (
                  <span className="cp-chip is-success">
                    <span className="cp-pulse" aria-hidden="true" />
                    {t("commandPalette.badgeRunning")}
                  </span>
                )}
                <span className="cp-chip">{game.platform || "PC"}</span>
                {game.favorite && (
                  <span className="cp-chip is-accent">
                    <Heart size={10} fill="currentColor" />
                    {t("commandPalette.promptFavorites")}
                  </span>
                )}
                {game.rating ? (
                  <span className="cp-chip">
                    <Star size={10} />
                    {game.rating}/5
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="cp-preview-actions">
            <button type="button" className="cp-preview-primary" onClick={item.onSelect}>
              <Play size={14} fill="currentColor" />
              <span>{game.installed ? t("commandPalette.launch") : t("commandPalette.open")}</span>
              <kbd className="cp-kbd">↵</kbd>
            </button>
            <button
              type="button"
              className="cp-preview-secondary"
              onClick={() => {
                item.onSecondarySelect?.();
                if (!item.onSecondarySelect && navigate) {
                  onClose?.();
                  navigate(`/library/${game.id}`);
                }
              }}
              title={t("commandPalette.hintDetails")}
            >
              <ExternalLink size={13} />
              <span>{t("commandPalette.hintDetails")}</span>
            </button>
            {pinButton}
          </div>

          <div className="cp-preview-grid">
            <Meta
              icon={<Clock size={12} />}
              label={t("commandPalette.inspectorPlaytime")}
              value={game.playTime || "0h"}
            />
            <Meta
              icon={<Calendar size={12} />}
              label={t("commandPalette.inspectorLastPlayed")}
              value={lastPlayed || t("commandPalette.neverPlayed")}
            />
            <Meta
              icon={<Download size={12} />}
              label={t("commandPalette.inspectorSize")}
              value={formatBytes(game.sizeBytes) || "—"}
            />
            <Meta
              icon={<Trophy size={12} />}
              label={t("commandPalette.inspectorAchievements")}
              value={
                item.achievementStats
                  ? `${item.achievementStats.unlocked}/${item.achievementStats.total}`
                  : "—"
              }
            />
          </div>

          {item.achievementStats && item.achievementStats.total > 0 && (
            <div className="cp-preview-progress" aria-hidden="true">
              <span style={{ width: `${item.achievementStats.percentage}%` }} />
            </div>
          )}

          {game.genres && game.genres.length > 0 && (
            <div className="cp-preview-tags">
              {game.genres.slice(0, 4).map((genre) => (
                <span key={genre} className="cp-tag">
                  {genre}
                </span>
              ))}
            </div>
          )}

          {summary.length > 0 && (
            <div className="cp-preview-copy">
              {summary.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          )}

          {actionsButton}
        </>
      );
    }

    if (item.storeData) {
      const store = item.storeData;
      const wishlisted = isWishlisted?.(store.slug || String(store.id)) ?? false;
      const year = store.firstReleaseDate
        ? new Date(store.firstReleaseDate).getFullYear()
        : null;
      const summary = formatSummaryParagraphs(store.summary).slice(0, 3);

      return (
        <>
          <div className="cp-preview-head">
            <div className="cp-preview-art">
              {store.coverUrl ? (
                <img src={store.coverUrl} alt="" loading="lazy" />
              ) : (
                <span className="cp-preview-art-fallback">
                  <Sparkles size={22} />
                </span>
              )}
            </div>
            <div className="cp-preview-heading">
              <h3 className="cp-preview-title">{store.name}</h3>
              <div className="cp-preview-chips">
                <span className="cp-chip is-accent">{t("commandPalette.badgeStore")}</span>
                {year && <span className="cp-chip">{year}</span>}
                {store.rating ? (
                  <span className="cp-chip">
                    <Star size={10} />
                    {Math.round(store.rating)}%
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="cp-preview-actions">
            <button type="button" className="cp-preview-primary" onClick={item.onSelect}>
              <ExternalLink size={14} />
              <span>{t("commandPalette.open")}</span>
              <kbd className="cp-kbd">↵</kbd>
            </button>
            {toggleWishlist && (
              <button
                type="button"
                className={`cp-preview-secondary${wishlisted ? " is-active" : ""}`}
                onClick={() => toggleWishlist(store)}
              >
                <Heart size={13} fill={wishlisted ? "currentColor" : "none"} />
                <span>{wishlisted ? t("store.inWishlist") : t("store.addToWishlist")}</span>
              </button>
            )}
            {onOpenDownloadModal && (
              <button
                type="button"
                className="cp-preview-icon"
                onClick={() =>
                  onOpenDownloadModal({
                    name: store.name,
                    id: String(store.id),
                    poster: store.coverUrl ?? undefined,
                  })
                }
                title={t("commandPalette.quickActionDownload")}
                aria-label={t("commandPalette.quickActionDownload")}
              >
                <Download size={14} />
              </button>
            )}
            {pinButton}
          </div>

          {store.genres && store.genres.length > 0 && (
            <div className="cp-preview-tags">
              {store.genres.slice(0, 4).map((genre) => (
                <span key={genre} className="cp-tag">
                  {genre}
                </span>
              ))}
            </div>
          )}

          {summary.length > 0 && (
            <div className="cp-preview-copy">
              {summary.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          )}
        </>
      );
    }

    if (item.downloadData) {
      const download = item.downloadData;
      const percent = Math.round((download.progress ?? 0) * 100);
      const toggle = item.quickActions?.find((action) => action.id === "toggle");

      return (
        <>
          <div className="cp-preview-head">
            <div className="cp-preview-art is-wide">
              <span className="cp-preview-art-fallback">
                <Download size={22} />
              </span>
            </div>
            <div className="cp-preview-heading">
              <h3 className="cp-preview-title">{download.name || t("nav.downloads")}</h3>
              <div className="cp-preview-chips">
                <span className="cp-chip">{download.status.kind}</span>
                <span className="cp-chip is-accent">{percent}%</span>
              </div>
            </div>
          </div>

          <div className="cp-preview-progress" aria-label={`${percent}%`}>
            <span style={{ width: `${percent}%` }} />
          </div>

          <div className="cp-preview-grid">
            <Meta
              icon={<Download size={12} />}
              label={t("commandPalette.downloadTotalSize")}
              value={formatBytes(download.totalSize ?? undefined) || "—"}
            />
            <Meta
              icon={<Check size={12} />}
              label={t("commandPalette.downloadStatus")}
              value={download.status.kind}
            />
          </div>

          <div className="cp-preview-actions">
            {toggle && (
              <button
                type="button"
                className="cp-preview-primary"
                onClick={(event) => toggle.onClick(event)}
              >
                <Play size={14} />
                <span>{toggle.title}</span>
              </button>
            )}
            <button
              type="button"
              className="cp-preview-secondary"
              onClick={item.onSelect}
            >
              <ExternalLink size={13} />
              <span>{t("nav.downloads")}</span>
            </button>
          </div>
        </>
      );
    }

    // Generic fallback — actions, pages, settings, docs, themes, tools.
    return (
      <>
        <div className="cp-preview-head is-generic">
          <div className="cp-preview-art is-icon">
            <span className="cp-preview-art-fallback">
              {item.calcData ? <Sparkles size={22} /> : item.icon ?? <Sparkles size={22} />}
            </span>
          </div>
          <div className="cp-preview-heading">
            <h3 className="cp-preview-title">
              {item.calcData ? item.calcData.result : item.title}
            </h3>
            {item.subtitle && <span className="cp-preview-sub">{item.subtitle}</span>}
            {item.calcData && (
              <span className="cp-preview-sub">{item.calcData.expression}</span>
            )}
          </div>
        </div>

        <div className="cp-preview-actions">
          <button type="button" className="cp-preview-primary" onClick={item.onSelect}>
            <Check size={14} />
            <span>{item.actionText || t("commandPalette.hintSelect")}</span>
            <kbd className="cp-kbd">↵</kbd>
          </button>
          {item.onSecondarySelect && (
            <button
              type="button"
              className="cp-preview-secondary"
              onClick={item.onSecondarySelect}
            >
              <ExternalLink size={13} />
              <span>{t("commandPalette.hintDetails")}</span>
            </button>
          )}
          {pinButton}
        </div>

        {item.calcData?.details && <p className="cp-preview-copy">{item.calcData.details}</p>}
        {item.description && <p className="cp-preview-copy">{item.description}</p>}

        {item.metaDetails && item.metaDetails.length > 0 && (
          <div className="cp-preview-grid">
            {item.metaDetails.map((meta) => (
              <Meta key={meta.label} icon={null} label={meta.label} value={String(meta.value)} />
            ))}
          </div>
        )}

        {actionsButton}
      </>
    );
  })();

  return (
    <aside className="cp-preview" aria-label={t("commandPalette.previewTitle")}>
      <div className="cp-preview-scroll">{body}</div>
      <div className="cp-preview-footer">
        {canClosePeek ? (
          <span className="cp-hint">
            <kbd className="cp-kbd">Ctrl+↵</kbd>
            <span>{t("commandPalette.hintClosePreview")}</span>
          </span>
        ) : (
          itemHasDrawerActions(item) && (
            <span className="cp-hint">
              <kbd className="cp-kbd">Alt+↵</kbd>
              <span>{t("commandPalette.hintActions")}</span>
            </span>
          )
        )}
        {item.pinnable && (
          <span className="cp-hint">
            <kbd className="cp-kbd">Ctrl+P</kbd>
            <span>{item.pinned ? t("commandPalette.unpin") : t("commandPalette.pin")}</span>
          </span>
        )}
      </div>
    </aside>
  );
}
