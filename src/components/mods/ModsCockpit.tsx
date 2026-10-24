// Mods cockpit — the library summary above the rail. One lead figure for
// "how much of my library is modded", then four quiet metrics. Every number
// that can be acted on is a button, not a decoration.

import {
  ArrowUpCircle,
  CheckCircle2,
  Gamepad2,
  HardDrive,
  Layers,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

interface ModsCockpitProps {
  moddedGames: number;
  totalGames: number;
  totalMods: number;
  enabledMods: number;
  activeRatio: number;
  updates: number;
  storageLabel: string;
  onToggleModded: () => void;
  onOpenUpdates: () => void;
  onFilterAll: () => void;
}

export default function ModsCockpit({
  moddedGames,
  totalGames,
  totalMods,
  enabledMods,
  activeRatio,
  updates,
  storageLabel,
  onToggleModded,
  onOpenUpdates,
  onFilterAll,
}: ModsCockpitProps) {
  const { t } = useLanguage();
  const coverage = totalGames > 0 ? Math.round((moddedGames / totalGames) * 100) : 0;

  return (
    <section className="mods-cockpit" aria-label={t("mods.global.label")}>
      <button type="button" className="mods-cockpit__lead" onClick={onToggleModded}>
        <span className="mods-cockpit__lead-top">
          <Gamepad2 size={14} />
          {t("mods.global.moddedGames")}
        </span>
        <span className="mods-cockpit__lead-value">
          {moddedGames}
          <span>/{totalGames}</span>
        </span>
        <span className="mods-cockpit__lead-detail">
          {t("mods.global.moddedDetail", { count: totalGames })}
        </span>
        <span className="mods-cockpit__track" aria-hidden>
          <span className="mods-cockpit__fill" style={{ width: `${coverage}%` }} />
        </span>
        <span className="mods-cockpit__summary">
          {t("mods.global.summary", { mods: totalMods, enabled: enabledMods })}
        </span>
      </button>

      <div className="mods-cockpit__metrics">
        <button type="button" className="mods-cockpit__metric" onClick={onFilterAll}>
          <span className="mods-cockpit__metric-label">
            <Layers size={13} />
            {t("mods.global.totalMods")}
          </span>
          <span className="mods-cockpit__metric-value">{totalMods}</span>
          <span className="mods-cockpit__metric-detail">
            {t("mods.global.totalModsDetail")}
          </span>
        </button>

        <div className="mods-cockpit__metric">
          <span className="mods-cockpit__metric-label">
            <CheckCircle2 size={13} />
            {t("mods.global.activeRate")}
          </span>
          <span className="mods-cockpit__metric-value mods-cockpit__metric-value--success">
            {activeRatio}%
          </span>
          <span className="mods-cockpit__metric-detail">
            {t("mods.global.activeDetail", { enabled: enabledMods, total: totalMods })}
          </span>
          <span className="mods-cockpit__track" aria-hidden>
            <span
              className="mods-cockpit__fill mods-cockpit__fill--success"
              style={{ width: `${activeRatio}%` }}
            />
          </span>
        </div>

        <button
          type="button"
          className={`mods-cockpit__metric${updates > 0 ? " is-warning" : ""}`}
          onClick={onOpenUpdates}
        >
          <span className="mods-cockpit__metric-label">
            <ArrowUpCircle size={13} />
            {t("mods.global.pendingUpdates")}
          </span>
          <span className="mods-cockpit__metric-value">{updates}</span>
          <span className="mods-cockpit__metric-detail">
            {updates > 0
              ? t("mods.global.pendingDetail")
              : t("mods.updates.noneFound")}
          </span>
        </button>

        <div className="mods-cockpit__metric">
          <span className="mods-cockpit__metric-label">
            <HardDrive size={13} />
            {t("mods.global.totalStorage")}
          </span>
          <span className="mods-cockpit__metric-value">{storageLabel}</span>
          <span className="mods-cockpit__metric-detail">
            {t("mods.global.storageDetail")}
          </span>
        </div>
      </div>
    </section>
  );
}
