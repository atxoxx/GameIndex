import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { emit } from "@tauri-apps/api/event";
import { useGames } from "../context/GameContext";
import { usePresence } from "../context/PresenceContext";
import { useLanguage } from "../context/LanguageContext";

/**
 * useDiscordPresence
 * ──────────────────
 * Single emitter for the Discord Rich Presence "browsing" (idle /
 * navigating) activity. Watches the route and page-local presence hints
 * and emits a `discord-presence-update` event with `state: "browsing"`
 * so the backend presence thread reflects where the user is in the app.
 *
 * While any game is running (`runningGameIds.length > 0`) this hook stays
 * silent — GameContext owns the presence thread during a play session.
 */
export function useDiscordPresence() {
  const { pathname } = useLocation();
  const { games, runningGameIds } = useGames();
  const { storePlatforms, modsGameName } = usePresence();
  const { t } = useLanguage();

  // Payload signature of the last event we emitted, so identical states
  // (e.g. re-renders on unrelated context changes) don't spam the IPC.
  const lastSent = useRef<string>("");

  useEffect(() => {
    // While a game runs, GameContext owns presence — never emit browsing.
    if (runningGameIds.length > 0) return;

    let details: string;
    if (pathname === "/" || pathname === "/home") {
      details = t("discordPresence.browsingApp");
    } else if (pathname === "/library") {
      details = t("discordPresence.browsingLibrary", {
        count: games.length.toLocaleString(),
      });
    } else if (pathname.startsWith("/library/")) {
      // HashRouter pathname has no hash prefix; segment [2] is the game id.
      const game = games.find((g) => g.id === pathname.split("/")[2]);
      details = t("discordPresence.browsingGamePage", {
        game: game?.name ?? "",
      });
    } else if (pathname === "/mods") {
      details = modsGameName
        ? t("discordPresence.configuringMods", { game: modsGameName })
        : t("discordPresence.browsingApp");
    } else if (pathname === "/store" || pathname.startsWith("/store/")) {
      details =
        storePlatforms.length === 1
          ? t("discordPresence.shoppingStorePlatform", {
              platform: storePlatforms[0],
            })
          : t("discordPresence.shoppingStore");
    } else if (pathname === "/activity") {
      details = t("discordPresence.browsingActivity");
    } else if (pathname === "/settings") {
      details = t("discordPresence.browsingSettings");
    } else {
      details = t("discordPresence.browsingApp");
    }

    const payload = {
      state: "browsing",
      details,
      stateText: t("discordPresence.smallText"),
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
    t,
  ]);
}
