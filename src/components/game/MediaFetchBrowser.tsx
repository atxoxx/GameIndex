import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameMetadataResult, LaunchBoxImageResult } from "../../types/game";
import type { SgdbAssets } from "../../types/steamgriddb";
import { Button } from "../ui";
import "./EditGameModal.css";

type MediaSlot = "icon" | "cover" | "hero" | "logo";

interface Candidate {
  url: string;
  source: string;
  mime?: string | null;
  resolution?: string;
  region?: string | null;
}

interface MediaFetchBrowserProps {
  slot: MediaSlot;
  gameName: string;
  steamAppId?: number;
  onApply: (url: string) => Promise<void>;
  onClose: () => void;
}

const SLOT_LABEL: Record<MediaSlot, string> = {
  icon: "Icon",
  cover: "Cover",
  hero: "Hero",
  logo: "Logo",
};

const ALLOWED_EXT = /\.(jpe?g|png|webp)(\?|$)/i;
const ALLOWED_MIME = /^image\/(jpe?g|png|webp)$/i;

function allowed(url: string, mime?: string | null): boolean {
  if (mime && ALLOWED_MIME.test(mime)) return true;
  return ALLOWED_EXT.test(url);
}

function metadataUrlsForSlot(slot: MediaSlot, img: GameMetadataResult["images"]): string[] {
  switch (slot) {
    case "icon":
      return [img.icon ?? ""];
    case "cover":
      return [img.cover ?? ""];
    case "hero":
      return [img.hero ?? "", img.banner ?? ""];
    case "logo":
      return [img.logo ?? "", img.icon ?? ""];
  }
}

/** Keyword buckets mapping LaunchBox image categories to media slots.
 *  Matched case-insensitively against the category heading (e.g. "Box -
 *  Front", "Banner", "Clear Logo", "Steam Grid"). */
const LAUNCHBOX_CATEGORY_KEYWORDS: Record<MediaSlot, string[]> = {
  icon: ["icon"],
  cover: ["box - front", "box front", "steam grid", "cover"],
  hero: ["banner", "fanart", "background", "hero"],
  logo: ["clear logo", "logo"],
};

function launchboxMatchesSlot(category: string, slot: MediaSlot): boolean {
  const cat = category.toLowerCase();
  return LAUNCHBOX_CATEGORY_KEYWORDS[slot].some((k) => cat.includes(k));
}

/** Fetch candidate images for a single media slot across Steam, IGDB and
 *  SteamGridDB, restricted to jpg/jpeg/png/webp. Filters by extension and
 *  MIME where available, dedupes URLs, and preserves a stable source order. */
async function collectCandidates(
  slot: MediaSlot,
  gameName: string,
  steamAppId?: number
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (url?: string | null, source?: string, mime?: string | null, extra?: Partial<Candidate>) => {
    if (!url) return;
    if (seen.has(url)) return;
    if (!allowed(url, mime)) return;
    seen.add(url);
    out.push({ url, source: source || "Web", mime, ...extra });
  };

  // Steam + IGDB metadata (LaunchBox excluded from the metadata scrape).
  try {
    const results: GameMetadataResult[] = await invoke("search_game_metadata", {
      gameName,
      skipLaunchbox: true,
      steamAppId,
    });
    for (const r of results) {
      for (const u of metadataUrlsForSlot(slot, r.images)) {
        push(u, r.sourceName);
      }
    }
  } catch {
    /* metadata source unavailable — fall through to SteamGridDB */
  }

  // SteamGridDB community art (grid serves cover + logo fallback, hero wide art).
  if (steamAppId) {
    try {
      const assets = await invoke<SgdbAssets | null>("sgdb_get_assets", {
        steamAppId,
      });
      if (assets) {
        if (slot === "cover") {
          push(assets.gridUrl, "SteamGridDB", assets.gridMime);
          push(assets.gridAnimatedUrl, "SteamGridDB", assets.gridAnimatedMime);
        } else if (slot === "hero") {
          push(assets.heroUrl, "SteamGridDB", assets.heroMime);
          push(assets.heroAnimatedUrl, "SteamGridDB", assets.heroAnimatedMime);
        } else if (slot === "logo") {
          push(assets.gridUrl, "SteamGridDB", assets.gridMime);
        }
      }
    } catch {
      /* SteamGridDB key/call unavailable — the gallery still shows Steam/IGDB */
    }
  }

  return out;
}

/** Fetch LaunchBox Games Database images and keep only those whose category
 *  maps to the requested slot. Optional source — gated by the modal toggle. */
async function collectLaunchboxCandidates(
  slot: MediaSlot,
  gameName: string
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  try {
    const images: LaunchBoxImageResult[] = await invoke("search_launchbox_images", {
      gameName,
    });
    for (const img of images) {
      if (!launchboxMatchesSlot(img.category, slot)) continue;
      if (!allowed(img.url)) continue;
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      out.push({
        url: img.url,
        source: "LaunchBox",
        resolution: img.resolution,
        region: img.region,
      });
    }
  } catch {
    /* LaunchBox scrape failed — the modal simply shows the other sources */
  }
  return out;
}

/** Modal media browser for the edit-game image slots. Opened from a slot's
 *  "Fetch" button; gathers candidate images for that category from Steam,
 *  IGDB, SteamGridDB and LaunchBox automatically, shows only
 *  jpg/jpeg/png/webp with a normalized preview, and applies a selection by
 *  downloading it to a data URL. */
export function MediaFetchBrowser({
  slot,
  gameName,
  steamAppId,
  onApply,
  onClose,
}: MediaFetchBrowserProps) {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [launchboxCandidates, setLaunchboxCandidates] = useState<Candidate[]>([]);
  const [applyingUrl, setApplyingUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [result, lbResult] = await Promise.all([
        collectCandidates(slot, gameName, steamAppId),
        collectLaunchboxCandidates(slot, gameName),
      ]);
      if (!cancelled) {
        setCandidates(result);
        setLaunchboxCandidates(lbResult);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slot, gameName, steamAppId]);

  const allCandidates = useMemo(
    () => [...candidates, ...launchboxCandidates],
    [candidates, launchboxCandidates]
  );

  const grouped = useMemo(() => {
    const order = ["Steam", "IGDB", "SteamGridDB", "LaunchBox"];
    const map = new Map<string, Candidate[]>();
    for (const c of allCandidates) {
      const list = map.get(c.source) ?? [];
      list.push(c);
      map.set(c.source, list);
    }
    return Array.from(map.entries()).sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
    );
  }, [allCandidates]);

  async function handleApply(url: string) {
    setApplyingUrl(url);
    try {
      await onApply(url);
      onClose();
    } catch {
      /* parent shows the toast */
    } finally {
      setApplyingUrl(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal lb-browser-modal media-fetch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M3 3h2v2M21 3h-2v2M3 21h2v-2M21 21h-2v-2" /><path d="M12 1v2M12 21v2M1 12h2M21 12h2" /></svg>
          </div>
          <div className="modal-header-text">
            <h3 className="modal-title">Fetch {SLOT_LABEL[slot]}</h3>
            <p className="modal-subtitle">
              Pick a {SLOT_LABEL[slot].toLowerCase()} from Steam, IGDB, SteamGridDB and LaunchBox
            </p>
          </div>
          <button className="metadata-panel-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="lb-browser-body media-fetch-body">
          {loading ? (
            <div className="metadata-loading">
              <div className="metadata-spinner" />
              <p>Searching for {SLOT_LABEL[slot].toLowerCase()} media…</p>
            </div>
          ) : grouped.length === 0 ? (
            <div className="metadata-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
              <p>No {SLOT_LABEL[slot].toLowerCase()} images found for this title.</p>
            </div>
          ) : (
            grouped.map(([source, list]) => (
              <div key={source} className="media-fetch-source">
                <div className="media-fetch-source-header">
                  <span className="media-fetch-source-name">{source}</span>
                  <span className="media-fetch-source-count">{list.length}</span>
                </div>
                <div className="media-fetch-grid">
                  {list.map((c) => (
                    <div key={c.url} className="media-fetch-card">
                      <div className="media-fetch-thumb">
                        <img src={c.url} alt={`${source} ${SLOT_LABEL[slot]}`} loading="lazy" />
                        {(c.mime && c.mime.includes("apng")) || /\.apng$/i.test(c.url) ? (
                          <span className="media-fetch-badge">animated</span>
                        ) : null}
                      </div>
                      <div className="media-fetch-card-meta">
                        <span className="media-fetch-fmt">
                          {c.mime ? c.mime.replace("image/", "") : (c.url.split("?")[0].split(".").pop() || "img")}
                        </span>
                        {c.resolution && <span className="media-fetch-res"> · {c.resolution}</span>}
                        {c.region && <span className="media-fetch-res"> · {c.region}</span>}
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={applyingUrl !== null}
                        isLoading={applyingUrl === c.url}
                        onClick={() => handleApply(c.url)}
                      >
                        Set as {SLOT_LABEL[slot]}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {allCandidates.length} candidate{allCandidates.length === 1 ? "" : "s"}
          </span>
          <div className="modal-footer-actions">
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>
  );
}