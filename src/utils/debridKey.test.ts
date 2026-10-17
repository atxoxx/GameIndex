import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_DEBRID_KEY_STORAGE,
  clearLegacyDebridKey,
  hydrateDebridKey,
  persistDebridKey,
  readLegacyDebridKey,
  type InvokeFn,
} from "./debridKey";

function memoryStoreCapsule(initial: Record<string, string | null> = {}) {
  const store = new Map<string, string | null>(Object.entries(initial));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.set(k, null),
  };
}

/** An invoke stub backed by an in-memory keychain, mirroring the two commands.
 *  `silentSetFailure` makes writes a no-op without erroring — the "mock store
 *  trap" keyring falls into without a native backend (see db/secrets.rs). */
function storeInvoke(keychain: Map<string, string>, failSet = false, silentSetFailure = false): InvokeFn {
  return (async <T>(cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "download_get_debrid_key") {
      return (keychain.get("debrid_api_key") ?? null) as T;
    }
    if (cmd === "download_set_debrid_key") {
      if (failSet) throw new Error("keychain backend down");
      if (!silentSetFailure) {
        const k = args?.apiKey;
        if (typeof k === "string" && k.length > 0) keychain.set("debrid_api_key", k);
        else keychain.delete("debrid_api_key");
      }
      return undefined as T;
    }
    throw new Error(`unexpected command: ${cmd}`);
  }) as InvokeFn;
}

describe("debrid key migration", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStoreCapsule());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates a legacy plaintext key into the keychain and clears localStorage", async () => {
    const keychain = new Map<string, string>();
    localStorage.setItem(LEGACY_DEBRID_KEY_STORAGE, "old-plain-key");

    const key = await hydrateDebridKey(storeInvoke(keychain));

    expect(key).toBe("old-plain-key");
    expect(keychain.get("debrid_api_key")).toBe("old-plain-key");
    expect(readLegacyDebridKey()).toBe("");
  });

  it("prefers the keychain and drops a stale legacy copy", async () => {
    const keychain = new Map<string, string>([["debrid_api_key", "fresh-key"]]);
    localStorage.setItem(LEGACY_DEBRID_KEY_STORAGE, "stale-key");

    const key = await hydrateDebridKey(storeInvoke(keychain));

    expect(key).toBe("fresh-key");
    expect(readLegacyDebridKey()).toBe("");
  });

  it("keeps the legacy copy when the keychain write fails", async () => {
    const keychain = new Map<string, string>();
    localStorage.setItem(LEGACY_DEBRID_KEY_STORAGE, "survivor");

    const key = await hydrateDebridKey(storeInvoke(keychain, true));

    expect(key).toBe("survivor");
    expect(readLegacyDebridKey()).toBe("survivor");
    expect(keychain.get("debrid_api_key")).toBeUndefined();
  });

  it("keeps the legacy copy when the write silently does not persist", async () => {
    const keychain = new Map<string, string>();
    localStorage.setItem(LEGACY_DEBRID_KEY_STORAGE, "neverdrop");

    const key = await hydrateDebridKey(storeInvoke(keychain, false, true));

    expect(key).toBe("neverdrop");
    expect(readLegacyDebridKey()).toBe("neverdrop");
    expect(keychain.get("debrid_api_key")).toBeUndefined();
  });

  it("returns an empty key when nothing is stored anywhere", async () => {
    expect(await hydrateDebridKey(storeInvoke(new Map()))).toBe("");
  });

  it("still returns the legacy key when the keychain read itself errors", async () => {
    localStorage.setItem(LEGACY_DEBRID_KEY_STORAGE, "fallback");
    const invoke = vi.fn().mockRejectedValue(new Error("no runtime")) as unknown as InvokeFn;

    expect(await hydrateDebridKey(invoke)).toBe("fallback");
    expect(readLegacyDebridKey()).toBe("fallback");
  });
});

describe("persistDebridKey", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStoreCapsule());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports success on a verified keychain write and clears the legacy copy", async () => {
    const keychain = new Map<string, string>();
    localStorage.setItem(LEGACY_DEBRID_KEY_STORAGE, "old");

    expect(await persistDebridKey(storeInvoke(keychain), "new-key")).toBe(true);
    expect(keychain.get("debrid_api_key")).toBe("new-key");

    // The caller clears the legacy copy only after a verified write.
    clearLegacyDebridKey();
    expect(await persistDebridKey(storeInvoke(keychain), "")).toBe(true);
    expect(keychain.get("debrid_api_key")).toBeUndefined();
  });

  it("reports failure when the keychain cannot persist", async () => {
    const keychain = new Map<string, string>();
    expect(await persistDebridKey(storeInvoke(keychain, true), "new-key")).toBe(false);
    expect(keychain.get("debrid_api_key")).toBeUndefined();
  });
});
