import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

type TabStateValues = Record<string, string>;

export interface GameTabStateOptions<T extends object> {
  /** URL/localStorage namespace, e.g. `dlc` → `?dlcView=table`. */
  prefix: string;
  defaults: T;
  /** Allowed values per key; an invalid URL value falls back to the default. */
  allowed?: Partial<Record<keyof T, readonly string[]>>;
}

function paramName(prefix: string, key: string): string {
  return `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

function storageKey(prefix: string): string {
  return `gamelib.gameTab.${prefix}`;
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function readStorage<T extends object>(prefix: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(storageKey(prefix));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : null;
  } catch {
    return null;
  }
}

function writeStorage<T extends object>(prefix: string, value: T): void {
  try {
    localStorage.setItem(storageKey(prefix), JSON.stringify(value));
  } catch {
    // Storage full / unavailable — the URL still carries the state.
  }
}

function sanitize<T extends object>(
  candidate: Partial<T>,
  defaults: T,
  allowed: GameTabStateOptions<T>["allowed"],
): T {
  const next = { ...defaults } as Record<string, string>;
  const source = asRecord(candidate);
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = source[key as string];
    if (typeof value !== "string" || value === "") continue;
    const permit = allowed?.[key];
    if (permit && !permit.includes(value)) continue;
    next[key as string] = value;
  }
  return next as T;
}

/**
 * Keeps a game subtab's view/filter/sort/item in both the URL and
 * localStorage.
 *
 * The URL is the source of truth once the tab has mounted, which makes every
 * meaningful state shareable and lets the browser's Back button undo a filter
 * change. localStorage is the seed, so re-entering the tab (or opening the
 * popout) restores the last workspace instead of resetting it.
 *
 * Only non-default values are written to the URL, keeping it readable.
 */
export function useGameTabState<T extends object>({
  prefix,
  defaults,
  allowed,
}: GameTabStateOptions<T>): [T, (patch: Partial<T>) => void, () => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const mountedRef = useRef(false);
  const keys = useMemo(() => Object.keys(defaults) as (keyof T)[], [defaults]);
  const defaultsRecord = useMemo(
    () => asRecord(defaults) as Record<string, string>,
    [defaults],
  );

  const readUrl = useCallback(
    (params: URLSearchParams): T => {
      const candidate: Record<string, string> = {};
      for (const key of keys) {
        const value = params.get(paramName(prefix, String(key)));
        if (value !== null) candidate[String(key)] = value;
      }
      return sanitize(candidate as Partial<T>, defaults, allowed);
    },
    [allowed, defaults, keys, prefix],
  );

  const hasUrlParams = keys.some((key) =>
    searchParams.has(paramName(prefix, String(key))),
  );

  const [state, setState] = useState<T>(() => {
    if (hasUrlParams) return readUrl(searchParams);
    const stored = readStorage<T>(prefix);
    return stored ? sanitize(stored, defaults, allowed) : defaults;
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const writeUrl = useCallback(
    (value: T, replace: boolean) => {
      const record = asRecord(value) as Record<string, string>;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of keys) {
            const name = paramName(prefix, String(key));
            const current = record[String(key)];
            if (current === defaultsRecord[String(key)]) next.delete(name);
            else next.set(name, current);
          }
          return next;
        },
        { replace },
      );
    },
    [defaultsRecord, keys, prefix, setSearchParams],
  );

  const paramsString = searchParams.toString();

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      const hasParams = keys.some((key) =>
        searchParams.has(paramName(prefix, String(key))),
      );
      if (hasParams) {
        const fromUrl = readUrl(searchParams);
        setState(fromUrl);
        writeStorage(prefix, fromUrl);
      } else {
        writeUrl(stateRef.current, true);
      }
      return;
    }

    const fromUrl = readUrl(searchParams);
    const current = asRecord(stateRef.current) as TabStateValues;
    const next = asRecord(fromUrl) as TabStateValues;
    const unchanged = keys.every((key) => next[String(key)] === current[String(key)]);
    if (unchanged) return;
    setState(fromUrl);
    writeStorage(prefix, fromUrl);
  }, [paramsString]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (patch: Partial<T>) => {
      const next = sanitize(
        { ...(stateRef.current as object), ...(patch as object) } as Partial<T>,
        defaults,
        allowed,
      );
      stateRef.current = next;
      setState(next);
      writeStorage(prefix, next);
      writeUrl(next, true);
    },
    [allowed, defaults, prefix, writeUrl],
  );

  const reset = useCallback(() => update(defaults), [defaults, update]);

  return [state, update, reset];
}

export default useGameTabState;
