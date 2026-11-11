/**
 * React surface for the always-on friends sync engine.
 *
 * The engine itself is framework-free; this provider only owns its lifecycle
 * (load lazily, start once the identity is ready, stop on unmount), feeds it
 * the library-derived per-game stats, and republishes status changes into
 * React state.
 *
 * Everything under `src/sync/friends` — and `friendsStorage`, which pulls in
 * nostr-tools — is imported dynamically. Mounting the provider must not put
 * the Nostr stack in the boot bundle, exactly like the friends page chunk.
 * `useGames()` is the one static dependency: it is already part of the shell
 * (GameProvider), so reading the library here costs nothing extra.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useGames } from "../../context/GameContext";
import type {
  ChatEnvelopeDraft,
  FriendsSyncEngine,
  FriendsSyncStatus,
  SharedGameStatInput,
} from "./engine";
import { toSharedGameInputs } from "./sharedGames";

export type FriendsSyncContextValue = {
  status: FriendsSyncStatus;
  syncNow: () => void;
  requestPublish: () => void;
  sendChat: (peer: string, envelope: ChatEnvelopeDraft) => void;
  sendFriendRequest: (pubkey: string) => void;
  /** Re-publish our pending request to one peer (the "send again" button). */
  resendRequest: (pubkey: string) => void;
  acceptFriend: (pubkey: string) => void;
  blockPeer: (pubkey: string) => void;
  removePeer: (pubkey: string) => void;
  refresh: () => void;
};

const IDLE_STATUS: FriendsSyncStatus = {
  phase: "idle",
  manualSync: "idle",
  manualSyncFinishedAt: null,
  relayStatus: {},
  lastSyncedAt: null,
  lastError: null,
  pendingPublish: 0,
  peers: {},
};

/**
 * One engine per window, created on first mount. The promise (not the
 * instance) is shared so two concurrent mounts cannot build two engines.
 */
let sharedEnginePromise: Promise<FriendsSyncEngine> | null = null;

function loadEngine(): Promise<FriendsSyncEngine> {
  if (!sharedEnginePromise) {
    sharedEnginePromise = Promise.all([
      import("./engine"),
      import("./relay"),
      import("./adapter"),
    ]).then(([engineModule, relayModule, adapterModule]) => {
      return new engineModule.FriendsSyncEngine({
        relay: relayModule.createRelayPort(),
        adapter: adapterModule.createFriendsSyncAdapter(),
      });
    });
  }
  return sharedEnginePromise;
}

const FriendsSyncContext = createContext<FriendsSyncContextValue | null>(null);

let warnedMissingProvider = false;

export function FriendsSyncProvider({ children }: { children: ReactNode }) {
  const { games } = useGames();
  const engineRef = useRef<FriendsSyncEngine | null>(null);
  const [status, setStatus] = useState<FriendsSyncStatus>(IDLE_STATUS);

  // The library -> shared-stat mapping is O(library) and the library changes
  // often (enrichment patches), so it is memoized per `games` identity. The
  // engine gets a getter instead of a value: a snapshot published later must
  // read the newest stats without the provider re-registering.
  const sharedGames = useMemo<SharedGameStatInput[]>(
    () => toSharedGameInputs(games),
    [games]
  );
  const sharedGamesRef = useRef(sharedGames);
  useEffect(() => {
    sharedGamesRef.current = sharedGames;
  }, [sharedGames]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const boot = async () => {
      const [engine, storage] = await Promise.all([
        loadEngine(),
        import("../../pages/friendsStorage"),
      ]);
      if (cancelled) return;

      engineRef.current = engine;
      unsubscribe = engine.subscribeStatus(setStatus);
      setStatus(engine.getStatus());

      // Registered before start() so the very first snapshot already carries
      // the library instead of an empty `games` block.
      engine.setSharedGames(() => sharedGamesRef.current);

      if (!storage.isNostrIdentityReady()) {
        // Resolves the keychain-backed identity. It never mints a key on a
        // backend failure, so a failed load simply leaves the engine idle.
        try {
          await storage.initNostrKeys();
        } catch {
          /* backend unavailable — stay idle */
        }
      }
      if (cancelled || !storage.isNostrIdentityReady()) return;
      engine.start();
    };

    void boot().catch(() => {
      /* a failed chunk load must not break the app shell */
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) {
        // The engine instance is shared across mounts; drop our library
        // reference so a stopped engine cannot hold the whole library.
        engine.setSharedGames(null);
        engine.stop();
      }
    };
  }, []);

  // A library change is not a friends-database change, so the engine would
  // otherwise only pick the new stats up on its next unrelated publish. Push
  // the getter and ask for one debounced republish; the engine still skips
  // peers whose snapshot fingerprint did not change.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setSharedGames(() => sharedGamesRef.current);
    engine.requestPublish();
  }, [sharedGames]);

  const value = useMemo<FriendsSyncContextValue>(
    () => ({
      status,
      syncNow: () => {
        void engineRef.current?.syncNow();
      },
      requestPublish: () => engineRef.current?.requestPublish(),
      sendChat: (peer, envelope) => engineRef.current?.sendChat(peer, envelope),
      sendFriendRequest: (pubkey) =>
        engineRef.current?.sendFriendRequest(pubkey),
      resendRequest: (pubkey) => engineRef.current?.resendRequest(pubkey),
      acceptFriend: (pubkey) => engineRef.current?.acceptFriend(pubkey),
      blockPeer: (pubkey) => engineRef.current?.blockPeer(pubkey),
      removePeer: (pubkey) => engineRef.current?.removePeer(pubkey),
      refresh: () => engineRef.current?.refresh(),
    }),
    [status]
  );

  return (
    <FriendsSyncContext.Provider value={value}>
      {children}
    </FriendsSyncContext.Provider>
  );
}

/**
 * Sync state and actions for any component under `FriendsSyncProvider`.
 * Falls back to an inert value when the provider is missing so a stray render
 * (or an isolated component test) can never crash the app.
 */
export function useFriendsSync(): FriendsSyncContextValue {
  const value = useContext(FriendsSyncContext);
  if (!value) {
    if (!warnedMissingProvider) {
      warnedMissingProvider = true;
      console.warn(
        "useFriendsSync used outside FriendsSyncProvider — sync is inert here"
      );
    }
    return inertValue;
  }
  return value;
}

const inertValue: FriendsSyncContextValue = {
  status: IDLE_STATUS,
  syncNow: () => {},
  requestPublish: () => {},
  sendChat: () => {},
  sendFriendRequest: () => {},
  resendRequest: () => {},
  acceptFriend: () => {},
  blockPeer: () => {},
  removePeer: () => {},
  refresh: () => {},
};
