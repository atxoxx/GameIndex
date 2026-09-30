import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import type { SteamGameDlcsResult } from "../../types/steam";
import { useLanguage } from "../../context/LanguageContext";
import { steamCodeForUi } from "../../i18n/languages";
import { IconDlc, IconFamily } from "./icons";
import { Button } from "../ui";

interface GameDlcCardProps {
  game?: Game | null;
  storeAppId?: number | null;
  gameName?: string;
  onViewAllDlcs?: () => void;
}

export default function GameDlcCard({
  game,
  storeAppId,
  gameName: _gameName,
  onViewAllDlcs,
}: GameDlcCardProps) {
  const { t, language } = useLanguage();
  const appId = game?.steamAppId ?? storeAppId ?? null;
  const [data, setData] = useState<SteamGameDlcsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const activeAppIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!appId) {
      setData(null);
      setLoading(false);
      return;
    }

    const lang = steamCodeForUi(language);
    activeAppIdRef.current = appId;
    setLoading(true);

    invoke<SteamGameDlcsResult>("steam_get_game_dlcs", { appId, lang })
      .then((res) => {
        if (activeAppIdRef.current === appId) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn("[GameDlcCard] Failed to fetch game DLCs:", err);
        if (activeAppIdRef.current === appId) {
          setData(null);
          setLoading(false);
        }
      });
  }, [appId, language]);

  if (!appId) {
    return null;
  }

  if (loading && !data) {
    return (
      <section className="game-section game-dlc-card skeleton-card">
        <div className="game-dlc-card__header">
          <div className="game-dlc-card__title-row">
            <span className="game-dlc-card__title-icon" aria-hidden>
              <IconDlc size={18} />
            </span>
            <span>{t("dlc.cardTitle")}</span>
          </div>
        </div>
        <div className="game-dlc-preview-list">
          <div className="game-dlc-preview-item" style={{ height: 40, opacity: 0.5 }} />
          <div className="game-dlc-preview-item" style={{ height: 40, opacity: 0.3 }} />
        </div>
      </section>
    );
  }

  // If there are no DLCs and no family share info, hide the card
  if (!data || (data.totalDlcs === 0 && !data.familyShare?.isShared)) {
    return null;
  }

  const previewDlcs = (data.dlcs || []).slice(0, 4);

  return (
    <section className="game-section game-dlc-card" aria-label={t("dlc.cardTitle")}>
      <div className="game-dlc-card__header">
        <div className="game-dlc-card__title-row">
          <span className="game-dlc-card__title-icon" aria-hidden>
            <IconDlc size={18} />
          </span>
          <span>{t("dlc.cardTitle")}</span>
        </div>
        {data.totalDlcs > 0 && (
          <span className="game-dlc-card__badge">
            {t("dlc.ownedCountBadge", {
              owned: data.ownedCount,
              total: data.totalDlcs,
            })}
          </span>
        )}
      </div>

      {/* Family Sharing Banner */}
      {data.familyShare?.isShared && (
        <div className="family-share-banner family-share-banner--compact">
          <div className="family-share-banner__avatar-wrap">
            {data.familyShare.ownerAvatarUrl ? (
              <img
                src={data.familyShare.ownerAvatarUrl}
                alt={data.familyShare.ownerName || "Owner"}
                className="family-share-banner__avatar"
              />
            ) : (
              <div className="family-share-banner__avatar" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#4f46e5" }}>
                <IconFamily size={16} />
              </div>
            )}
            <span className="family-share-banner__badge-icon">
              <IconFamily size={10} />
            </span>
          </div>
          <div className="family-share-banner__content">
            <span className="family-share-banner__title">
              {t("dlc.familySharing")}
            </span>
            <span className="family-share-banner__desc">
              {t("dlc.sharedBy", {
                owner: data.familyShare.ownerName || t("dlc.familyMember"),
                group: data.familyShare.familyGroupName || t("dlc.steamFamily"),
              })}
            </span>
          </div>
        </div>
      )}

      {/* DLC Preview mini-list */}
      {previewDlcs.length > 0 && (
        <div className="game-dlc-preview-list">
          {previewDlcs.map((dlc) => (
            <div key={dlc.appId} className="game-dlc-preview-item">
              {dlc.headerImage ? (
                <img
                  src={dlc.headerImage}
                  alt={dlc.name}
                  className="game-dlc-preview-thumb"
                  loading="lazy"
                />
              ) : (
                <div className="game-dlc-preview-thumb" />
              )}
              <span className="game-dlc-preview-title" title={dlc.name}>
                {dlc.name}
              </span>
              <span
                className={`game-dlc-preview-status ${
                  dlc.isOwned
                    ? "game-dlc-preview-status--owned"
                    : "game-dlc-preview-status--price"
                }`}
              >
                {dlc.isOwned
                  ? t("dlc.owned")
                  : dlc.isFree
                  ? t("dlc.free")
                  : dlc.priceFormatted || t("dlc.available")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footer to switch to DLC subtab */}
      {data.totalDlcs > 0 && onViewAllDlcs && (
        <div className="game-dlc-card__footer">
          <Button variant="ghost" size="sm" onClick={onViewAllDlcs}>
            {t("dlc.viewAll", { count: data.totalDlcs })} →
          </Button>
        </div>
      )}
    </section>
  );
}
