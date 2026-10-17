/**
 * Debrid API key storage.
 *
 * The key used to be persisted in plaintext webview localStorage
 * (`gamelib-debrid-apikey`) while `db/secrets.rs` already documented a
 * dedicated keychain account (`debrid_api_key`) that nothing wrote —
 * exactly the gap GitHub issue #12 footnoted. The key now lives in the
 * OS keychain via `download_get_debrid_key` / `download_set_debrid_key`
 * (see `src-tauri/src/downloads/mod.rs`); this module performs the
 * one-time migration (with a read-back verification before the
 * plaintext copy is dropped) and provides the persistence helper used
 * whenever the key is edited.
 */

export const LEGACY_DEBRID_KEY_STORAGE = "gamelib-debrid-apikey";

/// Minimal structural type so tests can stub `invoke` without importing
/// the Tauri runtime (jsdom tests have no real backend anyway).
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function readLegacyDebridKey(): string {
  try {
    return localStorage.getItem(LEGACY_DEBRID_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

export function setLegacyDebridKey(key: string): void {
  try {
    if (key) localStorage.setItem(LEGACY_DEBRID_KEY_STORAGE, key);
    else localStorage.removeItem(LEGACY_DEBRID_KEY_STORAGE);
  } catch {
    /* storage unavailable (private mode) — the in-memory key still works */
  }
}

export function clearLegacyDebridKey(): void {
  setLegacyDebridKey("");
}

/**
 * Read the keychain, falling back to — and migrating away from — the
 * legacy plaintext copy. Returns the key that should be considered
 * current. Never throws: a failing keychain (web dev, headless, a
 * denied access prompt) degrades to the legacy copy or an empty key.
 */
export async function hydrateDebridKey(invoke: InvokeFn): Promise<string> {
  let restored: string | null = null;
  try {
    restored = await invoke<string | null>("download_get_debrid_key");
  } catch (e) {
    console.warn("[debridKey] keychain unavailable, using legacy storage:", e);
  }

  const legacy = readLegacyDebridKey();

  if (restored && restored.length > 0) {
    if (legacy) clearLegacyDebridKey();
    return restored;
  }

  if (legacy) {
    try {
      await invoke("download_set_debrid_key", { apiKey: legacy });
      const verified = await invoke<string | null>("download_get_debrid_key");
      if (verified === legacy) {
        // Written and confirmed readable: only now drop the plaintext copy.
        clearLegacyDebridKey();
      } else {
        console.warn(
          "[debridKey] keychain verification failed; keeping the legacy copy",
        );
      }
    } catch (e) {
      console.warn("[debridKey] keychain write failed; keeping the legacy copy:", e);
    }
    return legacy;
  }

  return "";
}

/**
 * Persist a key edit to the keychain. Returns `true` on a verified
 * write, `false` when the caller should fall back to legacy storage
 * (the key still applies to the running engine; it just could not be
 * durably stored).
 */
export async function persistDebridKey(invoke: InvokeFn, key: string): Promise<boolean> {
  if (!key) {
    try {
      await invoke("download_set_debrid_key", { apiKey: key });
      return true;
    } catch (e) {
      console.warn("[debridKey] keychain delete failed:", e);
      return false;
    }
  }
  try {
    await invoke("download_set_debrid_key", { apiKey: key });
    const verified = await invoke<string | null>("download_get_debrid_key");
    if (verified !== key) {
      console.warn("[debridKey] keychain verification failed:", key);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[debridKey] keychain write failed:", e);
    return false;
  }
}
