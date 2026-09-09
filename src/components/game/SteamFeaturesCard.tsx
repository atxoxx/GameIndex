import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SteamStoreFeaturesPayload, SteamFeatureItem } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { IconSteam, IconGamepad, IconShield, IconFileText } from "./icons";

interface SteamFeaturesCardProps {
  steamAppId?: number | null;
  gameName?: string;
}

export default function SteamFeaturesCard({
  steamAppId,
  gameName,
}: SteamFeaturesCardProps) {
  const { t, language } = useLanguage();
  const [payload, setPayload] = useState<SteamStoreFeaturesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const activeFetchId = useRef<string>("");

  useEffect(() => {
    if (!steamAppId) {
      setPayload(null);
      setLoading(false);
      return;
    }

    const fetchKey = `${steamAppId}_${language}`;
    activeFetchId.current = fetchKey;
    setLoading(true);

    invoke<SteamStoreFeaturesPayload | null>("get_steam_page_features", {
      steamAppId,
      lang: language,
    })
      .then((res) => {
        if (activeFetchId.current === fetchKey) {
          setPayload(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn("[SteamFeaturesCard] Failed to fetch features:", err);
        if (activeFetchId.current === fetchKey) {
          setPayload(null);
          setLoading(false);
        }
      });
  }, [steamAppId, language]);

  const handleItemClick = useCallback((url?: string) => {
    if (!url) return;
    openUrl(url).catch((err) => {
      console.warn("[SteamFeaturesCard] Failed to open search URL:", err);
    });
  }, []);

  if (loading && !payload) {
    return (
      <section className="game-section steam-features-card skeleton-card">
        <h2 className="game-section-title">
          <span className="game-section-title__icon" aria-hidden>
            <IconSteam size={16} />
          </span>
          {t("game.steamFeaturesTitle")}
        </h2>
        <div className="steam-features-skeleton">
          <div className="steam-feature-skeleton-row" />
          <div className="steam-feature-skeleton-row" />
          <div className="steam-feature-skeleton-row" />
          <div className="steam-feature-skeleton-row" />
        </div>
      </section>
    );
  }

  if (!payload) return null;

  const hasFeatures = payload.features && payload.features.length > 0;
  const hasController = !!payload.controllerSupport && (payload.controllerSupport.fullSupport || payload.controllerSupport.partialSupport);
  const hasNotices = payload.notices && payload.notices.length > 0;

  if (!hasFeatures && !hasController && !hasNotices) {
    return null;
  }

  return (
    <section
      className="game-section steam-features-card"
      aria-label={gameName ? `${gameName} - ${t("game.steamFeaturesTitle")}` : t("game.steamFeaturesTitle")}
    >
      <h2 className="game-section-title">
        <span className="game-section-title__icon steam-icon-badge" aria-hidden>
          <IconSteam size={16} />
        </span>
        {t("game.steamFeaturesTitle")}
        {hasFeatures && (
          <span className="game-section-title__count">{payload.features.length}</span>
        )}
      </h2>

      {/* Feature Items List */}
      {hasFeatures && (
        <div className="steam-features-list">
          {payload.features.map((item: SteamFeatureItem, idx: number) => {
            const isClickable = Boolean(item.searchUrl);
            const content = (
              <>
                <div className="steam-feature-icon" aria-hidden>
                  {item.iconUrl ? (
                    <img
                      src={item.iconUrl}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        // Fallback icon container on image load failure
                        (e.currentTarget as HTMLElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="steam-feature-icon-placeholder" />
                  )}
                </div>
                <span className="steam-feature-label">{item.name}</span>
              </>
            );

            if (isClickable) {
              return (
                <a
                  key={`${item.id ?? idx}-${item.name}`}
                  href={item.searchUrl}
                  className="steam-feature-item clickable"
                  onClick={(e) => {
                    e.preventDefault();
                    handleItemClick(item.searchUrl);
                  }}
                  title={item.name}
                >
                  {content}
                </a>
              );
            }

            return (
              <div
                key={`${item.id ?? idx}-${item.name}`}
                className="steam-feature-item"
              >
                {content}
              </div>
            );
          })}
        </div>
      )}

      {/* Controller Support Banner */}
      {hasController && payload.controllerSupport && (
        <div className="steam-controller-block">
          <div className="steam-controller-row">
            <span className="steam-controller-icon" aria-hidden>
              <IconGamepad size={15} />
            </span>
            <span className="steam-controller-text">
              {payload.controllerSupport.fullSupport
                ? t("game.steamFullController")
                : t("game.steamPartialController")}
            </span>
          </div>
          <div className="steam-controller-badges">
            {payload.controllerSupport.xbox && (
              <span className="steam-ctrl-badge" title="Xbox Controller Support">
                Xbox
              </span>
            )}
            {(payload.controllerSupport.ps4 || payload.controllerSupport.ps5) && (
              <span className="steam-ctrl-badge" title="PlayStation Controller Support">
                PlayStation
              </span>
            )}
          </div>
        </div>
      )}

      {/* DRM & Anti-Cheat Notices */}
      {hasNotices && (
        <div className="steam-notices-block">
          {payload.notices.map((notice, idx) => (
            <div
              key={idx}
              className={`steam-notice-item${notice.isAnticheat ? " anticheat" : ""}`}
            >
              <span className="steam-notice-icon" aria-hidden>
                {notice.isAnticheat ? <IconShield size={14} /> : <IconFileText size={14} />}
              </span>
              <div className="steam-notice-content">
                <span className="steam-notice-text">{notice.text}</span>
                {notice.linkUrl && (
                  <a
                    href={notice.linkUrl}
                    className="steam-notice-link"
                    onClick={(e) => {
                      e.preventDefault();
                      handleItemClick(notice.linkUrl);
                    }}
                  >
                    {notice.linkText || notice.linkUrl}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
