import { useLanguage } from "../../context/LanguageContext";

interface StoreWishlistButtonProps {
  /** Game title used for the accessible label and toast copy. */
  gameName: string;
  wishlisted: boolean;
  onToggle: () => void;
  /** Compact icon-only variant for dense action clusters. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * StoreWishlistButton
 * ───────────────────
 * The wishlist toggle shared by the store detail hero, the purchase panel and
 * the docked action bar (which draws its own compact variant). One component
 * keeps the `aria-pressed` state and the label flip in a single place while the
 * surrounding layout decides the size.
 */
export default function StoreWishlistButton({
  gameName,
  wishlisted,
  onToggle,
  iconOnly = false,
  className,
}: StoreWishlistButtonProps) {
  const { t } = useLanguage();

  return (
    <button
      type="button"
      className={[
        "store-wishlist-btn",
        wishlisted ? "active" : "",
        iconOnly ? "store-wishlist-btn--icon" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
      aria-pressed={wishlisted}
      aria-label={
        wishlisted
          ? t("store.gameCard.removeWishlistAria", { name: gameName })
          : t("store.gameCard.addWishlistAria", { name: gameName })
      }
      title={
        wishlisted
          ? t("store.gameCard.removeWishlistAria", { name: gameName })
          : t("store.gameCard.addWishlistAria", { name: gameName })
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill={wishlisted ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {!iconOnly && (
        <span>{wishlisted ? t("store.inWishlist") : t("store.addToWishlist")}</span>
      )}
    </button>
  );
}
