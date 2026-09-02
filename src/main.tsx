import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./styles/animations.css";
import "./styles/ui.css";
// Shared feature stylesheets: loaded globally because the components they
// style (DownloadModal/DownloadButton, store cards + density toggle, ...)
// render on many routes, not just the pages that used to import them.
import "./styles/store-discover.css";
import "./styles/store-polish.css";
import "./styles/download.css";

// The friends page resolves its Nostr signing key lazily via `getNostrKeys`,
// which falls back to a session-stable placeholder when the backend key
// isn't loaded yet. So hydration can run in the background instead of
// blocking the first render — a slow kv_store read must never delay the
// app shell from painting.
//
// friendsStorage is imported dynamically (not statically) so the
// nostr-tools stack (~190 KB) never lands in the startup bundle: it is
// split into its own async chunk that only loads in the background after
// bootstrap, and on the rare occasion the user opens the Friends page
// before it has landed, `getNostrKeys` degrades to the session fallback.
async function bootstrap() {
  // Fire-and-forget: hydrate the Nostr key cache when reachable, but never
  // gate first paint on it. Any failure is non-fatal and flows through the
  // legacy/placeholder fallback path.
  void import("./pages/friendsStorage")
    .then((m) => m.initNostrKeys())
    .catch(() => {});
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();