import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gamepad2 } from "lucide-react";
import type { ViewDensity } from "../../types/game";
import type { ItchGameSummary } from "../../types/itch";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { copyTextToClipboard } from "../../utils/clipboard";
import { formatItchPrice } from "../../pages/deals/itchConstants";
import { storeTint } from "../../pages/deals/dealsConstants";
import DealsCard from "./DealsCard";

/** itch's brand accent, taken from the shared store tint table. */
const ITCH_TINT = storeTint("itch.io");

interface ItchCardProps {
  game: ItchGameSummary;
  density: ViewDensity;
  index: number;
  onOpenUrl: (url: string | null | undefined) => void;
}

/**
 * One itch.io browse card. Opens the in-app game page; the external icon keeps
 * the store page one click away for purchases and comments.
 */
export default function ItchCard({
  game,
  density,
  index,
  onOpenUrl,
}: ItchCardProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const detailPath = useMemo(() => {
    const [author, name] = game.slug.split("/");
    if (author && name) return `/itch/${author}/${name}`;
    return `/itch/${encodeURIComponent(game.id)}`;
  }, [game.slug, game.id]);

  const copyLink = async () => {
    const ok = await copyTextToClipboard(game.url);
    showToast(
      ok ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      ok ? "success" : "error",
    );
  };

  const price = formatItchPrice(game.price, t("deals.freePrice"));
  const originalPrice =
    game.originalPrice !== null &&
    game.originalPrice > (game.price ?? 0) &&
    game.discountPercent > 0
      ? formatItchPrice(game.originalPrice, t("deals.freePrice"))
      : null;

  return (
    <DealsCard
      kind="itch"
      title={game.title}
      subtitle={game.author || null}
      image={game.coverUrl}
      fallbackLabel="itch.io"
      tint={ITCH_TINT}
      discount={game.discountPercent}
      price={price}
      originalPrice={originalPrice}
      priceNote={game.genre}
      meta={
        <>
          {game.playableInBrowser && (
            <span className="deals-tile__meta-item">
              <Gamepad2 size={12} aria-hidden="true" />
              {t("itch.playableInApp")}
            </span>
          )}
          {game.platforms.length > 0 && (
            <span className="deals-tile__meta-item">
              {game.platforms.join(" · ")}
            </span>
          )}
        </>
      }
      topBadges={
        game.playableInBrowser ? (
          <span className="deals-tile__badge deals-tile__badge--owned">
            <Gamepad2 size={10} aria-hidden="true" />
            {t("itch.playInApp")}
          </span>
        ) : null
      }
      actions={{
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
          label: t("itch.openOnItch"),
          onClick: () => onOpenUrl(game.url),
        },
      }}
      onOpen={() => navigate(detailPath)}
      ariaLabel={t("itch.openGame", { game: game.title })}
      index={index}
      density={density}
    />
  );
}
