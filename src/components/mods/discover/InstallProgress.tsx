// Inline progress bar for a running remote download/install.

import { useLanguage } from "../../../context/LanguageContext";
import { useRemoteProgress } from "../../../hooks/useModDiscover";
import { formatBytes } from "./format";
import "./mods-discover.css";

interface InstallProgressProps {
  active: boolean;
  label?: string;
}

export default function InstallProgress({ active, label }: InstallProgressProps) {
  const { t } = useLanguage();
  const progress = useRemoteProgress(active);
  if (!active) return null;

  const phase = progress?.phase ?? "starting";
  const phaseKey: Record<string, string> = {
    starting: t("mods.discover.progress.starting"),
    downloading: t("mods.discover.progress.downloading"),
    installing: t("mods.discover.progress.installing"),
    complete: t("mods.discover.progress.complete"),
  };
  const phaseLabel = phaseKey[phase] ?? phase;
  const pct =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <div className="mods-discover-progress" aria-live="polite">
      <div className="mods-discover-progress-head">
        <span className="mods-discover-progress-label">{label}</span>
        <span className="mods-discover-progress-phase">{phaseLabel}</span>
      </div>
      <div className="mods-discover-progress-track">
        <div
          className={`mods-discover-progress-fill${pct == null ? " indeterminate" : ""}`}
          style={pct != null ? { width: `${pct}%` } : undefined}
        />
      </div>
      <div className="mods-discover-progress-meta">
        <span>
          {progress ? formatBytes(progress.downloaded) : ""}
          {progress?.total ? ` / ${formatBytes(progress.total)}` : ""}
        </span>
        {pct != null && <span>{pct}%</span>}
      </div>
    </div>
  );
}
