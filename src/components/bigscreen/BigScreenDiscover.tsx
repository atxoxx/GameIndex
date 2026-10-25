// Discover — the hub that replaced three top-level nav slots.
//
// Deals, News and Community are still their own screens; this is the
// landing page that introduces them with a live teaser and makes them
// reachable in one press from the section nav.

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGames } from "../../context/GameContext";
import { useWishlistContext } from "../../context/WishlistContext";
import { useActivity } from "../../context/ActivityContext";
import { DISCOVER_AREAS } from "../../bigscreen/registry";

function DiscoverCard({
  path,
  icon,
  title,
  blurb,
  metricLabel,
  metricValue,
}: {
  path: string;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  metricLabel: string;
  metricValue: string;
}) {
  const navigate = useNavigate();
  const focusProps = useFocusable(() => navigate(path));

  return (
    <button
      {...focusProps}
      type="button"
      className="bs-discover-card"
      data-focus-key={`discover:${path}`}
      onClick={() => navigate(path)}
    >
      <span className="bs-discover-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="bs-discover-card-title">{title}</span>
      <span className="bs-discover-card-blurb">{blurb}</span>
      <span className="bs-discover-card-metric">
        <b>{metricValue}</b>
        {metricLabel}
      </span>
      <span className="bs-discover-card-cta" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}

export default function BigScreenDiscover() {
  const { t } = useLanguage();
  const { games } = useGames();
  const { wishlist } = useWishlistContext();
  const { sessions } = useActivity();

  const metrics = useMemo(
    () => ({
      "/deals": {
        value: String(wishlist.length),
        label: t("bigscreen.discover.wishlistCount"),
      },
      "/news": {
        value: t("bigscreen.discover.latest"),
        label: t("bigscreen.discover.newsCount"),
      },
      "/community": {
        value: String(sessions.length),
        label: t("bigscreen.discover.sessionsCount"),
      },
    }),
    [wishlist.length, sessions.length, t],
  );

  return (
    <div className="bs-discover">
      <div className="bs-discover-scroll">
        <header className="bs-discover-head">
          <span className="bs-discover-eyebrow">
            {games.length} {t("bigscreen.discover.libraryCount")}
          </span>
          <h1 className="bs-discover-title">{t("bigscreen.discover.title")}</h1>
          <p className="bs-discover-subtitle">{t("bigscreen.discover.subtitle")}</p>
        </header>

        <div className="bs-discover-grid">
          {DISCOVER_AREAS.map((area) => {
            const metric = metrics[area.path as keyof typeof metrics];
            return (
              <DiscoverCard
                key={area.path}
                path={area.path}
                icon={area.icon}
                title={t(area.labelKey)}
                blurb={t(area.blurbKey)}
                metricLabel={metric?.label ?? ""}
                metricValue={metric?.value ?? ""}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
