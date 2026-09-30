import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { emit } from "@tauri-apps/api/event";
import { useGames } from "../context/GameContext";
import { usePresence } from "../context/PresenceContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { useDownloads } from "../context/DownloadContext";
import { useWishlistContext } from "../context/WishlistContext";
import {
  browsingHint,
  buildDownloadPresence,
  primaryDownload,
  PRESENCE_DOWNLOAD_KINDS,
  type PresencePayload,
} from "./discordPresenceBuild";

/**
 * useDiscordPresence
 * ──────────────────
 * Single emitter for the Discord Rich Presence "idle" states. Watches the
 * route, page-local hints and the download queue, then emits a
 * `discord-presence-update` event with `state: "downloading"` (active
 * transfers take priority) or `state: "browsing"` so the backend presence
 * thread reflects what the user is doing.
 *
 * While any game is running (`runningGameIds.length > 0`) this hook stays
 * silent — GameContext owns the presence thread during a play session.
 */
export function useDiscordPresence() {
  const { pathname } = useLocation();
  const { games, runningGameIds } = useGames();
  const { storePlatforms, modsGameName } = usePresence();
  const { t } = useLanguage();
  const {
    discordShowBrowsing,
    discordShowDownloads,
    discordShowArt,
    discordShowPlaytime,
    discordStatusDisplay,
  } = useSettings();
  const { activeDownloads } = useDownloads();
  const { count: wishlistCount } = useWishlistContext();

  // Payload signature of the last event we emitted, so identical states
  // (e.g. re-renders on unrelated context changes) don't spam the IPC.
  const lastSent = useRef<string>("");
  // Stable browsing-session start so the elapsed timer survives navigation
  // instead of resetting on every route change.
  const browsingStart = useRef(0);
  // True while a play session owns presence; used to restart the browsing
  // timer when the user drops back to idle.
  const wasPlaying = useRef(false);
  // Throttle live download updates: Discord rate-limits SET_ACTIVITY, so we
  // emit immediately when the download/status changes and otherwise at most
  // once every 15s.
  const downloadEmit = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  useEffect(() => {
    // While a game runs, GameContext owns presence — never emit browsing.
    if (runningGameIds.length > 0) {
      wasPlaying.current = true;
      return;
    }
    if (wasPlaying.current) {
      wasPlaying.current = false;
      browsingStart.current = 0;
    }

    // 1) Active downloads outrank browsing, when the user opted in.
    if (discordShowDownloads) {
      const download = primaryDownload(activeDownloads);
      if (download) {
        const candidates = activeDownloads.filter((d) =>
          PRESENCE_DOWNLOAD_KINDS.has(d.status.kind),
        );
        const position = Math.max(1, candidates.indexOf(download) + 1);
        const payload = buildDownloadPresence(
          download,
          position,
          candidates.length,
          t,
          discordStatusDisplay,
        );
        const sig = JSON.stringify(payload);
        if (sig === lastSent.current) return;

        const key = `${download.id}:${download.status.kind}`;
        const now = Date.now();
        const isNewDownload = downloadEmit.current.key !== key;
        if (isNewDownload || now - downloadEmit.current.at >= 15_000) {
          downloadEmit.current = { key, at: now };
          lastSent.current = sig;
          void emit("discord-presence-update", payload);
        }
        return;
      }
    }

    // 2) Browsing broadcast is off: clear any lingering activity (e.g. after
    // a play session ends) instead of advertising where the user is.
    if (!discordShowBrowsing) {
      const payload = { state: "stopped" };
      const sig = JSON.stringify(payload);
      if (sig === lastSent.current) return;
      lastSent.current = sig;
      void emit("discord-presence-update", payload);
      return;
    }

    // 3) Browsing presence for the current route.
    const hint = browsingHint(
      pathname,
      games,
      wishlistCount,
      storePlatforms,
      modsGameName,
      t,
    );
    if (browsingStart.current === 0) browsingStart.current = Date.now();

    const payload: PresencePayload = {
      state: "browsing",
      details: hint.details,
      startedAt: discordShowPlaytime ? browsingStart.current : 0,
      detailsUrl: hint.detailsUrl,
      largeImage: discordShowArt ? hint.largeImage : undefined,
      largeText: discordShowArt ? hint.largeText : undefined,
      statusDisplay: discordStatusDisplay,
    };

    // Dedupe: only emit when the payload actually changed.
    const sig = JSON.stringify(payload);
    if (sig === lastSent.current) return;
    lastSent.current = sig;
    void emit("discord-presence-update", payload);
  }, [
    pathname,
    runningGameIds.join(","),
    games.length,
    storePlatforms.join(","),
    modsGameName,
    discordShowBrowsing,
    discordShowDownloads,
    discordShowArt,
    discordShowPlaytime,
    discordStatusDisplay,
    activeDownloads,
    wishlistCount,
    t,
  ]);
}
