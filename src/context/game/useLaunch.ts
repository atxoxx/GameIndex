import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Game } from "../../types/game";
import type { RomLaunchPlan } from "../../types/emulator";
import { isSplashEnabled } from "../SplashContext";
import type { SplashContextType } from "../SplashContext";
import type { ToastType } from "../ToastContext";

interface GameStartedEvent {
  gameId: string;
  gameName: string;
  detectedExe?: string;
}

/** How long the launch splash waits for the watcher's `game-started` event
 *  before closing anyway. Covers protocol launches (Steam/Uplay/UAC) that
 *  resolve the launch command before the real process appears — or never
 *  appear at all (e.g. the user cancelled a launcher dialog). */
const SPLASH_STARTED_FALLBACK_MS = 20000;

export function useLaunch(options: {
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  runningGameIds: string[];
  setRunningGameIds: React.Dispatch<React.SetStateAction<string[]>>;
  splash: SplashContextType;
  showToast: (message: string, type: ToastType) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const { setGames, runningGameIds, setRunningGameIds, splash, showToast, t } = options;

  // Latest splash state for the fallback timer, so the delayed "started"
  // flip always reads the current record instead of a stale closure.
  const splashRef = useRef(splash);
  splashRef.current = splash;
  const splashFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable self-reference so the splash's Retry action can re-invoke the
  // latest `launchGame` (defined below) for the same game after a failure.
  const launchGameRef = useRef<(game: Game) => void>(() => {});

  /** Flip a still-"launching" splash to "started" once the watcher confirms
   *  the game process is up. Ignored for passively-detected games whose
   *  splash isn't showing. */
  const markSplashStarted = useCallback((gameId: string) => {
    const rec = splashRef.current.record;
    if (!rec || rec.game.id !== gameId || rec.status !== "launching") return;
    if (splashFallbackTimerRef.current) {
      clearTimeout(splashFallbackTimerRef.current);
      splashFallbackTimerRef.current = null;
    }
    splashRef.current.updateStatus("started");
  }, []);

  /** Safety net: if the watcher never fires game-started (e.g. a Steam
   *  protocol launch the user cancelled), close the splash after a beat
   *  instead of leaving it stuck on "launching". */
  const armSplashFallback = useCallback((gameId: string) => {
    if (splashFallbackTimerRef.current) clearTimeout(splashFallbackTimerRef.current);
    splashFallbackTimerRef.current = setTimeout(() => {
      splashFallbackTimerRef.current = null;
      const rec = splashRef.current.record;
      if (rec && rec.game.id === gameId && rec.status === "launching") {
        splashRef.current.updateStatus("started");
      }
    }, SPLASH_STARTED_FALLBACK_MS);
  }, []);

  // Also flip splash on passive game-started so protocol launches that
  // didn't go through launchGame still show "started" correctly. This
  // complements the sessions hook's running-state handling.
  useEffect(() => {
    const unlisten = listen<GameStartedEvent>("game-started", (event) => {
      markSplashStarted(event.payload.gameId);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [markSplashStarted]);

  const forceCloseGame = useCallback(async (game: Game) => {
    try {
      const result = await invoke<{ pid: number; killed: boolean }>(
        "force_close_game",
        { gameId: game.id }
      );
      // Three distinct outcomes per the backend contract:
      //   - killed=true: process was actually terminated. Success toast.
      //   - killed=false with pid > 0: session cleared but the
      //     terminate call was refused (PID recycled, access denied).
      //     The session is no longer tracked so the running
      //     indicator WILL still clear via `game-exited`, but we
      //     surface the partial success so the user knows the game
      //     itself may still be running on disk.
      //   - pid == 0 (always killed=false): pending session (Steam
      //     protocol / UAC) — nothing to terminate. Treat as success.
      if (result.killed) {
        showToast(t("gameContext.forceClosed", { name: game.name }), "success");
      } else if (result.pid > 0) {
        showToast(
          t("gameContext.endedSession", { name: game.name }),
          "warning"
        );
      } else {
        showToast(t("gameContext.forceClosed", { name: game.name }), "success");
      }
    } catch (err) {
      showToast(t("gameContext.forceCloseFailed", { name: game.name, error: String(err) }), "error");
    }
  }, [showToast, t]);

  const launchGame = useCallback(async (game: Game) => {
    if (runningGameIds.includes(game.id)) {
      showToast(t("gameContext.alreadyRunning", { name: game.name }), "info");
      return;
    }

    // Resolve the selected GPU from localStorage
    let gpuId: string | null = null;
    let gpuName: string | null = null;
    const savedGpu = localStorage.getItem("gamelib-gpus");
    const savedGpuId = localStorage.getItem("gamelib-selected-gpu");
    if (savedGpu && savedGpuId) {
      try {
        const gpus = JSON.parse(savedGpu);
        const selected = gpus.find((g: any) => g.id === savedGpuId);
        if (selected) {
          gpuId = selected.id;
          gpuName = selected.name;
        }
      } catch (e) {
        console.error("Failed to parse selected GPU from storage", e);
      }
    }

    // Show the launch splash if the user has it enabled
    const splashOn = isSplashEnabled();
    if (splashOn) {
      splash.open({ game }, { retry: () => launchGameRef.current(game) });
    }

    setRunningGameIds((prev) => [...prev, game.id]);

    // Stamp lastPlayed immediately so the game surfaces in the
    // "Continue Playing" rail even before the session ends. If the
    // backend later emits a game-exited event, the timestamp will be
    // refined to the actual finish time.
    setGames((prev) =>
      prev.map((g) =>
        g.id === game.id ? { ...g, lastPlayed: Date.now() } : g
      )
    );

    try {
      // ── Rockstar: launch through the Rockstar Games Launcher ──
      // Playnite routes play via `Launcher.exe -launchTitleInFolder
      // "<installDir>"` so Rockstar's DRM / Social Club bootstrap
      // runs. We do the same when the game carries a `rockstarTitleId`.
      if (game.rockstarTitleId) {
        await invoke<string>("rockstar_launch_game", {
          gameId: game.id,
          gameName: game.name,
          gamePath: game.path || null,
          titleId: game.rockstarTitleId,
        });
        if (splashOn) armSplashFallback(game.id);
        showToast(t("gameContext.launched", { name: game.name }), "success");
        return;
      }

      // ── Ubisoft Connect: launch through the Ubisoft client ──
      // Playnite routes play via the `uplay://launch/<id>` protocol so
      // Ubisoft's DRM bootstrap runs. We do the same when the game
      // carries a `uplayGameId`.
      if (game.uplayGameId) {
        await invoke<string>("uplay_launch_game", {
          gameId: game.id,
          gameName: game.name,
          gamePath: game.path || null,
          uplayId: game.uplayGameId,
        });
        if (splashOn) armSplashFallback(game.id);
        showToast(t("gameContext.launched", { name: game.name }), "success");
        return;
      }

      // ── ROMs: resolve the launch plan first ─────────────────────────
      // The backend merges the per-ROM profile's argument override,
      // extracts zip/7z archives into the managed cache, and reports
      // save-backup health. Abort with a warning when saves are
      // newer than the latest backup.
      let gamePath = game.path || "";
      let launchArgs = game.launchArguments || null;
      if (game.emulatorId && game.romPath) {
        const plan = await invoke<RomLaunchPlan>("rom_launch_plan", { gameId: game.id });
        gamePath = plan.executablePath;
        launchArgs = plan.arguments;
        if (plan.savesStatus?.outdated) {
          const proceed = window.confirm(t("emulators.saves.launchWarning"));
          if (!proceed) {
            setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
            if (splashOn) splash.close();
            return;
          }
        }
      }

      // ── Unified launch: single Tauri command for all game types ─────
      // The Rust backend handles:
      //   * Direct exe spawn (Local games, Steam with known path)
      //   * steam:// protocol (Steam without local exe)
      //   * Process lifecycle tracking via GameWatcher background poll
      //   * Metrics collection (starts automatically when PID is known)
      await invoke<string>("launch_game", {
        gameId: game.id,
        gameName: game.name,
        gamePath,
        platform: game.platform,
        steamAppId: game.steamAppId ?? null,
        gpuId,
        gpuName,
        launchArguments: launchArgs,
        runAsAdmin: game.runAsAdmin || null,
        showSteamLaunchSelection: game.showSteamLaunchSelection || null,
        preLaunchScript: game.preLaunchScript || null,
        preLaunchAdmin: game.preLaunchAdmin || null,
        postExitScript: game.postExitScript || null,
        postExitAdmin: game.postExitAdmin || null,
        companionApps: game.companionApps || null,
      });

      if (splashOn) armSplashFallback(game.id);
      showToast(t("gameContext.launched", { name: game.name }), "success");
    } catch (err: any) {
      setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
      if (splashOn) splash.updateStatus("error", String(err));
      showToast(t("gameContext.launchFailed", { error: String(err) }), "error");
    }
  }, [runningGameIds, showToast, splash, t, setGames, setRunningGameIds, armSplashFallback]);
  launchGameRef.current = launchGame;

  return {
    launchGame,
    forceCloseGame,
    markSplashStarted,
    armSplashFallback,
    launchGameRef,
    splashRef,
    splashFallbackTimerRef,
  };
}
