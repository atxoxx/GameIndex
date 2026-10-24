import { useState } from "react";
import { Copy, ExternalLink, Eye, Heart } from "lucide-react";
import type { GamePassGame } from "../../types/deals";
import type { ViewDensity } from "../../types/game";
import { storeTint, titleToSlug } from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlistContext } from "../../context/WishlistContext";
import { useOwnedTitles } from "../../hooks/useOwnedTitles";
import { useToast } from "../../context/ToastContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import { copyTextToClipboard } from "../../utils/clipboard";
import DealsCard from "./DealsCard";
import { gamePassSummary } from "./dealsSummaries";

interface GamePassCardProps {
  game: GamePassGame;
  density: ViewDensity;
  index: number;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect?: (game: GamePassGame) => void;
}

/** A Game Pass catalogue title: no price, but developer, platforms and genre. */
export default function GamePassCard({
  game,
  density,
  index,
  onOpenUrl,
  onInspect,
}: GamePassCardProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlistContext();
  const isOwned = useOwnedTitles();
  const { showToast } = useToast();
  const menu = useContextMenu();
  const [copied, setCopied] = useState(false);

  const wishlisted = isWishlisted(titleToSlug(game.title));
  const owned = isOwned(game.title);
  const toggleWishlist = () => toggle(gamePassSummary(game));

  const copyLink = async () => {
    if (!game.deeplink) return false;
    const ok = await copyTextToClipboard(game.deeplink);
    showToast(
      ok ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      ok ? "success" : "error",
    );
    return ok;
  };

  const menuItems: ContextMenuItem[] = [
    ...(onInspect
      ? [
          {
            id: "details",
            label: t("game.viewDetails"),
            icon: <Eye size={15} />,
            accent: true,
            onSelect: () => onInspect(game),
          } as ContextMenuItem,
        ]
      : []),
    ...(game.deeplink
      ? [
          {
            id: "open",
            label: t("deals.viewOnXbox"),
            icon: <ExternalLink size={15} />,
            onSelect: () => onOpenUrl(game.deeplink),
          } as ContextMenuItem,
        ]
      : []),
    { id: "sep-1", separator: true },
    {
      id: "wishlist",
      label: wishlisted ? t("ctx.removeFromWishlist") : t("ctx.addToWishlist"),
      icon: <Heart size={15} fill={wishlisted ? "currentColor" : "none"} />,
      onSelect: toggleWishlist,
    },
    ...(game.deeplink
      ? [
          { id: "sep-2", separator: true } as ContextMenuItem,
          {
            id: "copy-link",
            label: t("deals.copyLink"),
            icon: <Copy size={15} />,
            onSelect: copyLink,
          } as ContextMenuItem,
        ]
      : []),
  ];

  return (
    <DealsCard
      kind="gamepass"
      title={game.title}
      subtitle={game.developer ?? "Xbox Game Pass"}
      image={game.coverImage}
      fallbackLabel={t("deals.gamepass")}
      tint={storeTint("Xbox / Microsoft")}
      price={t("deals.gamepassShort")}
      priceNote={game.releaseDate ? game.releaseDate.slice(0, 4) : null}
      meta={
        <>
          {game.platforms.slice(0, 2).map((platform) => (
            <span key={platform} className="deals-tile__meta-item">
              {platform}
            </span>
          ))}
          {game.categories.slice(0, 2).map((category) => (
            <span key={category} className="deals-tile__meta-item">
              {category}
            </span>
          ))}
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
        ...(game.deeplink
          ? {
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
                label: t("deals.viewOnXbox"),
                onClick: () => onOpenUrl(game.deeplink),
              },
            }
          : {}),
      }}
      onOpen={() =>
        onInspect ? onInspect(game) : onOpenUrl(game.deeplink)
      }
      onContextMenu={(event) => menu.open(event)}
      ariaLabel={t("deals.openDealLabel", {
        game: game.title,
        store: "Xbox Game Pass",
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
            ariaLabel={game.title}
            header={
              <>
                <span className="context-menu-title" title={game.title}>
                  {game.title}
                </span>
                <span className="ctx-badge">Xbox</span>
              </>
            }
          />
        )
      }
    />
  );
}
