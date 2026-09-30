import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HardDrive, History as HistoryIcon, Search, Trash2 } from "lucide-react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import {
  formatBytesShort,
  getStatusClassSuffix,
  getStatusLabel,
  type DownloadHistory,
} from "../../types/download";
import { ConfirmModal } from "../ui";

type HistoryFilter = "all" | "completed" | "removed" | "error";

/**
 * DownloadsHistoryTab — the persistent `download_history` ledger,
 * promoted out of the stats modal. Every completed or removed
 * download lives here even after it leaves the active list.
 */
export default function DownloadsHistoryTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const { history, refreshHistory, loading } = useDownloads();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((row) => {
      if (filter !== "all" && row.status.kind !== filter) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.sourceName.toLowerCase().includes(q) ||
        row.savePath.toLowerCase().includes(q)
      );
    });
  }, [history, query, filter]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await invoke<number>("download_history_clear");
      await refreshHistory();
      showToast(t("downloads.historyCleared"), "info");
      setClearOpen(false);
    } catch (err) {
      showToast(t("downloads.historyClearFailed", { error: String(err) }), "error");
    } finally {
      setClearing(false);
    }
  };

  const rowDate = (row: DownloadHistory) => {
    const at = row.completedAt ?? row.addedAt;
    return new Date(at * 1000).toLocaleString();
  };

  return (
    <section className="dl-history" aria-label={t("downloads.tabHistory")}>
      <div className="dl-history-toolbar">
        <div className="dl-history-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="text"
            value={query}
            placeholder={t("downloads.historySearch")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="dl-history-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as HistoryFilter)}
          aria-label={t("downloads.filterLabel")}
        >
          <option value="all">{t("downloadsFilter.statusAll")}</option>
          <option value="completed">{t("downloadsFilter.statusCompleted")}</option>
          <option value="removed">{t("downloadsFilter.statusRemoved")}</option>
          <option value="error">{t("downloadsFilter.statusErrored")}</option>
        </select>
        <span className="dl-history-count">
          {t("downloads.countLabel", { count: filtered.length })}
        </span>
        <button
          type="button"
          className="dl-history-clear"
          onClick={() => setClearOpen(true)}
          disabled={history.length === 0}
        >
          <Trash2 size={14} aria-hidden="true" />
          <span>{t("downloads.clearHistory")}</span>
        </button>
      </div>

      {loading && history.length === 0 ? (
        <div className="dl-history-empty">
          <div className="spinner-small" />
          <span>{t("downloads.loading")}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dl-history-empty dl-history-empty--roomy">
          <HistoryIcon size={34} aria-hidden="true" />
          <p>{history.length === 0 ? t("downloads.noCompleted") : t("downloads.noCompletedMatch")}</p>
          <span>{t("downloads.noCompletedHint")}</span>
        </div>
      ) : (
        <div className="dl-history-list">
          {filtered.map((row) => (
            <div className="dl-history-row" key={row.id}>
              <div className="dl-history-row-main">
                <span className="dl-history-name" title={row.name}>
                  {row.name}
                </span>
                <span className={`dl-row-status dl-row-status--${getStatusClassSuffix(row.status)}`}>
                  {getStatusLabel(row.status, t)}
                </span>
                <span className="dl-history-source">{row.sourceName}</span>
              </div>
              <div className="dl-history-row-meta">
                <span className="dl-history-path" title={row.savePath}>
                  <HardDrive size={12} aria-hidden="true" />
                  {row.savePath}
                </span>
                <span className="dl-history-size">
                  {formatBytesShort(row.downloaded, unit)}
                  {row.totalSize ? ` / ${formatBytesShort(row.totalSize, unit)}` : ""}
                </span>
                <span className="dl-history-date">{rowDate(row)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={clearOpen}
        title={t("downloads.clearHistoryTitle")}
        message={t("downloads.clearHistoryBody", { count: history.length })}
        confirmLabel={t("downloads.clearHistory")}
        busy={clearing}
        onConfirm={handleClear}
        onCancel={() => {
          if (!clearing) setClearOpen(false);
        }}
      />
    </section>
  );
}
