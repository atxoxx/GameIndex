import { useMemo, useState } from "react";
import { Copy, ExternalLink, Eye, Heart } from "lucide-react";
import type { ViewDensity } from "../../types/game";
import type { DealGroup } from "../../pages/deals/dealsConstants";
import {
  calculateSavings,
  formatPrice,
  steamAppIdFromUrl,
  storeTint,
} from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlistContext } from "../../context/WishlistContext";
import { useOwnedTitles } from "../../hooks/useOwnedTitles";
import { useToast } from "../../context/ToastContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import { copyTextToClipboard } from "../../utils/clipboard";
import DealsCard from "./DealsCard";
import { dealGroupSummary } from "./dealsSummaries";

interface DealCardProps {
  group: DealGroup;
  density: ViewDensity;
  index: number;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect?: (group: DealGroup) => void;
}

/** One card per game, headed by its cheapest store offer. */
export default function DealCard({
  group,
  density,
  index,
  onOpenUrl,
  onInspect,
}: DealCardProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlistContext();
  const isOwned = useOwnedTitles();
  const { showToast } = useToast();
  const menu = useContextMenu();
  const [copied, setCopied] = useState(false);

  const steamAppId = useMemo(
    () => steamAppIdFromUrl(group.best.storeUrl),
    [group.best.storeUrl],
  );

  const wishlisted = isWishlisted(group.slug);
  const owned = isOwned(group.title);
  const { originalPrice, savings } = calculateSavings(
    group.best.dealPrice,
    group.best.discountPercent,
  );

  const toggleWishlist = () => {
    toggle(dealGroupSummary(group));
  };

  const copyLink = async () => {
    const ok = await copyTextToClipboard(group.best.storeUrl);
    showToast(
      ok ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      ok ? "success" : "error",
    );
  };

  const menuItems: ContextMenuItem[] = [
    ...(onInspect
      ? [
          {
            id: "details",
            label: t("game.viewDetails"),
            icon: <Eye size={15} />,
            accent: true,
            onSelect: () => onInspect(group),
          } as ContextMenuItem,
        ]
      : []),
    {
      id: "open",
      label: t("deals.openDeal"),
      icon: <ExternalLink size={15} />,
      onSelect: () => onOpenUrl(group.best.storeUrl),
    },
    { id: "sep-1", separator: true },
    {
      id: "wishlist",
      label: wishlisted ? t("ctx.removeFromWishlist") : t("ctx.addToWishlist"),
      icon: <Heart size={15} fill={wishlisted ? "currentColor" : "none"} />,
      onSelect: toggleWishlist,
    },
    { id: "sep-2", separator: true },
    {
      id: "copy-link",
      label: t("deals.copyLink"),
      icon: <Copy size={15} />,
      onSelect: copyLink,
    },
    {
      id: "copy-name",
      label: t("gameMenu.copyName"),
      icon: <Copy size={15} />,
      onSelect: async () => {
        const ok = await copyTextToClipboard(group.title);
        showToast(
          ok ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
          ok ? "success" : "error",
        );
      },
    },
  ];

  const storeLabel =
    group.storeCount > 1
      ? `${group.best.storeName} +${group.storeCount - 1}`
      : group.best.storeName;

  return (
    <DealsCard
      kind="deal"
      title={group.title}
      subtitle={storeLabel}
      image={group.best.thumbnail}
      fallbackLabel={group.best.storeName}
      appId={steamAppId}
      tint={storeTint(group.best.storeName)}
      discount={group.maxDiscount}
      price={formatPrice(group.best.dealPrice, "EUR", t("deals.freePrice"))}
      originalPrice={
        savings > 0 ? formatPrice(originalPrice) : null
      }
      priceNote={
        group.storeCount > 1 && group.savings > 0
          ? t("deals.savingsLabel", { amount: formatPrice(group.savings) })
          : group.storeCount > 1
            ? t("deals.storeCount", { count: group.storeCount })
            : null
      }
      meta={
        <>
          <span className="deals-tile__meta-item">
            <i
              className="deals-tile__dot"
              style={{ background: storeTint(group.best.storeName) }}
              aria-hidden="true"
            />
            {group.best.platform}
          </span>
          {group.storeCount > 1 && (
            <span className="deals-tile__meta-item">
              {t("deals.storeCount", { count: group.storeCount })}
            </span>
          )}
        </>
      }
      topBadges={
        <>
          {owned && (
            <span className="deals-tile__badge deals-tile__badge--owned">
              {t("deals.inLibrary")}
            </span>
          )}
          {wishlisted && (
            <span className="deals-tile__badge deals-tile__badge--wishlist">
              <Heart size={10} fill="currentColor" aria-hidden="true" />
              {t("deals.onWishlist")}
            </span>
          )}
        </>
      }
      actions={{
        wishlist: {
          label: wishlisted
            ? t("deals.removeFromWishlist")
            : t("deals.addToWishlist"),
          active: wishlisted,
          onClick: toggleWishlist,
        },
        copy: {
          label: copied ? t("gameInfo.copied") : t("deals.copyLink"),
          done: copied,
          onClick: async () => {
            await copyLink();
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          },
        },
        open: {
          label: t("deals.openDeal"),
          onClick: () => onOpenUrl(group.best.storeUrl),
        },
      }}
      onOpen={() =>
        onInspect ? onInspect(group) : onOpenUrl(group.best.storeUrl)
      }
      onContextMenu={(event) => menu.open(event)}
      ariaLabel={t("deals.openDealLabel", {
        game: group.title,
        store: group.best.storeName,
      })}
      index={index}
      density={density}
      menu={
        menu.state && (
          <ContextMenu
            x={menu.state.x}
            y={menu.state.y}
            items={menuItems}
            onClose={menu.close}
            ariaLabel={group.title}
            header={
              <>
                <span className="context-menu-title" title={group.title}>
                  {group.title}
                </span>
                <span className="ctx-badge">{storeLabel}</span>
              </>
            }
          />
        )
      }
    />
  );
}
