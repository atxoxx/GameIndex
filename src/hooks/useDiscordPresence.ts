import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { emit, listen } from "@tauri-apps/api/event";
import { useGames } from "../context/GameContext";
import { usePresence } from "../context/PresenceContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { useDownloads } from "../context/DownloadContext";
import { useWishlistContext } from "../context/WishlistContext";
import { useAchievements } from "../context/AchievementContext";
import { useBigScreen } from "../context/BigScreenContext";
import { buildPlayingPresence } from "../context/game/discordPlayingPresence";
import {
  browsingHint,
  buildDownloadPresence,
  primaryDownload,
  PRESENCE_DOWNLOAD_KINDS,
  type PresencePayload,
} from "./discordPresenceBuild";

interface GameStartedEvent {
  gameId: string;
  gameName: string;
}

interface GameExitEvent {
  gameId: string;
}

interface AchievementUnlockedEvent {
  gameId: string;
  achievements?: { displayName?: string }[];
}

/** How long a fresh achievement stays pinned to the status line. */
const UNLOCK_FLASH_MS = 25_000;

/**
 * useDiscordPresence
 * ──────────────────
 * The single owner of Discord Rich Presence. Mounted once at the shell root
 * (below every provider), it decides what the backend should show and emits a
 * `discord-presence-update` event, in priority order:
 *
 *   1. a running game ("playing", with optional achievement progress/art),
 *   2. an active download ("downloading", with an ETA countdown),
 *   3. the current page ("browsing"),
 *   4. nothing ("stopped") when browsing broadcast is off.
 *
 * Owning all states in one effect is what lets the playing card read
 * achievement and Big Screen state — those providers sit above the session
 * hook that used to emit playing presence.
 */
export function useDiscordPresence() {
  const { pathname } = useLocation();
  const { games, runningGameIds } = useGames();
  const { storePlatforms, modsGameName, storeGameName, storeGameArt } = usePresence();
  const { isBigScreen } = useBigScreen();
  const { getAchievementSummary } = useAchievements();
  const { t } = useLanguage();
  const { activeDownloads } = useDownloads();
  const { count: wishlistCount } = useWishlistContext();
  const {
    discordRichPresence,
    discordShowBrowsing,
    discordShowDownloads,
    discordShowArt,
    discordShowPlaytime,
    discordShowWebsiteButton,
    discordShowStoreButton,
    discordShowAchievements,
    discordShowExtraDetails,
    discordStatusDisplay,
  } = useSettings();

  // Payload signature of the last event we emitted, so identical states
  // (e.g. re-renders on unrelated context changes) don't spam the IPC.
  const lastSent = useRef<string>("");
  // Stable browsing-session start so the elapsed timer survives navigation
  // instead of resetting on every route change.
  const browsingStart = useRef(0);
  // True while a play session owns presence; used to restart the browsing
  // timer when the user drops back to idle.
  const wasPlaying = useRef(false);
  // Session start times keyed by game id (the watcher only tells us ids).
  const sessionStarts = useRef<Map<string, number>>(new Map());
  // Watcher-provided game names, so a running game that isn't in the library
  // still gets a title.
  const gameNames = useRef<Map<string, string>>(new Map());
  // Throttle live download updates: Discord rate-limits SET_ACTIVITY, so we
  // emit immediately when the download/status changes and otherwise at most
  // once every 15s.
  const downloadEmit = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  // Transient "🏆 achievement unlocked" line shown for a running game.
  const [unlockFlash, setUnlockFlash] = useState<{
    gameId: string;
    text: string;
    until: number;
  } | null>(null);

  // Learn game names from the watcher (covers games not yet in the library).
  useEffect(() => {
    const started = listen<GameStartedEvent>("game-started", (event) => {
      gameNames.current.set(event.payload.gameId, event.payload.gameName);
    });
    const exited = listen<GameExitEvent>("game-exited", (event) => {
      gameNames.current.delete(event.payload.gameId);
    });
    return () => {
      void started.then((fn) => fn());
      void exited.then((fn) => fn());
    };
  }, []);

  // Pin a freshly unlocked achievement to the status line for a short while.
  useEffect(() => {
    const unlisten = listen<AchievementUnlockedEvent>("achievement-unlocked", (event) => {
      const name = event.payload.achievements?.[0]?.displayName;
      if (!name) return;
      setUnlockFlash({
        gameId: event.payload.gameId,
        text: t("discordPresence.achievementUnlocked", { name }),
        until: Date.now() + UNLOCK_FLASH_MS,
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    if (!unlockFlash) return;
    const remaining = unlockFlash.until - Date.now();
    if (remaining <= 0) {
      setUnlockFlash(null);
      return;
    }
    const id = setTimeout(() => setUnlockFlash(null), remaining);
    return () => clearTimeout(id);
  }, [unlockFlash]);

  useEffect(() => {
    // The user has Rich Presence switched off. Clear any activity the
    // backend is still advertising and stop recomputing a payload on every
    // library/download/wishlist/route change — those all flow through this
    // effect, and building + serializing a payload per tick is pure waste
    // when the master switch is off.
    if (!discordRichPresence) {
      const stopped = JSON.stringify({ state: "stopped" });
      if (lastSent.current !== stopped) {
        lastSent.current = stopped;
        void emit("discord-presence-update", { state: "stopped" });
      }
      return;
    }

    const now = Date.now();
    const running = new Set(runningGameIds);
    for (const id of running) {
      if (!sessionStarts.current.has(id)) sessionStarts.current.set(id, now);
    }
    for (const id of [...sessionStarts.current.keys()]) {
      if (!running.has(id)) sessionStarts.current.delete(id);
    }

    const send = (payload: unknown) => {
      const sig = JSON.stringify(payload);
      if (sig === lastSent.current) return;
      lastSent.current = sig;
      void emit("discord-presence-update", payload);
    };

    // 1) A running game owns presence. `runningGameIds` is append-ordered, so
    // the last entry is the most recently started title.
    if (runningGameIds.length > 0) {
      wasPlaying.current = true;
      const activeId = runningGameIds[runningGameIds.length - 1];
      const game = games.find((g) => g.id === activeId);
      const summary = getAchievementSummary(activeId);
      const flash =
        unlockFlash && unlockFlash.gameId === activeId && now < unlockFlash.until
          ? unlockFlash
          : null;

      send(
        buildPlayingPresence(
          game,
          activeId,
          game?.name ?? gameNames.current.get(activeId) ?? "",
          {
            startedAt: sessionStarts.current.get(activeId) ?? now,
            showArt: discordShowArt,
            showPlaytime: discordShowPlaytime,
            showWebsiteButton: discordShowWebsiteButton,
            showStoreButton: discordShowStoreButton,
            showExtraDetails: discordShowExtraDetails,
            showAchievements: discordShowAchievements,
            statusDisplay: discordStatusDisplay,
            unlockText: flash?.text,
            achievement: summary
              ? { unlocked: summary.unlocked, total: summary.total }
              : undefined,
          },
          t,
        ),
      );
      return;
    }
    if (wasPlaying.current) {
      wasPlaying.current = false;
      browsingStart.current = 0;
    }

    // 2) Active downloads outrank browsing, when the user opted in.
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
          now,
        );
        const sig = JSON.stringify(payload);
        if (sig === lastSent.current) return;

        const key = `${download.id}:${download.status.kind}`;
        const isNewDownload = downloadEmit.current.key !== key;
        if (isNewDownload || now - downloadEmit.current.at >= 15_000) {
          downloadEmit.current = { key, at: now };
          lastSent.current = sig;
          void emit("discord-presence-update", payload);
        }
        return;
      }
    }

    // 3) Browsing broadcast is off: clear any lingering activity instead of
    // advertising where the user is.
    if (!discordShowBrowsing) {
      send({ state: "stopped" });
      return;
    }

    // 4) Browsing presence for the current route.
    const hint = browsingHint(
      {
        pathname,
        games,
        wishlistCount,
        installedCount: games.filter((g) => g.installed).length,
        storePlatforms,
        modsGameName,
        storeGameName,
        storeGameArt,
        bigScreen: isBigScreen,
      },
      t,
    );
    if (browsingStart.current === 0) browsingStart.current = now;

    const payload: PresencePayload = {
      state: "browsing",
      details: hint.details,
      startedAt: discordShowPlaytime ? browsingStart.current : 0,
      detailsUrl: hint.detailsUrl,
      largeImage: discordShowArt ? hint.largeImage : undefined,
      largeText: discordShowArt ? hint.largeText : undefined,
      largeUrl: discordShowArt ? hint.largeUrl : undefined,
      statusDisplay: discordStatusDisplay,
    };
    send(payload);
  }, [
    discordRichPresence,
    pathname,
    runningGameIds.join(","),
    games,
    storePlatforms.join(","),
    modsGameName,
    storeGameName,
    storeGameArt,
    isBigScreen,
    discordShowBrowsing,
    discordShowDownloads,
    discordShowArt,
    discordShowPlaytime,
    discordShowWebsiteButton,
    discordShowStoreButton,
    discordShowAchievements,
    discordShowExtraDetails,
    discordStatusDisplay,
    activeDownloads,
    wishlistCount,
    unlockFlash,
    getAchievementSummary,
    t,
  ]);
}
