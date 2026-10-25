import type { ReactNode } from "react";
import { useLanguage } from "../../../context/LanguageContext";

export function GlobalSettingHint({ value }: { value?: string | number | null }) {
  const { t } = useLanguage();
  if (value === undefined || value === null || value === "") return null;
  return (
    <span className="edit-global-hint" title={String(value)}>
      {t("gameEdit.compatibility.globalSettingValue", { value: String(value) })}
    </span>
  );
}

export function TriStateCard({
  id,
  title,
  desc,
  value,
  onChange,
  icon,
  globalValue,
}: {
  id?: string;
  title: string;
  desc: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  icon?: ReactNode;
  globalValue?: boolean | null;
}) {
  const { t } = useLanguage();
  const inherited = globalValue === true || globalValue === false;

  return (
    <section id={id} className="edit-card edit-tristate-card">
      <header className="edit-card-header">
        {icon && <span className="edit-card-icon">{icon}</span>}
        <div className="edit-card-heading">
          <h3 className="edit-card-title">{title}</h3>
          <p className="edit-card-desc">{desc}</p>
        </div>
        {inherited && (
          <span
            className="edit-global-hint"
            title={t("gameEdit.compatibility.globalSettingValue", {
              value: globalValue ? t("edit.tristate.on") : t("edit.tristate.off"),
            })}
          >
            {globalValue
              ? t("gameEdit.compatibility.globalSettingOn")
              : t("gameEdit.compatibility.globalSettingOff")}
          </span>
        )}
        <div className="edit-tristate-group" role="group" aria-label={title}>
          <button
            type="button"
            className={`edit-tristate-btn${value === null ? " is-active" : ""}`}
            onClick={() => onChange(null)}
            aria-pressed={value === null}
            title={
              inherited
                ? t("gameEdit.compatibility.globalSettingValue", {
                    value: globalValue ? t("edit.tristate.on") : t("edit.tristate.off"),
                  })
                : t("edit.tristate.global")
            }
          >
            {t("edit.tristate.global")}
          </button>
          <button
            type="button"
            className={`edit-tristate-btn is-on${value === true ? " is-active" : ""}`}
            onClick={() => onChange(true)}
            aria-pressed={value === true}
          >
            {t("edit.tristate.on")}
          </button>
          <button
            type="button"
            className={`edit-tristate-btn is-off${value === false ? " is-active" : ""}`}
            onClick={() => onChange(false)}
            aria-pressed={value === false}
          >
            {t("edit.tristate.off")}
          </button>
        </div>
      </header>
    </section>
  );
}
