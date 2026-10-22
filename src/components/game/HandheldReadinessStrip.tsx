// Handheld readiness strip — the compact Deck verdict shown inside the
// Big Screen (handheld) game page. The full ProtonDB card lives on the
// desktop game page; on a 7" screen there's no room for its report
// breakdown, so this strip carries the one thing that matters in the
// shell: "will this run, and how well".

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Gamepad2 } from "lucide-react";
import type { Game, ProtonDBStatus, ProtonDBTier } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { gameDisplayName } from "../../types/game";

interface HandheldReadinessStripProps {
  game: Game;
}

const VERDICT_KEY: Record<ProtonDBTier, string> = {
  platinum: "handheld.readiness.verdict.platinum",
  gold: "handheld.readiness.verdict.gold",
  silver: "handheld.readiness.verdict.silver",
  bronze: "handheld.readiness.verdict.bronze",
  borked: "handheld.readiness.verdict.borked",
  pending: "handheld.readiness.verdict.pending",
};

function normalizeTier(value?: string | null): ProtonDBTier {
  switch ((value || "").toLowerCase()) {
    case "platinum":
    case "gold":
    case "silver":
    case "bronze":
    case "borked":
    case "pending":
      return value!.toLowerCase() as ProtonDBTier;
    default:
      return "pending";
  }
}

export default function HandheldReadinessStrip({ game }: HandheldReadinessStripProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ProtonDBStatus | null>(null);
  const appId = game.steamAppId;

  useEffect(() => {
    if (!appId) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    invoke<ProtonDBStatus>("fetch_protondb_status", { appId })
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const tier = useMemo(() => {
    if (!status?.found) return null;
    if (normalizeTier(status.tier) === "pending" && status.provisionalTier) {
      return normalizeTier(status.provisionalTier);
    }
    return normalizeTier(status.tier);
  }, [status]);

  // No Steam link or no reports: stay out of the way rather than show a
  // misleading "unknown" verdict in the shell.
  if (!tier) return null;

  const label = t(`protondb.tier.${tier}`);

  return (
    <div
      className="bigscreen-handheld-readiness"
      data-tier={tier}
      title={`${gameDisplayName(game)} · ${label}`}
    >
      <span className="bigscreen-handheld-readiness__icon" aria-hidden>
        <Gamepad2 size={14} />
      </span>
      <span className="bigscreen-handheld-readiness__label">
        {t("handheld.readiness.title")}
      </span>
      <span className="bigscreen-handheld-readiness__tier">{label}</span>
      <span className="bigscreen-handheld-readiness__verdict">
        {t(VERDICT_KEY[tier])}
      </span>
    </div>
  );
}
