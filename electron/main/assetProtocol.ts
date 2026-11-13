/**
 * The `giasset://` protocol is the Electron replacement for Tauri's asset
 * protocol: `convertFileSrc()` in the renderer produces
 *
 *     giasset://local/<percent-encoded absolute path>
 *
 * and this handler streams the file from disk. It is registered as a standard,
 * secure scheme so that `<img>`, `<video>`, `<audio>`, HLS and canvas consumers
 * all treat it like a normal HTTP origin (range requests included).
 *
 * Security note: the renderer is trusted application code, so any absolute
 * path is served. If the UI ever renders untrusted remote HTML in a window with
 * this protocol enabled, restrict `raw` to the app-data / pictures / video
 * roots the way `tauri.conf.json` did.
 */
import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { filePathFromAssetUrl } from "./lib/assetPath";

export const ASSET_SCHEME = "giasset";

/** Must run before `app.whenReady()` resolves. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Install the request handler (after the app is ready). */
export function installAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const filePath = filePathFromAssetUrl(request.url);
      if (!filePath) {
        return new Response("Missing asset path", { status: 400 });
      }
      const fileUrl = pathToFileURL(filePath).toString();
      return await net.fetch(fileUrl, {
        headers: request.headers,
        bypassCustomProtocolHandlers: true,
      });
    } catch (error) {
      console.error("[asset-protocol] failed to serve", request.url, error);
      return new Response("Asset not found", { status: 404 });
    }
  });
}
