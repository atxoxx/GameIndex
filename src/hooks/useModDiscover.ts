// Data layer for the Mods "Discover" browser: per-game source detection,
// remote browsing with debounced search, and the download/install call.
// Kept separate from the existing `useGameMods` (installed-mods manager).

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ModRemoteInstall,
  ModRemoteProgress,
  ModSourceInfo,
  RemoteInstallResult,
  RemoteModDetail,
  RemoteModSearch,
  RemoteModSummary,
} from "../types/mods";

const PAGE_SIZE = 24;

/** Detected mod websites for a game + credential/config mutations. */
export function useModSources(gameId: string | null) {
  const [sources, setSources] = useState<ModSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(
    async (resolve: boolean) => {
      if (!gameId) {
        setSources([]);
        return;
      }
      if (resolve) setResolving(true);
      else setLoading(true);
      setError(null);
      try {
        const rows = await invoke<ModSourceInfo[]>("mods_sources_detect", {
          gameId,
          resolve,
        });
        setSources(rows);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
        setResolving(false);
      }
    },
    [gameId],
  );

  useEffect(() => {
    void detect(false);
  }, [detect]);

  const resolveAll = useCallback(() => detect(true), [detect]);

  const setCredential = useCallback(
    async (source: string, key: string) => {
      await invoke("mods_source_set_credential", { source, key });
      await detect(false);
    },
    [detect],
  );

  const setLink = useCallback(
    async (source: string, externalId: string, displayName?: string) => {
      await invoke("mods_source_set_link", {
        gameId,
        source,
        externalId,
        displayName: displayName ?? null,
      });
      await detect(false);
    },
    [detect, gameId],
  );

  const clearLink = useCallback(
    async (source: string) => {
      await invoke("mods_source_clear_link", { gameId, source });
      await detect(false);
    },
    [detect, gameId],
  );

  return {
    sources,
    loading,
    resolving,
    error,
    detect,
    resolveAll,
    setCredential,
    setLink,
    clearLink,
  };
}

/** Remote browse state for one (source, externalId) pair. */
export function useModBrowse(source: string | null, externalId: string | null) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("trending");
  const [results, setResults] = useState<RemoteModSummary[]>([]);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const run = useCallback(
    async (nextPage: number, append: boolean, q: string, s: string) => {
      if (!source || !externalId) return;
      const id = ++reqId.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await invoke<RemoteModSearch>("mods_source_browse", {
          source,
          externalId,
          query: q,
          sort: s,
          page: nextPage,
          pageSize: PAGE_SIZE,
        });
        if (id !== reqId.current) return;
        setResults((prev) => {
          if (!append) return res.results;
          // De-dupe across pages: some sites can repeat entries when the
          // offset isn't honoured.
          const seen = new Set(prev.map((m) => `${m.source}:${m.id}`));
          const merged = [...prev];
          for (const m of res.results) {
            const key = `${m.source}:${m.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(m);
            }
          }
          return merged;
        });
        setTotal(res.total);
        setHasMore(res.hasMore);
        setPage(res.page);
      } catch (err) {
        if (id !== reqId.current) return;
        setError(String(err));
        if (!append) setResults([]);
      } finally {
        if (id === reqId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [source, externalId],
  );

  // Debounced (re)load whenever the source, sort or query changes.
  useEffect(() => {
    if (!source || !externalId) {
      setResults([]);
      setTotal(undefined);
      setHasMore(false);
      return;
    }
    const handle = setTimeout(() => {
      void run(1, false, query, sort);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, externalId, sort, query]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    void run(page + 1, true, query, sort);
  }, [hasMore, loading, loadingMore, page, query, run, sort]);

  const refresh = useCallback(() => {
    void run(1, false, query, sort);
  }, [query, run, sort]);

  /** Run the search immediately (Enter), bypassing the debounce. */
  const flush = useCallback(() => {
    void run(1, false, query, sort);
  }, [query, run, sort]);

  return {
    query,
    setQuery,
    sort,
    setSort,
    results,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    loadMore,
    refresh,
    flush,
  };
}

/** Fetch a single mod's detail (description, gallery, files). */
export function useRemoteModDetail() {
  const [detail, setDetail] = useState<RemoteModDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (source: string, externalId: string, modId: string) => {
      setLoading(true);
      setError(null);
      setDetail(null);
      try {
        const res = await invoke<RemoteModDetail>("mods_source_detail", {
          source,
          externalId,
          modId,
        });
        setDetail(res);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setDetail(null);
    setError(null);
  }, []);

  return { detail, loading, error, load, reset };
}

/** Download + install a remote mod into the game's mods folder. */
export function useRemoteInstall() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RemoteInstallResult | null>(null);

  const install = useCallback(
    async (args: {
      gameId: string;
      source: string;
      externalId: string;
      modId: string;
      fileId?: string;
      name?: string;
      author?: string;
      version?: string;
      remoteUrl?: string;
      destination?: string;
    }): Promise<RemoteInstallResult> => {
      setBusy(true);
      setResult(null);
      try {
        const res = await invoke<RemoteInstallResult>("mods_source_download", {
          ...args,
          fileId: args.fileId ?? null,
          name: args.name ?? null,
          author: args.author ?? null,
          version: args.version ?? null,
          remoteUrl: args.remoteUrl ?? null,
          destination: args.destination ?? null,
        });
        setResult(res);
        return res;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, result, install, reset: () => setResult(null) };
}

/** Live download/install progress while a remote install is running. */
export function useRemoteProgress(active: boolean) {
  const [progress, setProgress] = useState<ModRemoteProgress | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(null);
      return;
    }
    let unlisten: (() => void) | undefined;
    void listen<ModRemoteProgress>("mods-remote-progress", (e) => {
      setProgress(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [active]);

  return progress;
}

/** Recent Discover installs for a game. */
export function useRemoteInstalls(gameId: string | null) {
  const [installs, setInstalls] = useState<ModRemoteInstall[]>([]);

  const refresh = useCallback(async () => {
    if (!gameId) {
      setInstalls([]);
      return;
    }
    try {
      const rows = await invoke<ModRemoteInstall[]>("mods_remote_installs", {
        gameId,
      });
      setInstalls(rows);
    } catch {
      setInstalls([]);
    }
  }, [gameId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await invoke("mods_remote_install_remove", { id });
      await refresh();
    },
    [refresh],
  );

  return { installs, refresh, remove };
}
