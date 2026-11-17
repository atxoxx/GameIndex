/**
 * Shared collators for hot sort paths.
 *
 * `String.prototype.localeCompare` constructs a collator on every call, which
 * is measurable when sorting a large library on every filter change. These are
 * module-level singletons with the same defaults as the calls they replace.
 */
const defaultCollator = new Intl.Collator();
const baseCollator = new Intl.Collator(undefined, { sensitivity: "base" });

/** Equivalent to `a.localeCompare(b)` with the runtime's default locale. */
export function compareText(a: string, b: string): number {
  return defaultCollator.compare(a, b);
}

/** Equivalent to `a.localeCompare(b, undefined, { sensitivity: "base" })`. */
export function compareTextBase(a: string, b: string): number {
  return baseCollator.compare(a, b);
}
