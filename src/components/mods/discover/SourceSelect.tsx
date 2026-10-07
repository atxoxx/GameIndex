// Dropdown of mod websites detected for the selected game.

import { Settings2, RefreshCw } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { ModSourceInfo } from "../../../types/mods";
import "./mods-discover.css";

interface SourceSelectProps {
  sources: ModSourceInfo[];
  value: string | null;
  onChange: (id: string) => void;
  onConfigure: () => void;
  onResolve: () => void;
  resolving: boolean;
  loading: boolean;
  disabled: boolean;
}

export default function SourceSelect({
  sources,
  value,
  onChange,
  onConfigure,
  onResolve,
  resolving,
  loading,
  disabled,
}: SourceSelectProps) {
  const { t } = useLanguage();
  const available = sources.filter((s) => s.available);
  const unavailable = sources.filter((s) => !s.available);

  return (
    <div className="mods-discover-field mods-discover-field--source">
      <label className="mods-discover-label" htmlFor="mods-discover-source">
        {t("mods.discover.source")}
      </label>
      <div className="mods-discover-source-row">
        <select
          id="mods-discover-source"
          className="mods-discover-select"
          value={value ?? ""}
          disabled={disabled || loading}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            {loading ? t("mods.discover.detecting") : t("mods.discover.selectSource")}
          </option>
          {available.length > 0 && (
            <optgroup label={t("mods.discover.detectedGroup")}>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.externalLabel ? ` · ${s.externalLabel}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {unavailable.length > 0 && (
            <optgroup label={t("mods.discover.otherGroup")}>
              {unavailable.map((s) => (
                <option key={s.id} value={s.id} disabled>
                  {s.name}
                  {s.note ? ` — ${s.note}` : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          className="mods-discover-icon-btn"
          onClick={onResolve}
          disabled={disabled || resolving}
          title={t("mods.discover.detectSources")}
          aria-label={t("mods.discover.detectSources")}
        >
          <RefreshCw size={15} className={resolving ? "spinning" : undefined} />
        </button>
        <button
          type="button"
          className="mods-discover-icon-btn"
          onClick={onConfigure}
          title={t("mods.discover.manageSources")}
          aria-label={t("mods.discover.manageSources")}
        >
          <Settings2 size={15} />
        </button>
      </div>
      {!loading && available.length === 0 && (
        <p className="mods-discover-hint">{t("mods.discover.noSources")}</p>
      )}
    </div>
  );
}
