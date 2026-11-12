/**
 * Friends / Nostr persistence.
 *
 * The renderer keeps its own friend graph as an opaque JSON document and only
 * asks the backend to persist it, so this module is intentionally dumb about
 * the schema (`src/pages/friendsStorage.ts` owns it).
 *
 * The Nostr signing key is the one sensitive value: losing it rotates the
 * user's identity, so it is encrypted with Electron's `safeStorage` when the OS
 * keyring is available and stored in `kv.db` (`documents`). Nothing is ever
 * written to `localStorage`.
 */
import { safeStorage } from "electron";
import { deleteDocument, readDocumentText, writeDocumentText } from "../../state/db/documents";
import { createSqliteStore } from "../../state/sqliteStore";
import { userDataPath } from "../../lib/paths";

const DB_FILE = "friends-db.json";

interface SecretDocument {
  nostrPrivkey: string | null;
}

const secrets = createSqliteStore<SecretDocument>({
  domain: "kv",
  document: "friends-secrets",
  createDefault: () => ({ nostrPrivkey: null }),
  normalize: (doc) => (doc && typeof doc === "object" ? doc : { nostrPrivkey: null }),
});

/** Location of the pre-SQLite renderer document (parked on first run). */
export function friendsDbPath(): string {
  return userDataPath(DB_FILE);
}

/** Raw JSON text, exactly as the renderer round-trips it. */
export function loadFriendsDb(): string {
  try {
    return readDocumentText("kv", "friends-db", "");
  } catch (error) {
    console.error("[friends] failed to read database:", error);
    return "";
  }
}

export function saveFriendsDb(content: unknown): void {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? {});
  writeDocumentText("kv", "friends-db", text);
}

/** Drop the stored graph (used when the renderer resets friends). */
export function clearFriendsDb(): void {
  deleteDocument("kv", "friends-db");
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function getNostrPrivkey(): string | null {
  const stored = secrets.read().nostrPrivkey;
  if (!stored) return null;
  if (!stored.startsWith("enc:v1:")) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice("enc:v1:".length), "base64"));
  } catch (error) {
    console.error("[friends] could not decrypt the Nostr key:", error);
    return null;
  }
}

export function setNostrPrivkey(hex: unknown): void {
  const value = String(hex ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("A Nostr private key must be 64 hexadecimal characters.");
  }
  const payload = canEncrypt()
    ? `enc:v1:${safeStorage.encryptString(value).toString("base64")}`
    : value;
  secrets.update((doc) => ({ ...doc, nostrPrivkey: payload }));
}
