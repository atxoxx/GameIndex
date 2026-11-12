/**
 * The generic JSON-document table that replaces `<userData>/<name>.json`.
 *
 * Every feature domain owns a `documents (name, json, updated_at)` table (see
 * `schema.ts`). `state/sqliteStore.ts` uses these helpers for domains whose
 * document shape has no clean table mapping, and a few call sites use the
 * text form directly because the renderer owns the payload verbatim.
 *
 * Writes are synchronous and single-statement: the surrounding feature code
 * already treats a store write as durable when it returns, which is why the
 * old JSON store wrote temp-file + rename rather than debouncing.
 */
import type { DbDomain } from "./schema";
import { prepare } from "./sqlite";

/** Raw JSON text of a document, or `null` when the name was never written. */
export function readDocumentRow(domain: DbDomain, name: string): string | null {
  const row = prepare(
    domain,
    "SELECT json FROM documents WHERE name = ?",
  ).get(name) as { json?: unknown } | undefined;
  return typeof row?.json === "string" ? row.json : null;
}

/** Parsed document, or `null` when absent or unparseable. */
export function readDocumentJson<T>(domain: DbDomain, name: string): T | null {
  const raw = readDocumentRow(domain, name);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null ? null : (parsed as T);
  } catch (error) {
    console.error(`[documents] ${domain}/${name} is not valid JSON:`, error);
    return null;
  }
}

/** Replace one document (JSON-encoded) without touching its neighbours. */
export function writeDocumentJson(
  domain: DbDomain,
  name: string,
  value: unknown,
): void {
  const json = JSON.stringify(value);
  writeDocumentText(domain, name, json);
}

/** Replace one document with caller-supplied text (must already be JSON). */
export function writeDocumentText(
  domain: DbDomain,
  name: string,
  content: string,
): void {
  prepare(
    domain,
    `INSERT INTO documents(name, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  ).run(name, content, Date.now());
}

/** Read a document as text, returning `fallback` when it was never written. */
export function readDocumentText(
  domain: DbDomain,
  name: string,
  fallback: string,
): string {
  return readDocumentRow(domain, name) ?? fallback;
}

/** Remove a document (used by "disconnect"/"forget" actions). */
export function deleteDocument(domain: DbDomain, name: string): void {
  prepare(domain, "DELETE FROM documents WHERE name = ?").run(name);
}
