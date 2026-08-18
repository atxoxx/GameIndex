import { useLanguage } from "../../context/LanguageContext";
import type { RecordItem, RecordIcon } from "./insights";
import * as Icons from "./Icons";

function RecordGlyph({ icon }: { icon: RecordIcon }) {
  switch (icon) {
    case "clock":
      return <Icons.Clock size={14} />;
    case "calendar":
      return <Icons.Calendar size={14} />;
    case "gamepad":
      return <Icons.Gamepad2 size={14} />;
    case "target":
      return <Icons.Target size={14} />;
    case "zap":
      return <Icons.Zap size={14} />;
    case "trophy":
      return <Icons.Trophy size={14} />;
    case "sparkles":
      return <Icons.Sparkles size={14} />;
  }
}

export function RecordsStrip({ records }: { records: RecordItem[] }) {
  const { t } = useLanguage();
  if (records.length === 0) return null;

  return (
    <section className="act-panel">
      <header className="act-panel__header">
        <div className="act-panel__titles">
          <span className="act-panel__icon" aria-hidden="true">
            <Icons.Sparkles size={14} />
          </span>
          <h3 className="act-panel__title">{t("activityInsights.records")}</h3>
        </div>
      </header>
      <div className="act-records">
        {records.map((r) => (
          <div key={r.id} className="act-record">
            <span className="act-record__icon" aria-hidden="true">
              <RecordGlyph icon={r.icon} />
            </span>
            <span className="act-record__label">{t(r.labelKey)}</span>
            <span className="act-record__value">{r.value}</span>
            {r.sub && <span className="act-record__sub">{r.sub}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
