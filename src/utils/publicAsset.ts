/**
 * Resolve an asset that lives in `public/` (emulator logos, placeholder
 * artwork, ...) to a URL the renderer can actually load.
 *
 * Vite serves `public/` at the site root in development, which makes a
 * root-absolute path such as `/emulator-logos/rpcs3.svg` work there. The
 * packaged renderer is loaded from `file:///.../out/renderer/index.html`,
 * where a leading slash resolves against the *drive* root
 * (`file:///C:/emulator-logos/...`) and the request fails - that is why the
 * emulator icons were broken in the compiled app. Catalog entries therefore
 * store the path relative to the page (`emulator-logos/rpcs3.svg`), and any
 * value still in the old absolute form (rows already written to the
 * database before this change) is normalised here.
 *
 * Complete URLs are returned untouched: `data:`, `http(s):`, `giasset:`
 * (stored artwork), `blob:` and protocol-relative `//host/...` values, plus
 * absolute Windows paths (`C:\...`) which already start with a drive letter.
 */
export function resolvePublicAssetUrl(
  url: string | null | undefined
): string | undefined {
  const value = url?.trim();
  if (!value) return undefined;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value;

  const relative = value.replace(/^\/+/, "");
  const base =
    typeof window === "undefined" ? "http://localhost/" : window.location.href;
  return new URL(relative, base).toString();
}
