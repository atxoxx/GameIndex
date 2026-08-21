import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  gameNameFromPath,
  extractSteamAppId,
  type Game,
  type GameMetadataResult,
} from "../types/game";
import { useToast } from "./ToastContext";
import { useLanguage } from "./LanguageContext";
import { useSplash } from "./SplashContext";
import { usePersistence } from "./game/usePersistence";
import { useWatcherIndex } from "./game/useWatcherIndex";
import { useSessions } from "./game/useSessions";
import { useLaunch } from "./game/useLaunch";
import { useEnrich } from "./game/useEnrich";

interface GameContextType {
  games: Game[];
  selectedGameId: string | null;
  setSelectedGameId: (id: string | null) => void;
  addGame: (game: Game) => void;
  addGames: (games: Game[]) => void;
  removeGame: (id: string) => void;
  /** Bulk-remove every game matching `predicate` (e.g. all games from a
   *  given integration). Used by the Settings integrations panel to wipe
   *  an integration's imported library in one action. */
  removeGames: (predicate: (game: Game) => boolean) => void;
  updateGame: (id: string, updates: Partial<Game>) => void;
  getGame: (id: string) => Game | undefined;
  runningGameIds: string[];
  /** Game ids whose tracked process just went missing and are in the
   *  watcher's grace period (e.g. a launcher handing off to the real game).
   *  The UI shows these as "closing" instead of flipping straight to stopped. */
  closingGameIds: string[];
  /** Live elapsed-seconds heartbeat per running game, fed by the watcher's
   *  periodic `game-progress` events. Keyed by game id. */
  liveElapsed: Record<string, number>;
  launchGame: (game: Game) => void;
  /**
   * Force-terminate the running game process and record the session.
   * Visible from the Game page "Force Close" button — pairs with the
   * `force_close_game` Tauri command. Reuses the same `game-exited`
   * event path as a natural exit, so activity / playtime / lastPlayed
   * all flow through to the existing listeners without bespoke
   * bookkeeping.
   */
  forceCloseGame: (game: Game) => Promise<void>;
  addStoreGame: (metadata: GameMetadataResult) => Promise<string>;
  importLocalGames: (items: { path: string; metadata: GameMetadataResult | null }[]) => Promise<void>;
  fetchGameReviews: (gameId: string, gameName: string, steamAppId?: number) => Promise<void>;
  /**
   * On-demand IGDB metadata enrichment. Called by GamePage on mount when
   * a game lacks a description (e.g. freshly Steam-synced, or imported
   * without metadata). Single IGDB call per invocation — well under the
   * 4 req/s cap. Safe to call multiple times; the function silently skips
   * games IGDB doesn't recognise.
   */
  enrichGameMetadata: (gameId: string, gameName: string, steamAppId?: number) => Promise<void>;
  /** Check whether a game is excluded from playtime/session tracking. */
  isGameUntracked: (gameId: string) => boolean;
  /** Toggle or set tracking exclusion for a game. */
  toggleGameTracking: (gameId: string, forceUntracked?: boolean) => void;
}

const GameContext = createContext<GameContextType | null>(null);

export const NO_IGDB_MATCH_SOURCE = "Steam (no IGDB match)";

let nextId = 1;
function generateId(): string {
  return `game-${Date.now()}-${nextId++}`;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  // SplashProvider wraps GameProvider in App.tsx, so we can read the
  // splash dispatcher straight from context. No cross-window IPC,
  // no async round-trip — the splash is an in-process React overlay.
  // Keep call order intact — Splash wraps Game.
  const splash = useSplash();

  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  // Keep a ref to the latest games array so the enrichGameMetadata callback
  // identity stays stable across any game mutation. Otherwise the dep on
  // `games` would re-create this callback on every keystroke or insert,
  // forcing the GamePage effect to re-run (subsequent guard still prevents
  // redundant IGDB calls, but the closure churn was wasted CPU).
  const gamesRef = useRef(games);
  gamesRef.current = games;

  // Shared ref for watcher index filtering (untracked games are excluded)
  const untrackedGameIdsRef = useRef<Set<string>>(new Set());

  // ── Watcher process index ──────────────────────────────────────
  const { scheduleWatcherIndexRebuild } = useWatcherIndex({
    gamesRef,
    untrackedGameIdsRef,
    setGames,
    showToast,
    t,
  });

  // ── Sessions: running / closing / liveElapsed / untracked ───────
  const sessions = useSessions({
    gamesRef,
    setGames,
    t,
    scheduleWatcherIndexRebuild,
    untrackedGameIdsRef,
  });

  // Keep the shared ref in sync with sessions state (sessions owns the Set)
  // This assignment runs every render so watcher rebuilds always see latest.
  untrackedGameIdsRef.current = sessions.untrackedGameIds;

  // ── Launch: launchGame / forceCloseGame / splash timers ─────────
  const { launchGame, forceCloseGame } = useLaunch({
    setGames,
    runningGameIds: sessions.runningGameIds,
    setRunningGameIds: sessions.setRunningGameIds,
    splash,
    showToast,
    t,
  });

  // ── Persistence: load / save debounced pipeline ─────────────────
  usePersistence({ games, setGames, gamesRef, untrackedGameIdsRef });

  // ── Update helper (used by enrich and library mutations) ─────────
  const updateGame = useCallback((id: string, updates: Partial<Game>) => {
    setGames((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
    // Path / Steam-app-id edits can change what the watcher matches, so
    // refresh the process index.
    scheduleWatcherIndexRebuild();
  }, [scheduleWatcherIndexRebuild]);

  // ── Enrich: IGDB metadata + reviews + image batch ────────────────
  const { enrichGameMetadata, fetchGameReviews, fetchAllImages } = useEnrich({
    gamesRef,
    updateGame,
  });

  const addGame = useCallback((game: Game) => {
    const id = game.id || generateId();
    setGames((prev) => [...prev, { ...game, id }]);
    // Refresh the watcher index so the new game is passively detectable.
    scheduleWatcherIndexRebuild();
    // IGDB metadata is now lazy: GamePage calls enrichGameMetadata on mount
    // for any game that lacks a description. This avoids the wasteful fan-out
    // that used to trigger hundreds of IGDB calls during Steam sync.
  }, [scheduleWatcherIndexRebuild]);

  const addGames = useCallback((newGames: Game[]) => {
    const withIds = newGames.map((g) => ({ ...g, id: g.id || generateId() }));
    setGames((prev) => [...prev, ...withIds]);
    // Refresh the watcher index so the imported games are passively
    // detectable without a restart.
    scheduleWatcherIndexRebuild();
    // IGDB metadata is now lazy: GamePage calls enrichGameMetadata on mount
    // for any game that lacks a description. This avoids the wasteful fan-out
    // that triggered hundreds of IGDB calls during Steam sync even in
    // sequential mode. For a 500-game Steam library, this saves ~4 minutes
    // of background fetching; users only see IGDB work for games they
    // actually open.
  }, [scheduleWatcherIndexRebuild]);

  const removeGame = useCallback(
    (id: string) => {
      setGames((prev) => prev.filter((g) => g.id !== id));
      setSelectedGameId((current) => (current === id ? null : current));
      sessions.setUntrackedGameIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        try {
          localStorage.setItem("gamelib.untracked_games", JSON.stringify([...next]));
        } catch (e) {
          console.error("Failed to save untracked games to localStorage:", e);
        }
        return next;
      });
      // Drop the exe from the watcher index so a stale process match can't
      // resurrect the deleted game as a phantom running entry.
      scheduleWatcherIndexRebuild();
    },
    [scheduleWatcherIndexRebuild, sessions]
  );

  const removeGames = useCallback(
    (predicate: (game: Game) => boolean) => {
      setGames((prev) => {
        if (!prev.some(predicate)) return prev;
        const removed = prev.filter(predicate);
        if (removed.length > 0) {
          sessions.setUntrackedGameIds((oldUntracked) => {
            const next = new Set(oldUntracked);
            for (const g of removed) {
              next.delete(g.id);
            }
            try {
              localStorage.setItem("gamelib.untracked_games", JSON.stringify([...next]));
            } catch (e) {}
            return next;
          });
        }
        return prev.filter((g) => !predicate(g));
      });
      // Refresh the index so removed exes stop matching (a harmless no-op
      // rebuild when the predicate matched nothing).
      scheduleWatcherIndexRebuild();
    },
    [scheduleWatcherIndexRebuild, sessions]
  );

  const gamesWithTracking = useMemo(
    () => games.map((g) => ({ ...g, untracked: sessions.untrackedGameIds.has(g.id) })),
    [games, sessions.untrackedGameIds]
  );

  const getGame = useCallback(
    (id: string) => gamesWithTracking.find((g) => g.id === id),
    [gamesWithTracking]
  );

  const addStoreGame = useCallback(async (metadata: GameMetadataResult): Promise<string> => {
    // Duplicate check — normalized name comparison
    const normName = metadata.title.toLowerCase().trim();
    const existing = games.find(
      (g) => g.name.toLowerCase().trim() === normName
    );
    if (existing) {
      showToast(t("gameContext.alreadyInLibrary", { name: metadata.title }), "info");
      return existing.id;
    }

    // Download all images to base64 for offline use
    const imageData = await fetchAllImages(metadata.images);

    const newGame: Game = {
      id: generateId(),
      name: metadata.title,
      path: "",
      platform: "Store",
      installed: false,
      playTime: "0h",
      addedAt: Date.now(),
      coverArtUrl: imageData.coverArtUrl,
      coverSourceUrl: imageData.coverSourceUrl,
      iconUrl: undefined,
      bannerUrl: imageData.bannerUrl,
      logoUrl: imageData.logoUrl,
      description: metadata.description ?? undefined,
      developer: metadata.developer ?? undefined,
      publisher: metadata.publisher ?? undefined,
      releaseDate: metadata.releaseDate ?? undefined,
      genres: metadata.genres.length > 0 ? metadata.genres : undefined,
      storyline: metadata.storyline,
      igdbRating: metadata.igdbRating ?? undefined,
      criticRating: metadata.criticRating ?? undefined,
      themes: metadata.themes ?? undefined,
      gameModes: metadata.gameModes ?? undefined,
      playerPerspectives: metadata.playerPerspectives ?? undefined,
      screenshots: metadata.screenshots ?? undefined,
      videos: metadata.videos ?? undefined,
      websites: metadata.websites ?? undefined,
      timeToBeat: metadata.timeToBeat ?? undefined,
      similarGames: metadata.similarGames ?? undefined,
      releases: metadata.releases ?? undefined,
      igdbReviews: metadata.igdbReviews ?? undefined,
      alternativeNames: metadata.alternativeNames ?? undefined,
      collection: metadata.collection ?? undefined,
      collectionId: metadata.collectionId,
      igdbId: metadata.igdbId,
      franchise: metadata.franchise ?? undefined,
      gameCategory: metadata.gameCategory ?? undefined,
      releaseStatus: metadata.releaseStatus ?? undefined,
      languageSupports: metadata.languageSupports ?? undefined,
      metadataSource: metadata.sourceName,
      metadataUrl: metadata.sourceUrl,
    };

    setGames((prev) => [...prev, newGame]);
    // Refresh the watcher index so the new store game is passively
    // detectable once it has a path.
    scheduleWatcherIndexRebuild();
    showToast(t("gameContext.addedToLibrary", { name: metadata.title }), "success");

    // Kick off a background review fetch so reviews are ready when the user
    // opens the Reviews tab. The store metadata doesn't carry a Steam app id,
    // so the backend will look one up by name.
    fetchGameReviews(newGame.id, newGame.name).catch((err) =>
      console.error("Background review fetch on add failed:", err)
    );

    return newGame.id;
  }, [games, showToast, fetchGameReviews, fetchAllImages, scheduleWatcherIndexRebuild, t]);

  const importLocalGames = useCallback(async (
    items: { path: string; metadata: GameMetadataResult | null }[]
  ) => {
    const imported: Game[] = [];
    for (const item of items) {
      const pathNorm = item.path.toLowerCase().trim();
      const duplicate = games.find((g) => g.path.toLowerCase().trim() === pathNorm);
      if (duplicate) {
        continue;
      }

      let newGame: Game;
      if (item.metadata) {
        const imageData = await fetchAllImages(item.metadata.images);
        newGame = {
          id: generateId(),
          name: item.metadata.title,
          path: item.path,
          platform: "Local",
          installed: true,
          playTime: "0h",
          addedAt: Date.now(),
          coverArtUrl: imageData.coverArtUrl,
          coverSourceUrl: imageData.coverSourceUrl,
          bannerUrl: imageData.bannerUrl,
          logoUrl: imageData.logoUrl,
          description: item.metadata.description ?? undefined,
          developer: item.metadata.developer ?? undefined,
          publisher: item.metadata.publisher ?? undefined,
          releaseDate: item.metadata.releaseDate ?? undefined,
          genres: item.metadata.genres.length > 0 ? item.metadata.genres : undefined,
          storyline: item.metadata.storyline,
          igdbRating: item.metadata.igdbRating ?? undefined,
          criticRating: item.metadata.criticRating ?? undefined,
          themes: item.metadata.themes ?? undefined,
          gameModes: item.metadata.gameModes ?? undefined,
          playerPerspectives: item.metadata.playerPerspectives ?? undefined,
          screenshots: item.metadata.screenshots ?? undefined,
          videos: item.metadata.videos ?? undefined,
          websites: item.metadata.websites ?? undefined,
          timeToBeat: item.metadata.timeToBeat ?? undefined,
          similarGames: item.metadata.similarGames ?? undefined,
          releases: item.metadata.releases ?? undefined,
          igdbReviews: item.metadata.igdbReviews ?? undefined,
          alternativeNames: item.metadata.alternativeNames ?? undefined,
          collection: item.metadata.collection ?? undefined,
          collectionId: item.metadata.collectionId,
          franchise: item.metadata.franchise ?? undefined,
          gameCategory: item.metadata.gameCategory ?? undefined,
          releaseStatus: item.metadata.releaseStatus ?? undefined,
          languageSupports: item.metadata.languageSupports ?? undefined,
          metadataSource: item.metadata.sourceName,
          metadataUrl: item.metadata.sourceUrl,
        };
      } else {
        newGame = {
          id: generateId(),
          name: gameNameFromPath(item.path),
          path: item.path,
          platform: "Local",
          installed: true,
          playTime: "0h",
          addedAt: Date.now(),
        };
      }
      imported.push(newGame);
    }

    if (imported.length > 0) {
      setGames((prev) => [...prev, ...imported]);
      // Refresh the watcher index so the imported exes are passively
      // detectable immediately.
      scheduleWatcherIndexRebuild();
      showToast(t("gameContext.imported", { count: imported.length }), "success");

      // Kick off background review fetches so the Reviews tab is populated
      // when the user opens it. Each import is a potential "game added"
      // event per the spec.
      for (const game of imported) {
        const steamAppId = extractSteamAppId(game.path) ?? undefined;
        fetchGameReviews(game.id, game.name, steamAppId).catch((err: unknown) =>
          console.error(`Background review fetch on import failed for ${game.name}:`, err)
        );
      }

      // Auto-size every locally-imported game in the background. We
      // delegate to the Rust `detect_game_size` Tauri command (same
      // path the Storage tab's Auto-detect button uses); on success
      // we patch the Game record in-place via `updateGame` so the
      // Storage tab picks up the new size the next time it mounts.
      //
      // Failures are silent (per-game) so a single bad path can't
      // poison the batch — the user can always click "Set size" /
      // "Auto-detect" on the Storage row to retry manually.
      for (const game of imported) {
        if (!game.path) continue;
        invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
          exePath: game.path,
          gameName: game.name,
          rootOverride: null,
        })
          .then((result) => {
            if (result && result.sizeBytes > 0) {
              updateGame(game.id, {
                sizeBytes: result.sizeBytes,
                sizeRootPath: result.rootPath,
                sizeDetectedAt: new Date().toISOString(),
              });
            }
          })
          .catch((err: unknown) => {
            // Per-game failure is non-fatal — just log so the user
            // can debug if the Storage tab shows "Not set" later.
            console.warn(`Auto-size on import failed for ${game.name}:`, err);
          });
      }
    } else {
      showToast(t("gameContext.noNewImports"), "info");
    }
  }, [games, showToast, fetchGameReviews, updateGame, fetchAllImages, scheduleWatcherIndexRebuild, t]);

  const contextValue = useMemo(() => ({
    games: gamesWithTracking,
    selectedGameId,
    setSelectedGameId,
    addGame,
    addGames,
    removeGame,
    removeGames,
    updateGame,
    getGame,
    runningGameIds: sessions.runningGameIds,
    closingGameIds: sessions.closingGameIds,
    liveElapsed: sessions.liveElapsed,
    launchGame,
    forceCloseGame,
    addStoreGame,
    importLocalGames,
    fetchGameReviews,
    enrichGameMetadata,
    isGameUntracked: sessions.isGameUntracked,
    toggleGameTracking: sessions.toggleGameTracking,
  }), [
    gamesWithTracking,
    selectedGameId,
    addGame,
    addGames,
    removeGame,
    removeGames,
    updateGame,
    getGame,
    sessions.runningGameIds,
    sessions.closingGameIds,
    sessions.liveElapsed,
    launchGame,
    forceCloseGame,
    addStoreGame,
    importLocalGames,
    fetchGameReviews,
    enrichGameMetadata,
    sessions.isGameUntracked,
    sessions.toggleGameTracking,
  ]);

  return (
    <GameContext.Provider value={contextValue}>
      {children}
    </GameContext.Provider>
  );
}

export function useGames(): GameContextType {
  const ctx = useContext(GameContext);
  if (!ctx) {
    throw new Error("useGames must be used within a GameProvider");
  }
  return ctx;
}

/** Narrow selector: returns the list of running game ids without subscribing to full games array changes. */
export function useRunningGames(): string[] {
  const { runningGameIds } = useGames();
  return runningGameIds;
}

/** Narrow selector: returns a single game by id, memoized to avoid re-renders when unrelated games change. */
export function useGameById(id: string): Game | undefined {
  const { getGame } = useGames();
  return useMemo(() => getGame(id), [getGame, id]);
}
