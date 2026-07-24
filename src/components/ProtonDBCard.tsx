import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProtonDBStatus, ProtonDBTier } from "../types/game";
import { useLanguage } from "../context/LanguageContext";

interface ProtonDBCardProps {
  /** Steam appid, e.g. 730 for CS2. When undefined the card is hidden. */
  steamAppId?: number;
}

/** Visual + label metadata for each ProtonDB tier. */
const TIER_META: Record<
  ProtonDBTier,
  { labelKey: string; color: string; bg: string; helpKey: string }
> = {
  platinum: {
    labelKey: "protondb.tier.platinum",
    color: "#e5e4e2",
    bg: "rgba(229,228,226,0.14)",
    helpKey: "protondb.help.platinum",
  },
  gold: {
    labelKey: "protondb.tier.gold",
    color: "#ffd24a",
    bg: "rgba(255,210,74,0.14)",
    helpKey: "protondb.help.gold",
  },
  silver: {
    labelKey: "protondb.tier.silver",
    color: "#c0c0c8",
    bg: "rgba(192,192,200,0.14)",
    helpKey: "protondb.help.silver",
  },
  bronze: {
    labelKey: "protondb.tier.bronze",
    color: "#cd7f32",
    bg: "rgba(205,127,50,0.16)",
    helpKey: "protondb.help.bronze",
  },
  borked: {
    labelKey: "protondb.tier.borked",
    color: "var(--color-danger)",
    bg: "color-mix(in srgb, var(--color-danger) 16%, transparent)",
    helpKey: "protondb.help.borked",
  },
  pending: {
    labelKey: "protondb.tier.pending",
    color: "var(--color-text-muted)",
    bg: "rgba(127,127,140,0.12)",
    helpKey: "protondb.help.pending",
  },
};

/** Lower is worse, used to pick a fallback when a tier is "pending". */
function tierValue(t: ProtonDBTier | undefined): number {
  switch (t) {
    case "platinum": return 5;
    case "gold": return 4;
    case "silver": return 3;
    case "bronze": return 2;
    case "borked": return 0;
    default: return -1;
  }
}

function confidenceLabelKey(c?: ProtonDBStatus["confidence"]): string {
  switch (c) {
    case "inadequate": return "protondb.confidence.inadequate";
    case "low": return "protondb.confidence.low";
    case "moderate": return "protondb.confidence.moderate";
    case "high": return "protondb.confidence.high";
    case "strong": return "protondb.confidence.strong";
    default: return "protondb.confidence.unknown";
  }
}

/** Fetch the ProtonDB summary for an appid via the Tauri command. The
 *  command fetches server-side (ProtonDB restricts CORS to its own
 *  origin), and returns `found: false` when the game has no reports. */
async function fetchProtonDB(appId: number): Promise<ProtonDBStatus> {
  return invoke<ProtonDBStatus>("fetch_protondb_status", { appId });
}

export default function ProtonDBCard({ steamAppId }: ProtonDBCardProps) {
  const { t } = useLanguage();
  const [data, setData] = useState<ProtonDBStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!steamAppId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProtonDB(steamAppId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [steamAppId]);

  // Hide when there's no appid, while loading, or on error.
  if (!steamAppId || loading || error || !data) return null;

  // A game with no reports yet is not worth a full card — keep the side
  // column uncluttered.
  if (!data.found) return null;

  // Prefer the official tier; fall back to the provisional estimate when
  // the official verdict is still "pending".
  const effectiveTier: ProtonDBTier =
    data.tier === "pending" && data.provisionalTier
      ? data.provisionalTier
      : data.tier;

  const meta = TIER_META[effectiveTier];
  const trendMismatch =
    data.trendingTier &&
    data.trendingTier !== data.tier &&
    tierValue(data.trendingTier) !== tierValue(data.tier) &&
    tierValue(data.trendingTier) !== tierValue(data.provisionalTier);

  const protonUrl = `https://www.protondb.com/app/${steamAppId}`;
  const reportsUrl = `https://www.protondb.com/app/${steamAppId}#reports`;

  return (
    <section className="game-section pdb-card">
      <h2 className="game-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" />
        </svg>
        {t("protondb.title")}
      </h2>

      <div className="pdb-card-body">
        {/* Tier badge */}
        <div
          className="pdb-tier-badge"
          style={{ background: meta.bg, borderColor: meta.color }}
          title={t(meta.helpKey)}
        >
          <span className="pdb-tier-dot" style={{ background: meta.color }} />
          <span className="pdb-tier-label" style={{ color: meta.color }}>
            {t(meta.labelKey)}
          </span>
        </div>

        {/* Meta rows */}
        <div className="pdb-meta-grid">
          <div className="pdb-meta-row">
            <span className="pdb-meta-label">{t("protondb.confidence")}</span>
            <span className="pdb-meta-val">
              {t(confidenceLabelKey(data.confidence))}
            </span>
          </div>
          <div className="pdb-meta-row">
            <span className="pdb-meta-label">{t("protondb.reports")}</span>
            <span className="pdb-meta-val">
              {data.total != null ? data.total.toLocaleString() : "—"}
            </span>
          </div>
          {typeof data.score === "number" && (
          <div className="pdb-meta-row">
            <span className="pdb-meta-label">{t("protondb.score")}</span>
              <span className="pdb-meta-val">
                {Math.round(data.score * 100)}%
              </span>
            </div>
          )}
          {data.bestReportedTier && data.bestReportedTier !== effectiveTier && (
            <div className="pdb-meta-row">
              <span className="pdb-meta-label">{t("protondb.bestReported")}</span>
              <span
                className="pdb-meta-val"
                style={{ color: TIER_META[data.bestReportedTier].color }}
              >
                {t(TIER_META[data.bestReportedTier].labelKey)}
              </span>
            </div>
          )}
        </div>

        {/* Trending note */}
        {trendMismatch && data.trendingTier && (
          <div className="pdb-trend-note">
            <span className="pdb-trend-dot" />
            {t("protondb.trending", {
              tier: t(TIER_META[data.trendingTier].labelKey),
            })}
          </div>
        )}

        {/* Links */}
        <div className="pdb-links">
          <a
            href={protonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pdb-source-link"
            title={t("protondb.viewOn")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {t("protondb.page")}
          </a>
          <a
            href={reportsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pdb-source-link"
            title={t("protondb.readReports")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {t("protondb.reportsLink")}
          </a>
        </div>
      </div>
    </section>
  );
}
