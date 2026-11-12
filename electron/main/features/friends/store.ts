/**
 * Friends / Nostr persistence.
 *
 * The renderer keeps its own friend graph as an opaque JSON document and only
 * asks the backend to persist it, so this module is intentionally dumb about
 * the schema (`src/pages/friendsStorage.ts` owns it).
 *
 * The Nostr signing key is the one sensitive value: losing it rotates the
 * user's identity, so it is encrypted with Electron's `safeStorage` when the OS
 * keyring is available and stored under `userData`. Nothing is ever written to
 * `localStorage`.
 */
import { safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createJsonStore } from "../../state/jsonStore";
import { userDataPath } from "../../lib/paths";

const DB_FILE = "friends-db.json";

interface SecretDocument {
  nostrPrivkey: string | null;
}

const secrets = createJsonStore<SecretDocument>(
  "friends-secrets.json",
  () => ({ nostrPrivkey: null }),
  (doc) => (doc && typeof doc === "object" ? doc : { nostrPrivkey: null }),
);

export function friendsDbPath(): string {
  return userDataPath(DB_FILE);
}

/** Raw JSON text, exactly as the renderer round-trips it. */
export function loadFriendsDb(): string {
  try {
    return fs.readFileSync(friendsDbPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    console.error("[friends] failed to read database:", error);
    return "";
  }
}

export function saveFriendsDb(content: unknown): void {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? {});
  const target = friendsDbPath();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, target);
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
