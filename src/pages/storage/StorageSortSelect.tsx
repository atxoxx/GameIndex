import type { SortKey } from "./utils";
import { useLanguage } from "../../context/LanguageContext";

interface Props {
  value: SortKey;
  onChange: (next: SortKey) => void;
}

// Pure dropdown. The StoragePage owns the active sort key; this
// component is presentational and re-uses the same option labels
// everywhere (Phase-5 spec requirement: Largest first is the locked
// default; dropdown exposes Name / Platform / Last detected).
export function StorageSortSelect({ value, onChange }: Props) {
  const { t } = useLanguage();
  return (
    <label className="storage__sort">
      <span className="storage__sort-label">{t("storagePage.sortBy")}</span>
      <select
        className="storage__sort-select"
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
      >
        <option value="size:desc">{t("storagePage.sizeLargest")}</option>
        <option value="name:asc">{t("storagePage.nameAZ")}</option>
        <option value="platform:asc">{t("storagePage.platform")}</option>
        <option value="detectedAt:desc">{t("storagePage.lastDetected")}</option>
      </select>
    </label>
  );
}
