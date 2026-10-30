import { useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { nudgeStoreInstallScan, useStoreInstallFor } from "../../hooks/useStoreInstalls";
import { formatBytesPerSecond } from "../../types/download";
import { STORE_QUEUE_URLS, type StoreInstall } from "../../types/storeInstalls";
import type { Game } from "../../types/game";
import { IconDownload } from "../game/icons";
import {
  formatEtaLabel,
  storeInstallDetail,
  storeInstallHeadline,
  storeInstallPercent,
  storeInstallSourceName,
} from "./storeInstallText";
import "../../styles/store-installs.css";

interface StoreInstallActionProps {
  game: Game;
}

/**
 * The hero's store-install control, in one of two states:
 *
 * - a store is working on this game (a first install or an update) → a live
 *   progress button that opens the store's own downloads page, the only
 *   place the transfer can actually be paused or cancelled;
 * - nothing is running → the plain hand-off button, for Steam titles the
 *   library knows about but the disk doesn't.
 *
 * Epic has no hand-off here: its install URI needs the app's artifact name,
 * which the library doesn't persist yet. Epic transfers still show up as
 * progress when the store client starts them.
 */
export default function StoreInstallAction({ game }: StoreInstallActionProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const entry = useStoreInstallFor(game.id);

  const formatSpeed = useCallback(
    (bytesPerSecond: number) => formatBytesPerSecond(bytesPerSecond, unit, language),
    [unit, language],
  );
  const formatEtaSeconds = useCallback((seconds: number) => formatEtaLabel(seconds, t), [t]);

  const openStoreQueue = useCallback(
    (transfer: StoreInstall) => {
      const url = STORE_QUEUE_URLS[transfer.source];
      if (!url) return;
      openUrl(url).catch((err) =>
        showToast(
          t("storeInstall.openQueueFailed", {
            store: storeInstallSourceName(transfer),
            err: String(err),
          }),
          "error",
        ),
      );
    },
    [showToast, t],
  );

  const handleInstall = useCallback(() => {
    if (!game.steamAppId) return;
    openUrl(`steam://install/${game.steamAppId}`)
      .then(() => nudgeStoreInstallScan())
      .catch((err) => showToast(t("launch.installFailedToast", { err: String(err) }), "error"));
  }, [game.steamAppId, showToast, t]);

  if (entry) {
    const percent = storeInstallPercent(entry);
    const detail = storeInstallDetail(entry, formatSpeed, formatEtaSeconds);
    const headline = storeInstallHeadline(entry, t, game.installed);
    return (
      <button
        type="button"
        className="game-launch-btn game-launch-btn--install game-launch-btn--transfer"
        onClick={() => openStoreQueue(entry)}
        title={t("storeInstall.openQueue", { store: storeInstallSourceName(entry) })}
        aria-label={`${headline} — ${t("storeInstall.openQueue", {
          store: storeInstallSourceName(entry),
        })}`}
      >
        {percent != null && (
          <span
            className="game-launch-transfer-fill"
            style={{ width: `${percent}%` }}
            aria-hidden="true"
          />
        )}
        <IconDownload size={16} />
        <span className="game-launch-transfer-label">
          {headline}
          {detail ? ` · ${detail}` : ""}
        </span>
      </button>
    );
  }

  if (game.installed || game.platform !== "Steam" || !game.steamAppId) return null;

  return (
    <button
      type="button"
      className="game-launch-btn game-launch-btn--install"
      onClick={handleInstall}
    >
      <IconDownload size={16} />
      {t("game.installViaSteam")}
    </button>
  );
}
