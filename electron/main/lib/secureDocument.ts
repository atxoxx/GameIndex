/**
 * Encrypted key/value documents for integration credentials.
 *
 * Uses Electron `safeStorage` when the OS keyring is available and records the
 * mode so a profile moved between machines degrades to "reconnect" instead of
 * crashing or silently leaking. Values live in the `kv` domain beside the
 * Steam session.
 */
import { safeStorage } from "electron";
import {
  deleteDocument,
  readDocumentText,
  writeDocumentText,
} from "../state/db/documents";

interface StoredSecret {
  version: 1;
  encrypted: boolean;
  payload: string;
  savedAt: string;
}

export function readSecret<T>(name: string): T | null {
  let stored: StoredSecret;
  try {
    stored = JSON.parse(readDocumentText("kv", name, "")) as StoredSecret;
  } catch {
    return null;
  }
  if (!stored || typeof stored.payload !== "string") return null;
  try {
    const json =
      stored.encrypted
        ? safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(stored.payload, "base64"))
          : null
        : stored.payload;
    if (json === null) {
      console.warn(`[secrets] ${name} is encrypted but no OS keyring is available`);
      return null;
    }
    return JSON.parse(json) as T;
  } catch (error) {
    console.warn(`[secrets] could not read ${name}:`, error);
    return null;
  }
}

export function writeSecret(name: string, value: unknown): void {
  const json = JSON.stringify(value);
  const canEncrypt = safeStorage.isEncryptionAvailable();
  const stored: StoredSecret = {
    version: 1,
    encrypted: canEncrypt,
    payload: canEncrypt ? safeStorage.encryptString(json).toString("base64") : json,
    savedAt: new Date().toISOString(),
  };
  writeDocumentText("kv", name, JSON.stringify(stored, null, 2));
}

export function deleteSecret(name: string): void {
  deleteDocument("kv", name);
}
