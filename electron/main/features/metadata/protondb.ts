/**
 * ProtonDB community compatibility summary.
 * Ported from `protondb.rs`; no key is required.
 */
import { httpText } from "../../lib/http";
import { cached, TTL } from "./cache";

export type ProtonDBTier = "pending" | "borked" | "bronze" | "silver" | "gold" | "platinum";

export interface ProtonDBStatus {
  found: boolean;
  tier: ProtonDBTier;
  provisionalTier?: ProtonDBTier;
  bestReportedTier?: ProtonDBTier;
  trendingTier?: ProtonDBTier;
  confidence?: string;
  score?: number;
  total?: number;
}

const TIERS = new Set(["pending", "borked", "bronze", "silver", "gold", "platinum"]);

function tier(value: unknown): ProtonDBTier | undefined {
  return typeof value === "string" && TIERS.has(value) ? (value as ProtonDBTier) : undefined;
}

export async function fetchProtonDbStatus(appId: number): Promise<ProtonDBStatus> {
  return cached("protondb", String(appId), TTL.protondb, async () => {
    const url = `https://www.protondb.com/api/v1/reports/summaries/${appId}.json`;
    const response = await httpText(url, {
      headers: { Accept: "application/json", "user-agent": "GameIndex/1.0" },
      timeoutMs: 15_000,
      retries: 1,
    });
    if (response.status === 404) {
      return { found: false, tier: "pending" };
    }
    if (!response.ok) {
      throw new Error(`ProtonDB responded HTTP ${response.status}.`);
    }
    const raw = JSON.parse(response.text) as Record<string, unknown>;
    return {
      found: true,
      tier: tier(raw.tier) ?? "pending",
      provisionalTier: tier(raw.provisional_tier),
      bestReportedTier: tier(raw.best_reported_tier),
      trendingTier: tier(raw.trending_tier),
      confidence: typeof raw.confidence === "string" ? raw.confidence : undefined,
      score: typeof raw.score === "number" ? raw.score : undefined,
      total: typeof raw.total === "number" ? raw.total : undefined,
    };
  });
}
