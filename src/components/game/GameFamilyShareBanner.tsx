import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import type { SteamFamilyShareInfo } from "../../types/steam";
import { useLanguage } from "../../context/LanguageContext";
import { IconFamily } from "./icons";

interface GameFamilyShareBannerProps {
  game: Game;
}

/**
 * Top-of-page banner for a Steam title the user only has through Family
 * Sharing. `game.familySharedBy` carries the owner's SteamID64, not their
 * name, so the display name and avatar are resolved lazily with
 * `steam_get_family_share_info` (the same command the DLC card uses) and
 * degrade to a generic "Family Member" label when the lookup fails.
 */
export default function GameFamilyShareBanner({ game }: GameFamilyShareBannerProps) {
  const { t } = useLanguage();
  const appId = game.steamAppId ?? null;
  const isShared = Boolean(game.familySharedBy);
  const [info, setInfo] = useState<SteamFamilyShareInfo | null>(null);
  const activeAppIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isShared || !appId) {
      setInfo(null);
      return;
    }

    activeAppIdRef.current = appId;
    invoke<SteamFamilyShareInfo>("steam_get_family_share_info", { appId })
      .then((res) => {
        if (activeAppIdRef.current === appId) setInfo(res);
      })
      .catch((err) => {
        console.warn("[GameFamilyShareBanner] Failed to resolve family share info:", err);
        if (activeAppIdRef.current === appId) setInfo(null);
      });
  }, [appId, isShared]);

  if (!isShared) {
    return null;
  }

  const owner = info?.ownerName || t("dlc.familyMember");
  const group = info?.familyGroupName || t("dlc.steamFamily");

  return (
    <div className="game-family-banner">
      <div className="family-share-banner" role="status">
        <div className="family-share-banner__avatar-wrap">
          {info?.ownerAvatarUrl ? (
            <img
              src={info.ownerAvatarUrl}
              alt={owner}
              className="family-share-banner__avatar"
            />
          ) : (
            <div
              className="family-share-banner__avatar"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#4f46e5" }}
            >
              <IconFamily size={16} />
            </div>
          )}
          <span className="family-share-banner__badge-icon">
            <IconFamily size={10} />
          </span>
        </div>
        <div className="family-share-banner__content">
          <span className="family-share-banner__title">{t("dlc.familySharing")}</span>
          <span className="family-share-banner__desc">
            {t("dlc.sharedBy", { owner, group })}
          </span>
        </div>
      </div>
    </div>
  );
}
