import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initNostrKeys } from "./pages/friendsStorage";
import "./styles/theme.css";
import "./styles/themes.css";
import "./index.css";
import "./styles/animations.css";
import "./styles/ui.css";
import "./styles/store-discover.css";
import "./styles/wishlist.css";
import "./styles/download.css";
import "./library.css";
import "./styles/home.css";
import "./pages/deals/DealsPage.css";
import "./styles/bigscreen.css";
import "./styles/store-polish.css";

// The friends page resolves its Nostr signing key synchronously from an
// in-memory cache, so hydrate it from the backend kv_store before the first
// render. Non-fatal: any failure just falls back to the legacy path.
async function bootstrap() {
  try {
    await initNostrKeys();
  } catch {
    /* non-fatal */
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
