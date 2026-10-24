import { useMemo, useState } from "react";
import {
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Gamepad2,
  Gift,
  Heart,
  Library,
  Search,
  Tag,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router-dom";
import type { DealItem, GamePassGame, Giveaway } from "../../types/deals";
import {
  calculateSavings,
  formatCountdown,
  formatExpiry,
  formatPrice,
  groupDealsByTitle,
  steamAppIdFromUrl,
  storeTint,
  titleToSlug,
} from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlistContext } from "../../context/WishlistContext";
import { useOwnedTitles } from "../../hooks/useOwnedTitles";
import { useLibraryGameLookup } from "../../hooks/useLibraryGameLookup";
import { useVisibleInterval } from "../../hooks/useVisibleInterval";
import { copyTextToClipboard } from "../../utils/clipboard";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import DealModalShell, {
  DealModalSection,
  DealModalStat,
} from "./DealModalShell";
import {
  dealGroupSummary,
  gamePassSummary,
  giveawaySummary,
} from "./dealsSummaries";

export type ModalDealTarget =
  | { type: "deal"; data: DealItem; offers?: DealItem[] }
  | { type: "gamepass"; data: GamePassGame }
  | { type: "giveaway"; data: Giveaway };

interface DealDetailModalProps {
  target: ModalDealTarget | null;
  onClose: () => void;
  onOpenUrl: (url: string | null | undefined) => void;
}

function useTickingNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useVisibleInterval(() => setNow(Date.now()), 30_000, active);
  return now;
}

/**
 * DealDetailModal - one modal for a deal, a Game Pass title and a giveaway.
 *
 * A grouped deal gets a store comparison table: every storefront carrying the
 * game, cheapest first, with the premium over the best price. The other sources
 * swap the table for their own facts (categories, publisher, claim countdown)
 * while sharing the hero, stat strip and footer.
 */
export default function DealDetailModal({
  target,
  onClose,
  onOpenUrl,
}: DealDetailModalProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlistContext();
  const isOwned = useOwnedTitles();
  const findLibraryGame = useLibraryGameLookup();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const now = useTickingNow(Boolean(target));
  const [copied, setCopied] = useState(false);

  const dealGroup = useMemo(() => {
    if (target?.type !== "deal") return null;
    const rows = target.offers && target.offers.length > 0 ? target.offers : [target.data];
    return groupDealsByTitle(rows)[0] ?? null;
  }, [target]);

  if (!target) return null;

  const title =
    target.type === "deal"
      ? dealGroup?.title ?? target.data.gameTitle
      : target.data.title;

  const wishlisted = isWishlisted(titleToSlug(title));
  const owned = isOwned(title);
  const libraryGame = findLibraryGame(title);

  const openGamePage = () => {
    if (!libraryGame) return;
    onClose();
    navigate(`/library/${libraryGame.id}`);
  };

  const toggleWishlist = () => {
    if (target.type === "deal" && dealGroup) toggle(dealGroupSummary(dealGroup));
    else if (target.type === "gamepass") toggle(gamePassSummary(target.data));
    else if (target.type === "giveaway") toggle(giveawaySummary(target.data));
  };

  const directUrl =
    target.type === "deal"
      ? dealGroup?.best.storeUrl ?? target.data.storeUrl
      : target.type === "gamepass"
        ? target.data.deeplink ?? null
        : target.data.dealUrl;

  const heroImage =
    target.type === "deal"
      ? dealGroup?.best.thumbnail ?? null
      : target.type === "gamepass"
        ? target.data.coverImage ?? null
        : target.data.imageUrl ?? null;

  const appId =
    target.type === "deal"
      ? steamAppIdFromUrl(dealGroup?.best.storeUrl)
      : null;

  const storeName =
    target.type === "deal"
      ? dealGroup?.best.storeName ?? target.data.storeName
      : target.type === "gamepass"
        ? "Xbox Game Pass"
        : target.data.storeName;

  const tint = storeTint(storeName);
  const countdown =
    target.type === "giveaway"
      ? formatCountdown(target.data.expiry, t, now)
      : dealGroup?.expiresAt
        ? formatCountdown(dealGroup.expiresAt, t, now)
        : null;

  const handleCopy = async () => {
    if (!directUrl) return;
    const ok = await copyTextToClipboard(directUrl);
    showToast(
      ok ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      ok ? "success" : "error",
    );
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const openLookup = (targetUrl: string) => {
    void openUrl(targetUrl);
  };

  const searchQuery = encodeURIComponent(title);

  const badges = (
    <>
      <span
        className="deals-modal__store"
        style={{
          borderColor: `color-mix(in srgb, ${tint} 55%, transparent)`,
          background: `color-mix(in srgb, ${tint} 22%, var(--color-bg-secondary))`,
        }}
      >
        <i style={{ background: tint }} aria-hidden="true" />
        {storeName}
      </span>
      {owned && (
        <span className="deals-modal__badge deals-modal__badge--owned">
          <Library size={11} aria-hidden="true" />
          {t("deals.inLibrary")}
        </span>
      )}
      {wishlisted && (
        <span className="deals-modal__badge deals-modal__badge--wishlist">
          <Heart size={11} fill="currentColor" aria-hidden="true" />
          {t("deals.onWishlist")}
        </span>
      )}
    </>
  );

  const footer = (
    <>
      <Button
        variant={wishlisted ? "secondary" : "ghost"}
        size="md"
        onClick={toggleWishlist}
        leftIcon={
          <Heart
            size={15}
            fill={wishlisted ? "currentColor" : "none"}
            aria-hidden="true"
          />
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
          onClick={handleCopy}
          leftIcon={
            copied ? <Check size={15} /> : <Copy size={15} />
          }
        >
          {copied ? t("gameInfo.copied") : t("deals.copyLink")}
        </Button>
      )}
    </>
  );

  const footerRight = (
    <>
      <Button variant="ghost" size="md" onClick={onClose}>
        {t("common.close")}
      </Button>

      {libraryGame && (
        <Button
          variant="secondary"
          size="md"
          onClick={openGamePage}
          leftIcon={<Gamepad2 size={15} aria-hidden="true" />}
        >
          {t("deals.openGamePage")}
        </Button>
      )}

      {directUrl && (
        <Button
          variant="primary"
          size="md"
          onClick={() => onOpenUrl(directUrl)}
          leftIcon={<ExternalLink size={15} aria-hidden="true" />}
        >
          {target.type === "giveaway"
            ? t("deals.claimFree")
            : target.type === "gamepass"
              ? t("deals.viewOnXbox")
              : t("deals.openOnStore", { store: storeName })}
        </Button>
      )}
    </>
  );

  const subtitle =
    target.type === "deal" ? (
      <>
        {dealGroup && dealGroup.storeCount > 1
          ? t("deals.storeCount", { count: dealGroup.storeCount })
          : t("deals.bestOffer")}
        {dealGroup?.best.platform ? ` · ${dealGroup.best.platform}` : ""}
      </>
    ) : target.type === "gamepass" ? (
      <>
        {target.data.developer ?? t("deals.gamepass")}
        {target.data.releaseDate ? ` · ${target.data.releaseDate}` : ""}
      </>
    ) : (
      <>
        {target.data.bundleTitle}
        {countdown ? ` · ${countdown.label}` : ""}
      </>
    );

  return (
    <DealModalShell
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      image={heroImage}
      appId={appId}
      tint={tint}
      badges={badges}
      footerLeft={footer}
      footerRight={footerRight}
      stats={
        target.type === "deal" && dealGroup ? (
          <>
            <DealModalStat
              label={t("deals.bestPrice")}
              value={formatPrice(dealGroup.bestPrice, "EUR", t("deals.freePrice"))}
              tone="accent"
            />
            <DealModalStat
              label={t("deals.discount")}
              value={`-${dealGroup.maxDiscount}%`}
              tone={dealGroup.maxDiscount >= 75 ? "success" : "default"}
            />
            <DealModalStat
              label={t("deals.storesTracked")}
              value={dealGroup.storeCount}
            />
            <DealModalStat
              label={t("deals.savings")}
              value={
                dealGroup.savings > 0
                  ? formatPrice(dealGroup.savings)
                  : t("deals.cheapest")
              }
            />
          </>
        ) : target.type === "gamepass" ? (
          <>
            <DealModalStat
              label={t("deals.price")}
              value={t("deals.gamepassShort")}
              tone="success"
            />
            <DealModalStat
              label={t("deals.genresTitle")}
              value={target.data.categories.length}
            />
            <DealModalStat
              label={t("deals.platforms")}
              value={target.data.platforms.length}
            />
            <DealModalStat
              label={t("deals.releaseDate")}
              value={target.data.releaseDate ?? "—"}
            />
          </>
        ) : (
          <>
            <DealModalStat
              label={t("deals.price")}
              value={t("deals.freePrice")}
              tone="success"
            />
            <DealModalStat
              label={t("deals.timeLeft")}
              value={countdown ? countdown.label : "—"}
              tone={countdown?.isUrgent ? "warning" : "default"}
            />
            <DealModalStat label={t("deals.store")} value={target.data.storeName} />
          </>
        )
      }
    >
      {target.type === "deal" && dealGroup && (
        <DealModalSection title={t("deals.storeComparison")}>
          <div className="deals-store-table" role="table" aria-label={t("deals.storeComparison")}>
            <div className="deals-store-table__head" role="row">
              <span role="columnheader">{t("deals.store")}</span>
              <span role="columnheader">{t("deals.price")}</span>
              <span role="columnheader">{t("deals.discount")}</span>
              <span role="columnheader">{t("deals.savings")}</span>
              <span role="columnheader" aria-hidden="true" />
            </div>
            {dealGroup.offers.map((offer, index) => {
              const premium = dealGroup.worstPrice - offer.dealPrice;
              return (
                <div
                  key={`${offer.storeName}-${offer.id}`}
                  className={`deals-store-table__row${index === 0 ? " is-best" : ""}`}
                  role="row"
                >
                  <span className="deals-store-table__store" role="cell">
                    <i
                      style={{ background: storeTint(offer.storeName) }}
                      aria-hidden="true"
                    />
                    {offer.storeName}
                    {index === 0 && (
                      <span className="deals-store-table__best">
                        {t("deals.cheapest")}
                      </span>
                    )}
                  </span>
                  <span className="deals-store-table__price" role="cell">
                    {formatPrice(offer.dealPrice, "EUR", t("deals.freePrice"))}
                  </span>
                  <span role="cell">-{offer.discountPercent}%</span>
                  <span role="cell" className="deals-store-table__save">
                    {premium > 0.004 ? `+${formatPrice(premium)}` : "—"}
                  </span>
                  <span role="cell" className="deals-store-table__action">
                    <button
                      type="button"
                      onClick={() => onOpenUrl(offer.storeUrl)}
                      aria-label={t("deals.openOnStore", { store: offer.storeName })}
                      title={t("deals.openOnStore", { store: offer.storeName })}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {(() => {
            const { savings, originalPrice } = calculateSavings(
              dealGroup.bestPrice,
              dealGroup.best.discountPercent,
            );
            if (savings <= 0) return null;
            return (
              <p className="deals-modal__note">
                {t("deals.wasPrice", {
                  price: formatPrice(originalPrice),
                  amount: formatPrice(savings),
                })}
              </p>
            );
          })()}
        </DealModalSection>
      )}

      {target.type === "gamepass" && (
        <>
          {target.data.description && (
            <DealModalSection title={t("deals.aboutTitle")}>
              <p className="deals-modal__text">{target.data.description}</p>
            </DealModalSection>
          )}

          {target.data.categories.length > 0 && (
            <DealModalSection title={t("deals.genresTitle")}>
              <div className="deals-modal__tags">
                {target.data.categories.map((category) => (
                  <span key={category} className="deals-modal__tag">
                    <Tag size={11} aria-hidden="true" />
                    {category}
                  </span>
                ))}
              </div>
            </DealModalSection>
          )}

          {target.data.publisher && (
            <DealModalSection title={t("deals.publisher")}>
              <p className="deals-modal__text">{target.data.publisher}</p>
            </DealModalSection>
          )}
        </>
      )}

      {target.type === "giveaway" && (
        <>
          <DealModalSection title={t("deals.freeGames")}>
            <p className="deals-modal__text">
              {target.data.bundleTitle || target.data.title}
            </p>
            {countdown && (
              <p className={`deals-modal__countdown${countdown.isUrgent ? " is-urgent" : ""}`}>
                <Clock3 size={14} aria-hidden="true" />
                {countdown.label}
                {formatExpiry(target.data.expiry)
                  ? ` · ${t("deals.ends", { date: formatExpiry(target.data.expiry) as string })}`
                  : ""}
              </p>
            )}
          </DealModalSection>

          <DealModalSection title={t("deals.store")}>
            <p className="deals-modal__text">
              <span className="deals-modal__tag">
                <i style={{ background: tint }} aria-hidden="true" />
                {target.data.storeName}
              </span>
            </p>
          </DealModalSection>
        </>
      )}

      <DealModalSection title={t("deals.lookupLinks")}>
        <div className="deals-modal__links">
          <button
            type="button"
            className="deals-modal__link"
            onClick={() =>
              openLookup(
                `https://www.pcgamingwiki.com/w/index.php?search=${searchQuery}`,
              )
            }
          >
            <Search size={13} aria-hidden="true" />
            PCGamingWiki
          </button>
          <button
            type="button"
            className="deals-modal__link"
            onClick={() => openLookup(`https://steamdb.info/search/?a=app&q=${searchQuery}`)}
          >
            <Search size={13} aria-hidden="true" />
            SteamDB
          </button>
          {target.type === "gamepass" && (
            <button
              type="button"
              className="deals-modal__link"
              onClick={() => openLookup(`https://www.xbox.com/en-US/search?q=${searchQuery}`)}
            >
              <Gamepad2 size={13} aria-hidden="true" />
              Xbox
            </button>
          )}
          {target.type === "giveaway" && (
            <button
              type="button"
              className="deals-modal__link"
              onClick={() => onOpenUrl(target.data.dealUrl)}
            >
              <Gift size={13} aria-hidden="true" />
              {t("deals.claimFree")}
            </button>
          )}
        </div>
      </DealModalSection>
    </DealModalShell>
  );
}

