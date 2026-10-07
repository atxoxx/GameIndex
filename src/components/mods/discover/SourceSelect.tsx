import { KeyRound, Link2Off, RefreshCw, Settings2 } from "lucide-react";
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

function statusOf(s: ModSourceInfo): "ready" | "needs-key" | "unmapped" {
  if (s.available) return "ready";
  if (s.requiresCredential && !s.hasCredential) return "needs-key";
  return "unmapped";
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

  return (
    <div className="mods-discover-sources" role="region" aria-label={t("mods.discover.source")}>
      <div className="mods-discover-sources-head">
        <div className="mods-discover-sources-title-group">
          <span className="mods-discover-label">{t("mods.discover.source")}</span>
          <span className="mods-discover-sources-count">
            {sources.filter((s) => s.available).length}/{sources.length} {t("mods.discover.activeCount")}
          </span>
        </div>

        <div className="mods-discover-sources-actions">
          <button
            type="button"
            className="mods-discover-icon-btn"
            onClick={onResolve}
            disabled={disabled || resolving}
            title={t("mods.discover.detectSources")}
            aria-label={t("mods.discover.detectSources")}
          >
            <RefreshCw size={14} className={resolving ? "spinning" : undefined} />
          </button>
          <button
            type="button"
            className="mods-discover-icon-btn"
            onClick={onConfigure}
            title={t("mods.discover.manageSources")}
            aria-label={t("mods.discover.manageSources")}
          >
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {loading && sources.length === 0 ? (
        <div className="mods-discover-chips">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="mods-discover-chip mods-discover-chip--skeleton" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <p className="mods-discover-hint">{t("mods.discover.noSources")}</p>
      ) : (
        <div className="mods-discover-chips" role="listbox" aria-label={t("mods.discover.source")}>
          {sources.map((s) => {
            const status = statusOf(s);
            const selected = s.id === value;

            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled || !s.available}
                title={s.note ?? s.externalLabel ?? s.name}
                className={`mods-discover-chip source-${s.id} mods-discover-chip--${status}${
                  selected ? " is-selected" : ""
                }`}
                onClick={() => onChange(s.id)}
              >
                <span className="mods-discover-chip-dot" aria-hidden="true" />
                <span className="mods-discover-chip-name">{s.name}</span>

                {s.externalLabel && status === "ready" && (
                  <span className="mods-discover-chip-ref">{s.externalLabel}</span>
                )}

                {status === "needs-key" && (
                  <span className="mods-discover-chip-warning" title={t("mods.discover.needsKey")}>
                    <KeyRound size={11} /> {t("mods.discover.needsKey")}
                  </span>
                )}

                {status === "unmapped" && (
                  <span className="mods-discover-chip-unmapped" title={t("mods.discover.unmapped")}>
                    <Link2Off size={11} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
