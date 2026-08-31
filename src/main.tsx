import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initNostrKeys } from "./pages/friendsStorage";
import "./index.css";
import "./styles/animations.css";
import "./styles/ui.css";
import "./styles/store-discover.css";
import "./styles/wishlist.css";
import "./styles/download.css";
import "./library.css";
import "./styles/home.css";
import "./pages/deals/DealsPage.css";
import "./styles/store-polish.css";

// The friends page resolves its Nostr signing key lazily via `getNostrKeys`,
// which falls back to a session-stable placeholder when the backend key
// isn't loaded yet. So hydration can run in the background instead of
// blocking the first render — a slow kv_store read must never delay the
// app shell from painting.
async function bootstrap() {
  // Fire-and-forget: hydrate the Nostr key cache when reachable, but never
  // gate first paint on it. Any failure is non-fatal and flows through the
  // legacy/placeholder fallback path.
  void initNostrKeys().catch(() => {});
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();