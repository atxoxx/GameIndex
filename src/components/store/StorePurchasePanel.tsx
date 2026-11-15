import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { usePrice } from "../../context/PriceContext";
import { useSteamGameStats, formatSteamPrice } from "../../hooks/useSteamGameStats";
import DownloadButton from "../DownloadButton";
import { IconExternalLink, IconTag } from "../game/icons";
import StoreWishlistButton from "./StoreWishlistButton";

/**
 * CheapShark's store ids are stable; the handful below cover the stores most
 * offers come from. An unknown id simply keeps the generic "Best price" label
 * instead of inventing a store name.
 */
const STORE_NAMES: Record<string, string> = {
  "1": "Steam",
  "2": "GamersGate",
  "3": "Green Man Gaming",
  "7": "GOG",
  "8": "Origin",
  "11": "Humble Store",
  "13": "Ubisoft Store",
  "15": "Fanatical",
  "21": "WinGameStore",
  "23": "GameBillet",
  "24": "Voidu",
  "25": "Epic Games Store",
  "30": "IndieGala",
  "31": "Blizzard",
};

/** CheapShark quotes USD; the store cards format it the same way. */
function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

interface StorePurchasePanelProps {
  title: string;
  steamAppId?: number;
  releaseDate?: string | null;
  releaseStatus?: string | null;
  isInLibrary: boolean;
  libraryGameId?: string;
  wishlisted: boolean;
  onToggleWishlist: () => void;
  onAdd: () => void;
  adding: boolean;
  onOpenLibrary: () => void;
  coverUrl?: string | null;
}

/**
 * StorePurchasePanel
 * ──────────────────
 * The product page's dedicated purchase column: the one place on the store
 * detail page that owns price, discount, offer link and every transactional
 * action. It only ever renders data the price/Steam lookups actually returned —
 * when nothing comes back it says so instead of fabricating a price.
 */
export default function StorePurchasePanel({
  title,
  steamAppId,
  releaseDate,
  releaseStatus,
  isInLibrary,
  libraryGameId,
  wishlisted,
  onToggleWishlist,
  onAdd,
  adding,
  onOpenLibrary,
  coverUrl,
}: StorePurchasePanelProps) {
  const { t } = useLanguage();
  const price = usePrice(title);
  const { data: steamStats } = useSteamGameStats(steamAppId);
  const steamDetails = steamStats?.details ?? null;

  // `usePrice` returns null both before the batched lookup resolves and when
  // there is genuinely no offer. Hold the empty state back briefly so a slow
  // lookup doesn't flash "no price" on every visit.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (price) {
      setSettled(true);
      return;
    }
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), 1200);
    return () => clearTimeout(timer);
  }, [title, price]);

  const steamPrice = steamDetails
    ? formatSteamPrice(steamDetails.priceCents, steamDetails.currency, steamDetails.isFree)
    : null;
  const hasSteamPrice =
    steamPrice != null && steamPrice !== "-" && steamPrice !== "—";

  const discount = price?.isOnSale ? price.discountPercent : 0;
  const currentPrice =
    price?.salePrice != null
      ? formatUsd(price.salePrice)
      : price?.normalPrice != null
        ? formatUsd(price.normalPrice)
        : null;
  const normalPrice =
    discount > 0 && price?.normalPrice != null ? formatUsd(price.normalPrice) : null;
  const storeName = price?.storeId ? STORE_NAMES[price.storeId] ?? null : null;

  const offerUrl = useMemo(() => {
    if (price?.dealUrl) return price.dealUrl;
    if (steamAppId && hasSteamPrice) {
      return `https://store.steampowered.com/app/${steamAppId}`;
    }
    return null;
  }, [price?.dealUrl, steamAppId, hasSteamPrice]);

  const openOffer = () => {
    if (!offerUrl) return;
    void openUrl(offerUrl).catch(() => window.open(offerUrl, "_blank"));
  };

  const parsedRelease = releaseDate ? new Date(releaseDate) : null;
  const releaseLabel =
    parsedRelease && !Number.isNaN(parsedRelease.getTime())
      ? parsedRelease.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : releaseStatus?.trim() || releaseDate?.trim() || null;

  return (
    <section
      className="store-purchase-panel"
      aria-labelledby="store-purchase-title"
    >
      <header className="store-purchase-panel__head">
        <span className="store-purchase-panel__eyebrow" id="store-purchase-title">
          <IconTag size={13} />
          {t("store.purchase.title")}
        </span>
        {releaseLabel && (
          <span className="store-purchase-panel__release">{releaseLabel}</span>
        )}
      </header>

      <div className="store-purchase-panel__price" aria-live="polite">
        {currentPrice ? (
          <>
            <span className="store-purchase-panel__amount">{currentPrice}</span>
            {discount > 0 && (
              <span className="store-purchase-panel__discount">-{discount}%</span>
            )}
          </>
        ) : hasSteamPrice ? (
          <span className="store-purchase-panel__amount">{steamPrice}</span>
        ) : null}

        {normalPrice && (
          <span className="store-purchase-panel__was">
            {t("store.purchase.was", { price: normalPrice })}
          </span>
        )}
      </div>

      {(storeName || hasSteamPrice || currentPrice) && (
        <span className="store-purchase-panel__store">
          {storeName
            ? `${storeName} · ${t("store.purchase.bestPrice")}`
            : hasSteamPrice
              ? "Steam"
              : t("store.purchase.bestPrice")}
        </span>
      )}

      {settled && !currentPrice && !hasSteamPrice && (
        <div className="store-purchase-panel__empty">
          <span className="store-purchase-panel__empty-title">
            {t("store.purchase.noPrice")}
          </span>
          <span className="store-purchase-panel__empty-hint">
            {t("store.purchase.noPriceHint")}
          </span>
        </div>
      )}

      <div className="store-purchase-panel__actions">
        {isInLibrary ? (
          <button
            type="button"
            className="store-purchase-panel__primary"
            onClick={onOpenLibrary}
            disabled={!libraryGameId}
          >
            {t("store.viewInLibrary")}
          </button>
        ) : (
          <button
            type="button"
            className="store-purchase-panel__primary"
            onClick={onAdd}
            disabled={adding}
          >
            {adding ? t("store.adding") : t("store.addToLibrary")}
          </button>
        )}

        <div className="store-purchase-panel__secondary">
          <StoreWishlistButton
            gameName={title}
            wishlisted={wishlisted}
            onToggle={onToggleWishlist}
          />
          <DownloadButton
            gameName={title}
            gamePoster={coverUrl ?? undefined}
            steamAppId={steamAppId}
            label={t("game.findDownload")}
          />
        </div>

        {offerUrl && (
          <button
            type="button"
            className="store-purchase-panel__offer"
            onClick={openOffer}
          >
            <IconExternalLink size={13} />
            {t("store.purchase.viewOffer")}
          </button>
        )}
      </div>

      {isInLibrary && (
        <span className="store-purchase-panel__owned">
          {t("store.inLibrary")}
        </span>
      )}
    </section>
  );
}
