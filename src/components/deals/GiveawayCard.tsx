import { useMemo, useState } from "react";
import { Clock, Copy, ExternalLink, Eye, Heart } from "lucide-react";
import type { Giveaway } from "../../types/deals";
import type { ViewDensity } from "../../types/game";
import {
  formatCountdown,
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
import { giveawaySummary } from "./dealsSummaries";

interface GiveawayCardProps {
  giveaway: Giveaway;
  density: ViewDensity;
  index: number;
  now: number;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect?: (giveaway: Giveaway) => void;
}

/** A free game with its claim countdown ticking against `now`. */
export default function GiveawayCard({
  giveaway,
  density,
  index,
  now,
  onOpenUrl,
  onInspect,
}: GiveawayCardProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlistContext();
  const isOwned = useOwnedTitles();
  const { showToast } = useToast();
  const menu = useContextMenu();
  const [copied, setCopied] = useState(false);

  const appId = useMemo(
    () => steamAppIdFromUrl(giveaway.dealUrl),
    [giveaway.dealUrl],
  );
  const wishlisted = isWishlisted(giveaway.title);
  const owned = isOwned(giveaway.title);
  const countdown = formatCountdown(giveaway.expiry, t, now);

  const toggleWishlist = () => toggle(giveawaySummary(giveaway));

  const copyLink = async () => {
    const ok = await copyTextToClipboard(giveaway.dealUrl);
    if (!ok) {
      showToast(t("sidebar.copyFailed"), "error");
      return false;
    }
    showToast(t("sidebar.copiedToClipboard"), "success");
    return true;
  };

  const menuItems: ContextMenuItem[] = [
    ...(onInspect
      ? [
          {
            id: "details",
            label: t("game.viewDetails"),
            icon: <Eye size={15} />,
            accent: true,
            onSelect: () => onInspect(giveaway),
          } as ContextMenuItem,
        ]
      : []),
    {
      id: "claim",
      label: t("deals.claimFree"),
      icon: <ExternalLink size={15} />,
      onSelect: () => onOpenUrl(giveaway.dealUrl),
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
  ];

  return (
    <DealsCard
      kind="giveaway"
      title={giveaway.title}
      subtitle={giveaway.bundleTitle || giveaway.storeName}
      image={giveaway.imageUrl}
      fallbackLabel={giveaway.storeName}
      appId={appId}
      tint={storeTint(giveaway.storeName)}
      discount={100}
      price={t("deals.freePrice")}
      meta={
        <>
          <span className="deals-tile__meta-item">
            <i
              className="deals-tile__dot"
              style={{ background: storeTint(giveaway.storeName) }}
              aria-hidden="true"
            />
            {giveaway.storeName}
          </span>
          {countdown && (
            <span
              className={`deals-tile__meta-item deals-tile__meta-item--clock${
                countdown.isUrgent ? " is-urgent" : ""
              }`}
            >
              <Clock size={11} aria-hidden="true" />
              {countdown.label}
            </span>
          )}
        </>
      }
      topBadges={
        <>
          {giveaway.isMature && (
            <span className="deals-tile__badge deals-tile__badge--mature">18+</span>
          )}
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
            const ok = await copyLink();
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          },
        },
        open: {
          label: t("deals.claimFree"),
          onClick: () => onOpenUrl(giveaway.dealUrl),
        },
      }}
      onOpen={() =>
        onInspect ? onInspect(giveaway) : onOpenUrl(giveaway.dealUrl)
      }
      onContextMenu={(event) => menu.open(event)}
      ariaLabel={t("deals.openDealLabel", {
        game: giveaway.title,
        store: giveaway.storeName,
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
            ariaLabel={giveaway.title}
            header={
              <>
                <span className="context-menu-title" title={giveaway.title}>
                  {giveaway.title}
                </span>
                <span className="ctx-badge">{giveaway.storeName}</span>
              </>
            }
          />
        )
      }
    />
  );
}
