import { useState } from "react";
import { Copy, ExternalLink, Eye, Heart } from "lucide-react";
import type { PlaytesterGame } from "../../types/deals";
import type { ViewDensity } from "../../types/game";
import { formatExpiry, titleToSlug } from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlistContext } from "../../context/WishlistContext";
import { useOwnedTitles } from "../../hooks/useOwnedTitles";
import { useToast } from "../../context/ToastContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import { copyTextToClipboard } from "../../utils/clipboard";
import DealsCard from "./DealsCard";
import { playtesterSummary } from "./dealsSummaries";

interface PlaytesterCardProps {
  game: PlaytesterGame;
  density: ViewDensity;
  index: number;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect?: (game: PlaytesterGame) => void;
}

/** A demo / beta / playtest listing. Availability is the headline status. */
export default function PlaytesterCard({
  game,
  density,
  index,
  onOpenUrl,
  onInspect,
}: PlaytesterCardProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlistContext();
  const isOwned = useOwnedTitles();
  const { showToast } = useToast();
  const menu = useContextMenu();
  const [copied, setCopied] = useState(false);

  const wishlisted = isWishlisted(titleToSlug(game.title));
  const owned = isOwned(game.title);
  const active = game.status.toLowerCase() === "active";
  const added = formatExpiry(game.dateAdded);
  const toggleWishlist = () => toggle(playtesterSummary(game));

  const copyLink = async () => {
    const ok = await copyTextToClipboard(game.url);
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
    {
      id: "open",
      label: t("deals.viewOnPlaytester"),
      icon: <ExternalLink size={15} />,
      onSelect: () => onOpenUrl(game.url),
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
      kind="playtester"
      title={game.title}
      subtitle={game.kind || game.platform}
      image={game.thumbnail}
      fallbackLabel={game.kind || t("deals.playtester")}
      tint="var(--color-accent)"
      priceNote={added ? t("deals.addedOn", { date: added }) : null}
      status={{ label: game.status || t("deals.status"), tone: active ? "success" : "muted" }}
      meta={
        <>
          {game.platform && (
            <span className="deals-tile__meta-item">{game.platform}</span>
          )}
          {game.genres.slice(0, 2).map((genre) => (
            <span key={genre} className="deals-tile__meta-item">
              {genre}
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
          label: t("deals.viewOnPlaytester"),
          onClick: () => onOpenUrl(game.url),
        },
      }}
      onOpen={() =>
        onInspect ? onInspect(game) : onOpenUrl(game.url)
      }
      onContextMenu={(event) => menu.open(event)}
      ariaLabel={t("deals.openPlaytesterLabel", { game: game.title })}
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
                <span className="ctx-badge">{game.status}</span>
              </>
            }
          />
        )
      }
    />
  );
}
