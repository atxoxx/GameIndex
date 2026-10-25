import { Shield } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";

export function LaunchScriptCard({
  type,
  label,
  tag,
  hint,
  value,
  admin,
  onChange,
  onAdminChange,
  onPick,
}: {
  type: "pre" | "post";
  label: string;
  tag: string;
  hint: string;
  value: string;
  admin: boolean;
  onChange: (path: string) => void;
  onAdminChange: (admin: boolean) => void;
  onPick: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className={`edit-script-card ${type === "pre" ? "is-pre" : "is-post"}`}>
      <div className="edit-script-head">
        <div className="edit-script-title-row">
          <span className="edit-script-label">{label}</span>
          <span className={`edit-chip edit-chip--${type === "pre" ? "warning" : "info"}`}>
            {tag}
          </span>
        </div>
        <p className="edit-script-hint">{hint}</p>
      </div>

      <div className="edit-inline-row">
        <div className="edit-input-with-clear">
          <input
            id={type === "pre" ? "edit-pre-launch-script" : "edit-post-exit-script"}
            className="edit-input"
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t("edit.scriptPathPlaceholder")}
          />
          {value && (
            <button
              type="button"
              className="edit-input-clear"
              onClick={() => onChange("")}
              title={t("edit.clearScriptPath")}
              aria-label={t("edit.clearScriptPath")}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={onPick}>
          {t("edit.browse")}
        </Button>
      </div>

      <div className="edit-script-foot">
        <label className="edit-checkbox-row">
          <input
            type="checkbox"
            checked={admin}
            onChange={(event) => onAdminChange(event.target.checked)}
          />
          <span className="edit-script-admin">
            <Shield size={12} aria-hidden="true" />
            {t("edit.scriptRunAsAdmin")}
          </span>
        </label>
        {value && <span className="edit-script-status">{t("edit.scriptConfigured")}</span>}
      </div>
    </div>
  );
}
