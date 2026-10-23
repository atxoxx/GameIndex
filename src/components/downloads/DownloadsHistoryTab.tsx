import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  FolderOpen,
  Globe,
  HardDrive,
  History as HistoryIcon,
  Magnet,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { copyTextToClipboard } from "../../utils/clipboard";
import {
  formatBytesShort,
  getStatusClassSuffix,
  getStatusLabel,
  type DownloadHistory,
} from "../../types/download";
import { ConfirmModal } from "../ui";

type HistoryFilter = "all" | "completed" | "removed" | "error";

const FILTERS: { value: HistoryFilter; labelKey: string }[] = [
  { value: "all", labelKey: "downloadsFilter.statusAll" },
  { value: "completed", labelKey: "downloadsFilter.statusCompleted" },
  { value: "removed", labelKey: "downloadsFilter.statusRemoved" },
  { value: "error", labelKey: "downloadsFilter.statusErrored" },
];

/** Local midnight for a date, used to bucket rows by calendar day. */
function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * DownloadsHistoryTab — the persistent `download_history` ledger, grouped by
 * the day it finished. It reads as a log: date headers, then compact rows with
 * the protocol, state, source, size and destination path. Open folder and copy
 * path are the only row actions; clearing is still the single footer action.
 */
export default function DownloadsHistoryTab() {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const { history, refreshHistory, loading } = useDownloads();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const counts = useMemo<Record<HistoryFilter, number>>(() => {
    const next: Record<HistoryFilter, number> = {
      all: history.length,
      completed: 0,
      removed: 0,
      error: 0,
    };
    for (const row of history) {
      if (row.status.kind === "completed") next.completed += 1;
      else if (row.status.kind === "removed") next.removed += 1;
      else if (row.status.kind === "error") next.error += 1;
    }
    return next;
  }, [history]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history
      .filter((row) => {
        if (filter !== "all" && row.status.kind !== filter) return false;
        if (!q) return true;
        return (
          row.name.toLowerCase().includes(q) ||
          row.sourceName.toLowerCase().includes(q) ||
          row.savePath.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          (b.completedAt ?? b.addedAt) - (a.completedAt ?? a.addedAt),
      );
  }, [history, query, filter]);

  const groups = useMemo(() => {
    const today = new Date();
    const buckets = new Map<string, { label: string; rows: DownloadHistory[] }>();

    for (const row of filtered) {
      const date = new Date((row.completedAt ?? row.addedAt) * 1000);
      const key = String(dayStart(date));
      let label: string;
      const diffDays = Math.round((dayStart(today) - dayStart(date)) / 86_400_000);
      if (diffDays === 0) label = t("downloads.today");
      else if (diffDays === 1) label = t("downloads.yesterday");
      else
        label = date.toLocaleDateString(language, {
          weekday: "short",
          day: "numeric",
          month: "long",
          year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
        });

      const bucket = buckets.get(key);
      if (bucket) bucket.rows.push(row);
      else buckets.set(key, { label, rows: [row] });
    }

    return [...buckets.values()];
  }, [filtered, language, t]);

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

  const openFolder = async (path: string) => {
    try {
      await invoke("open_folder", { path });
    } catch (err) {
      showToast(t("downloadRow.openFolderFailed", { error: String(err) }), "error");
    }
  };

  const copyPath = async (path: string) => {
    const copied = await copyTextToClipboard(path);
    showToast(
      copied ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      copied ? "success" : "error",
    );
  };

  return (
    <section className="dl-history dsh" aria-label={t("downloads.tabHistory")}>
      <div className="dsh-toolbar">
        <div className="dsh-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            value={query}
            placeholder={t("downloads.historySearch")}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("downloads.historySearch")}
          />
          {query && (
            <button
              type="button"
              className="dsh-search-clear"
              onClick={() => setQuery("")}
              aria-label={t("downloadsFilter.clearSearch")}
            >
              ×
            </button>
          )}
        </div>

        <div className="dsh-chips" role="group" aria-label={t("downloads.filterLabel")}>
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`dsh-chip dsh-chip--${item.value}${
                filter === item.value ? " is-active" : ""
              }`}
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              <span className="dsh-chip-dot" aria-hidden="true" />
              <span>{t(item.labelKey)}</span>
              <span className="dsh-chip-count">{counts[item.value]}</span>
            </button>
          ))}
        </div>

        <span className="dsh-count">
          {t("downloads.countLabel", { count: filtered.length })}
        </span>

        <button
          type="button"
          className="dsh-clear"
          onClick={() => setClearOpen(true)}
          disabled={history.length === 0}
        >
          <Trash2 size={14} aria-hidden="true" />
          <span>{t("downloads.clearHistory")}</span>
        </button>
      </div>

      {loading && history.length === 0 ? (
        <div className="dsh-loading">
          <div className="spinner-small" />
          <span>{t("downloads.loading")}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dl-list-empty">
          <div className="dl-list-empty-icon-wrap">
            <HistoryIcon size={22} aria-hidden="true" />
          </div>
          <h4 className="dl-list-empty-title">
            {history.length === 0 ? t("downloads.noCompleted") : t("downloads.noCompletedMatch")}
          </h4>
          <p className="dl-list-empty-hint">{t("downloads.noCompletedHint")}</p>
        </div>
      ) : (
        groups.map((group) => (
          <div className="dsh-group" key={group.label + group.rows[0]?.id}>
            <div className="dsh-group-head">
              <span className="dsh-group-label">{group.label}</span>
              <span className="dsh-group-count">{group.rows.length}</span>
              <span className="dsh-group-line" aria-hidden="true" />
            </div>

            <div className="dsh-list">
              {group.rows.map((row) => {
                const timestamp = (row.completedAt ?? row.addedAt) * 1000;
                return (
                  <div className="dsh-row" key={row.id}>
                    <span className={`dsh-tile dsh-tile--${row.kind}`} aria-hidden="true">
                      {row.kind === "torrent" ? (
                        <Magnet size={14} />
                      ) : row.kind === "debrid" ? (
                        <Zap size={14} />
                      ) : (
                        <Globe size={14} />
                      )}
                    </span>

                    <div className="dsh-main">
                      <div className="dsh-head">
                        <span className="dsh-name" title={row.name}>
                          {row.name}
                        </span>
                        <span
                          className={`dsh-status dsh-status--${getStatusClassSuffix(row.status)}`}
                        >
                          {getStatusLabel(row.status, t)}
                        </span>
                        <span className="dsh-source">{row.sourceName}</span>
                      </div>

                      <div className="dsh-meta">
                        <span className="dsh-path" title={row.savePath}>
                          <HardDrive size={11} aria-hidden="true" />
                          {row.savePath}
                        </span>
                        <span className="dsh-size">
                          {formatBytesShort(row.downloaded, unit)}
                          {row.totalSize
                            ? ` / ${formatBytesShort(row.totalSize, unit)}`
                            : ""}
                        </span>
                        <span className="dsh-time">
                          {new Date(timestamp).toLocaleTimeString(language, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="dsh-actions">
                      <button
                        type="button"
                        className="dsh-icon"
                        onClick={() => void openFolder(row.savePath)}
                        title={t("downloadRow.openFolder")}
                        aria-label={t("downloadRow.openFolder")}
                      >
                        <FolderOpen size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="dsh-icon"
                        onClick={() => void copyPath(row.savePath)}
                        title={t("downloads.copyPath")}
                        aria-label={t("downloads.copyPath")}
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
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
