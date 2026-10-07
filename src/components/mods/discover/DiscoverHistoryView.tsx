import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  HardDriveDownload,
  History,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { ModRemoteInstall } from "../../../types/mods";
import { formatRemoteDate, sourceLabel } from "./format";
import "./mods-discover.css";

interface DiscoverHistoryViewProps {
  installs: ModRemoteInstall[];
  onRemove: (id: string) => void;
  onNavigateBrowse: () => void;
}

export default function DiscoverHistoryView({
  installs,
  onRemove,
  onNavigateBrowse,
}: DiscoverHistoryViewProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return installs;
    return installs.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.author && item.author.toLowerCase().includes(q)) ||
        item.source.toLowerCase().includes(q),
    );
  }, [installs, filter]);

  const handleOpenFolder = (path: string) => {
    invoke("open_folder", { path })
      .catch((e) => showToast(String(e), "error"));
  };

  const handleCopy = async (item: ModRemoteInstall) => {
    try {
      const text = `${item.name}${item.version ? ` v${item.version}` : ""}\nSource: ${sourceLabel(item.source)}\nURL: ${item.remoteUrl ?? ""}`;
      await navigator.clipboard.writeText(text);
      showToast(t("common.copiedToClipboard", { label: item.name }), "info");
    } catch {
      showToast(t("common.copyFailed"), "error");
    }
  };

  if (installs.length === 0) {
    return (
      <div className="mods-discover-empty">
        <History size={40} className="mods-discover-empty-icon" />
        <h3>{t("mods.discover.noHistoryTitle")}</h3>
        <p>{t("mods.discover.noHistoryDesc")}</p>
        <Button variant="primary" size="sm" onClick={onNavigateBrowse}>
          {t("mods.discover.browseMods")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mods-discover-history-view">
      {/* KPI Header Bar */}
      <div className="mods-discover-history-kpis">
        <div className="mods-discover-history-kpi">
          <span className="mods-discover-kpi-icon">
            <HardDriveDownload size={18} />
          </span>
          <div className="mods-discover-kpi-info">
            <span className="mods-discover-kpi-value">{installs.length}</span>
            <span className="mods-discover-kpi-label">{t("mods.discover.totalInstalls")}</span>
          </div>
        </div>

        <div className="mods-discover-history-search">
          <Search size={14} className="mods-discover-search-icon" />
          <input
            type="text"
            className="mods-discover-search-input"
            placeholder={t("mods.discover.searchHistoryPlaceholder")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {/* History List */}
      <ul className="mods-discover-history-list">
        {filtered.map((item) => (
          <li key={item.id} className="mods-discover-history-item">
            <div className="mods-discover-history-main">
              <div className="mods-discover-history-title-row">
                <span className="mods-discover-history-name">{item.name}</span>
                {item.version && (
                  <span className="mods-discover-history-version">v{item.version}</span>
                )}
                <span className={`mods-discover-history-source source-${item.source}`}>
                  {sourceLabel(item.source)}
                </span>
              </div>

              <div className="mods-discover-history-meta-row">
                {item.author && (
                  <span className="mods-discover-history-author">
                    {t("mods.discover.byAuthor", { author: item.author })}
                  </span>
                )}
                <span className="mods-discover-history-date">
                  {formatRemoteDate(String(item.installedAt))}
                </span>
                {item.installedPath && (
                  <span className="mods-discover-history-path" title={item.installedPath}>
                    {item.installedPath}
                  </span>
                )}
              </div>
            </div>

            <div className="mods-discover-history-actions">
              {item.installedPath && (
                <button
                  type="button"
                  className="mods-discover-icon-btn"
                  title={t("mods.discover.openFolder")}
                  aria-label={t("mods.discover.openFolder")}
                  onClick={() => handleOpenFolder(item.installedPath!)}
                >
                  <FolderOpen size={14} />
                </button>
              )}

              {item.remoteUrl && (
                <button
                  type="button"
                  className="mods-discover-icon-btn"
                  title={t("mods.discover.openPage")}
                  aria-label={t("mods.discover.openPage")}
                  onClick={() => void openUrl(item.remoteUrl!)}
                >
                  <ExternalLink size={14} />
                </button>
              )}

              <button
                type="button"
                className="mods-discover-icon-btn"
                title={t("common.copy")}
                aria-label={t("common.copy")}
                onClick={() => void handleCopy(item)}
              >
                <Copy size={14} />
              </button>

              <button
                type="button"
                className="mods-discover-icon-btn mods-discover-icon-btn--danger"
                title={t("mods.discover.removeRecord")}
                aria-label={t("mods.discover.removeRecord")}
                onClick={() => onRemove(item.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
