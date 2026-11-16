/** Small helpers shared by the site adapters. */

/** Run `fn` over `items` with at most `limit` promises in flight. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** `19.4K` -> 19400, `1,234` -> 1234, `—` -> null. */
export function parseStarText(text: string | undefined | null): number | null {
  if (!text) return null;
  const match = text
    .replace(/\u00a0/g, " ")
    .replace(/,/g, "")
    .match(/([\d.]+)\s*([kKmM])?/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "k") return Math.round(value * 1_000);
  if (unit === "m") return Math.round(value * 1_000_000);
  return Math.round(value);
}

/** Resolve an href against a site base URL. */
export function absoluteUrl(base: string, href: string | undefined | null): string {
  if (!href) return base;
  try {
    return new URL(href, base).toString();
  } catch {
    return base;
  }
}

/** Collapse whitespace. */
export function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
