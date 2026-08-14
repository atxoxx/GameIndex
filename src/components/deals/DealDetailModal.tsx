import { useEffect, useCallback, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DealItem, GamePassGame, Giveaway } from "../../types/deals";
import {
  formatPrice,
  calculateSavings,
  discountTier,
  formatExpiry,
  formatCountdown,
  storeTint,
  titleToSlug,
} from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import { Button } from "../ui";

export type ModalDealTarget =
  | { type: "deal"; data: DealItem }
  | { type: "gamepass"; data: GamePassGame }
  | { type: "giveaway"; data: Giveaway };

interface DealDetailModalProps {
  target: ModalDealTarget | null;
  onClose: () => void;
  onOpenUrl: (url: string | null | undefined) => void;
}

export default function DealDetailModal({
  target,
  onClose,
  onOpenUrl,
}: DealDetailModalProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlist();
  const { games } = useGames();
  const [copied, setCopied] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!target) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [target, handleKeyDown]);

  if (!target) return null;

  const title =
    target.type === "deal"
      ? target.data.gameTitle
      : target.type === "gamepass"
        ? target.data.title
        : target.data.title;

  const slug = titleToSlug(title);
  const wishlisted = isWishlisted(slug);
  const ownedInLibrary = games.some(
    (g) => g.name.toLowerCase().trim() === title.toLowerCase().trim(),
  );

  const handleWishlistToggle = () => {
    // Construct minimal StoreGameSummary
    toggle({
      id: 0,
      name: title,
      slug,
      summary:
        target.type === "gamepass"
          ? target.data.description ?? null
          : target.type === "giveaway"
            ? target.data.bundleTitle ?? null
            : null,
      rating: null,
      aggregatedRating: null,
      coverUrl:
        target.type === "gamepass"
          ? target.data.coverImage ?? null
          : target.type === "giveaway"
            ? target.data.imageUrl ?? null
            : target.data.thumbnail ?? null,
      logoUrl: null,
      genres: target.type === "gamepass" ? target.data.categories : [],
      platforms:
        target.type === "deal"
          ? [target.data.platform]
          : target.type === "gamepass"
            ? target.data.platforms
            : [],
      firstReleaseDate:
        target.type === "gamepass" ? target.data.releaseDate ?? null : null,
      totalRatingCount: 0,
      hypes: 0,
    });
  };

  const directUrl =
    target.type === "deal"
      ? target.data.storeUrl
      : target.type === "gamepass"
        ? target.data.deeplink
        : target.data.dealUrl;

  const handleCopyLink = async () => {
    if (!directUrl) return;
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(directUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* clipboard error fallback */
    }
  };

  const handleSearchWiki = () => {
    const query = encodeURIComponent(title);
    void openUrl(`https://www.pcgamingwiki.com/w/index.php?search=${query}`);
  };

  const handleSearchSteamDb = () => {
    const query = encodeURIComponent(title);
    void openUrl(`https://steamdb.info/search/?a=app&q=${query}`);
  };

  // Render variables according to target type
  let storeName = "";
  let coverImage: string | null = null;
  let priceEl: React.ReactNode = null;
  let tier = "";
  let expiryInfo: React.ReactNode = null;
  let description: string | null = null;
  let developer: string | null = null;
  let publisher: string | null = null;
  let categories: string[] = [];
  let platforms: string[] = [];

  if (target.type === "deal") {
    const d = target.data;
    storeName = d.storeName;
    coverImage = d.thumbnail ?? null;
    tier = discountTier(d.discountPercent);
    const { originalPrice, savings } = calculateSavings(
      d.dealPrice,
      d.discountPercent,
    );
    platforms = [d.platform];
    const expiry = formatExpiry(d.expiration);

    priceEl = (
      <div className="deals-detail-price-box">
        <div className="deals-detail-price-row">
          <span className={`deals-detail-discount-badge ${tier}`}>
            -{d.discountPercent}%
          </span>
          <span className="deals-detail-current-price">
            {formatPrice(d.dealPrice)}
          </span>
          {savings > 0 && (
            <span className="deals-detail-original-price">
              {formatPrice(originalPrice)}
            </span>
          )}
        </div>
        {savings > 0 && (
          <span className="deals-detail-savings-chip">
            {t("deals.savingsLabel", { amount: formatPrice(savings) })}
          </span>
        )}
      </div>
    );

    if (expiry) {
      expiryInfo = (
        <span className="deals-detail-meta-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {t("deals.ends", { date: expiry })}
        </span>
      );
    }
  } else if (target.type === "gamepass") {
    const gp = target.data;
    storeName = "Xbox Game Pass";
    coverImage = gp.coverImage ?? null;
    description = gp.description ?? null;
    developer = gp.developer ?? null;
    publisher = gp.publisher ?? null;
    categories = gp.categories ?? [];
    platforms = gp.platforms ?? [];

    priceEl = (
      <div className="deals-detail-price-box">
        <span className="deals-detail-gamepass-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <line x1="7" y1="12" x2="11" y2="12" />
            <line x1="9" y1="10" x2="9" y2="14" />
            <line x1="15" y1="10" x2="17" y2="14" />
            <line x1="17" y1="10" x2="15" y2="14" />
          </svg>
          {t("deals.includedWithGamePass")}
        </span>
      </div>
    );
  } else if (target.type === "giveaway") {
    const gw = target.data;
    storeName = gw.storeName;
    coverImage = gw.imageUrl ?? null;
    description = gw.bundleTitle !== gw.title ? gw.bundleTitle : null;
    const countdown = formatCountdown(gw.expiry);
    const expiry = formatExpiry(gw.expiry);

    priceEl = (
      <div className="deals-detail-price-box">
        <div className="deals-detail-price-row">
          <span className="deals-detail-free-badge">
            -100%
          </span>
          <span className="deals-detail-current-price free-text">
            {t("deals.freeClaim")}
          </span>
        </div>
      </div>
    );

    if (countdown) {
      expiryInfo = (
        <span
          className={`deals-detail-meta-pill ${
            countdown.isUrgent ? "urgent" : ""
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {countdown.label} {expiry ? `(${expiry})` : ""}
        </span>
      );
    }
  }

  return (
    <div
      className="modal-backdrop deals-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal deals-detail-modal">
        {/* Banner / Poster Header */}
        <div className="deals-detail-header">
          {coverImage ? (
            <div className="deals-detail-poster-wrap">
              <img src={coverImage} alt={title} className="deals-detail-poster" />
            </div>
          ) : (
            <div
              className="deals-detail-poster-fallback"
              style={{
                background: `color-mix(in srgb, ${storeTint(
                  storeName,
                )} 20%, var(--color-bg-secondary))`,
                color: storeTint(storeName),
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
          )}

          <div className="deals-detail-info">
            <div className="deals-detail-store-strip">
              <span
                className="deals-detail-store-badge"
                style={{
                  background: `color-mix(in srgb, ${storeTint(
                    storeName,
                  )} 22%, var(--color-bg-tertiary))`,
                  borderColor: storeTint(storeName),
                  color: "var(--color-text-primary)",
                }}
              >
                {storeName}
              </span>

              {ownedInLibrary && (
                <span className="deals-detail-owned-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {t("deals.inLibrary")}
                </span>
              )}

              {wishlisted && (
                <span className="deals-detail-wishlisted-badge">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {t("deals.onWishlist")}
                </span>
              )}
            </div>

            <h2 className="deals-detail-title">{title}</h2>

            {priceEl}

            <div className="deals-detail-meta-pills">
              {expiryInfo}
              {platforms.map((p) => (
                <span key={p} className="deals-detail-meta-pill">
                  {p}
                </span>
              ))}
              {developer && (
                <span className="deals-detail-meta-pill">
                  {t("deals.devBy", { dev: developer })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="deals-detail-body">
          {description && (
            <div className="deals-detail-section">
              <h3 className="deals-detail-section-title">
                {t("deals.aboutTitle")}
              </h3>
              <p className="deals-detail-desc">{description}</p>
            </div>
          )}

          {categories.length > 0 && (
            <div className="deals-detail-section">
              <h3 className="deals-detail-section-title">
                {t("deals.genresTitle")}
              </h3>
              <div className="deals-detail-tags">
                {categories.map((cat) => (
                  <span key={cat} className="deals-detail-tag">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          {publisher && (
            <div className="deals-detail-section">
              <span className="deals-detail-pub-note">
                {t("deals.publishedBy", { publisher })}
              </span>
            </div>
          )}

          {/* Quick external database links */}
          <div className="deals-detail-section">
            <h3 className="deals-detail-section-title">
              {t("deals.lookupLinks")}
            </h3>
            <div className="deals-detail-links">
              <button
                type="button"
                className="deals-detail-lookup-btn"
                onClick={handleSearchWiki}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                PCGamingWiki
              </button>
              <button
                type="button"
                className="deals-detail-lookup-btn"
                onClick={handleSearchSteamDb}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5l-.04-.05a2 2 0 0 1 .46-1.57l3.24-3.24a3 3 0 0 1 1.48-.82l2.36-.67" />
                </svg>
                SteamDB
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="deals-detail-footer">
          <div className="deals-detail-footer-left">
            <Button
              variant={wishlisted ? "secondary" : "ghost"}
              size="md"
              onClick={handleWishlistToggle}
              leftIcon={
                <svg
                  viewBox="0 0 24 24"
                  fill={wishlisted ? "var(--color-warning)" : "none"}
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ color: wishlisted ? "var(--color-warning)" : "inherit" }}
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              }
            >
              {wishlisted
                ? t("deals.removeFromWishlist")
                : t("deals.addToWishlist")}
            </Button>

            {directUrl && (
              <Button
                variant="ghost"
                size="md"
                onClick={handleCopyLink}
                leftIcon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                }
              >
                {copied ? t("gameInfo.copied") : t("deals.copyLink")}
              </Button>
            )}
          </div>

          <div className="deals-detail-footer-right">
            <Button variant="ghost" size="md" onClick={onClose}>
              {t("common.close")}
            </Button>

            {directUrl && (
              <Button
                variant="primary"
                size="md"
                onClick={() => onOpenUrl(directUrl)}
                leftIcon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                }
              >
                {target.type === "giveaway"
                  ? t("deals.claimFree")
                  : target.type === "gamepass"
                    ? t("deals.viewOnXbox")
                    : t("deals.openOnStore", { store: storeName })}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
