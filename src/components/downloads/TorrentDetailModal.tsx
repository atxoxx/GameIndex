import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Info, X } from "lucide-react";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import {
  formatBytesPerSecond,
  formatBytesShort,
  type TorrentDetail,
  type TorrentDownload,
} from "../../types/download";
import { Button } from "../ui";

interface TorrentDetailModalProps {
  download: TorrentDownload;
  onClose: () => void;
}

type DetailTab = "overview" | "peers" | "trackers" | "files";

/**
 * Torrent info modal. Fetches the engine detail snapshot on open and
 * re-fetches (throttled to ~2 s) whenever the row's live counters change —
 * i.e. off the same `download-progress` stream the Downloads page uses, so
 * it only does work while open.
 */
export default function TorrentDetailModal({ download, onClose }: TorrentDetailModalProps) {
  const { getTorrentDetail } = useDownloads();
  const { t } = useLanguage();
  const { unit: sizeUnit } = useSizeUnit();
  const { unit: speedUnit } = useSpeedUnit();
  const copy = useCopyToClipboard();

  const [detail, setDetail] = useState<TorrentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const lastFetch = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    if (now - lastFetch.current < 2000) return;
    lastFetch.current = now;
    getTorrentDetail(download.id)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch as the row's counters tick (status kind is included so a
    // pause/resume or completion also refreshes the snapshot).
  }, [
    download.id,
    download.downloaded,
    download.uploaded,
    download.peers,
    download.seeds,
    download.downloadSpeed,
    download.status.kind,
    getTorrentDetail,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayName = detail?.name || download.name;

  const tabs: { id: DetailTab; label: string }[] = [
    { id: "overview", label: t("torrentDetail.tabOverview") },
    { id: "peers", label: `${t("torrentDetail.tabPeers")} (${detail?.peerList.length ?? 0})` },
    { id: "trackers", label: `${t("torrentDetail.tabTrackers")} (${detail?.trackers.length ?? 0})` },
    { id: "files", label: `${t("torrentDetail.tabFiles")} (${detail?.files.length ?? 0})` },
  ];

  const etaText = (() => {
    const secs = detail?.breakdown.etaSecs ?? null;
    if (secs == null) return "—";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  })();

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="torrent-detail-title"
    >
      <div className="modal dl-torrent-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-icon">
            <Info size={18} />
          </div>
          <div className="modal-header-text">
            <h2 id="torrent-detail-title" className="modal-title" title={displayName}>
              {displayName}
            </h2>
            <p className={`modal-subtitle${detail?.stalled ? " dl-torrent-subtitle--warn" : ""}`}>
              {detail?.stalled ? t("torrentDetail.stalledHint") : t("torrentDetail.subtitle")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onClose}
            aria-label={t("common.close")}
            className="modal-close"
          >
            <X size={16} />
          </Button>
        </div>

        <div className="dl-torrent-tabs" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`dl-torrent-tab${tab === item.id ? " active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="modal-body dl-torrent-body">
          {error && !detail ? (
            <p className="dl-torrent-empty">{t("torrentDetail.unavailable")}</p>
          ) : !detail ? (
            <p className="dl-torrent-empty">{t("common.loading")}</p>
          ) : tab === "overview" ? (
            <OverviewTab detail={detail} sizeUnit={sizeUnit} speedUnit={speedUnit} etaText={etaText} copy={copy} />
          ) : tab === "peers" ? (
            <PeersTab detail={detail} sizeUnit={sizeUnit} />
          ) : tab === "trackers" ? (
            <TrackersTab detail={detail} copy={copy} />
          ) : (
            <FilesTab detail={detail} sizeUnit={sizeUnit} />
          )}
        </div>

        <div className="modal-footer dl-torrent-footer">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface TabProps {
  detail: TorrentDetail;
  sizeUnit?: ReturnType<typeof useSizeUnit>["unit"];
  speedUnit?: ReturnType<typeof useSpeedUnit>["unit"];
  etaText?: string;
  copy?: (text: string) => Promise<boolean>;
}

/** Byte totals with trailing zeros trimmed ("4.00 Mio" → "4 Mio", "0 o"). */
function displayBytes(bytes: number | null | undefined, unit: TabProps["sizeUnit"]): string {
  if (bytes == null) return "—";
  const formatted = formatBytesShort(bytes > 0 ? bytes : 1, unit);
  const space = formatted.indexOf(" ");
  if (space === -1) return formatted;
  const numeric = Number(formatted.slice(0, space));
  const value = bytes === 0 ? 0 : numeric;
  return `${Number.isFinite(value) ? value : formatted.slice(0, space)}${formatted.slice(space)}`;
}

function displaySpeed(bytesPerSec: number, unit: TabProps["speedUnit"]): string {
  return formatBytesPerSecond(bytesPerSec, unit);
}

function Field({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className="dl-torrent-field">
      <span className="dl-torrent-field-label">{label}</span>
      <span className="dl-torrent-field-value" title={value}>
        {value}
      </span>
      {onCopy && (
        <button
          type="button"
          className="dl-torrent-copy"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
        >
          <Copy size={13} />
        </button>
      )}
    </div>
  );
}

function OverviewTab({ detail, sizeUnit, speedUnit, etaText, copy }: TabProps) {
  const { t } = useLanguage();
  return (
    <div className="dl-torrent-overview">
      <div className="dl-torrent-stats-grid">
        <Stat label={t("torrentDetail.downloaded")} value={displayBytes(detail.downloaded, sizeUnit)} />
        <Stat label={t("torrentDetail.totalSize")} value={displayBytes(detail.totalSize, sizeUnit)} />
        <Stat label={t("torrentDetail.uploaded")} value={displayBytes(detail.uploaded, sizeUnit)} />
        <Stat label={t("torrentDetail.ratio")} value={detail.ratio.toFixed(2)} />
        <Stat label={t("torrentDetail.downloadSpeed")} value={displaySpeed(detail.downloadSpeed, speedUnit)} />
        <Stat label={t("torrentDetail.uploadSpeed")} value={displaySpeed(detail.uploadSpeed, speedUnit)} />
        <Stat label={t("torrentDetail.peakSpeed")} value={displaySpeed(detail.peakSpeed, speedUnit)} />
        <Stat label={t("torrentDetail.eta")} value={etaText ?? "—"} />
      </div>

      <div className="dl-torrent-fields">
        <Field
          label={t("torrentDetail.infoHash")}
          value={detail.infoHash}
          onCopy={copy ? () => void copy(detail.infoHash) : undefined}
        />
        <Field label={t("torrentDetail.savePath")} value={detail.savePath} />
        {detail.magnetUri && (
          <Field
            label={t("torrentDetail.magnet")}
            value={detail.magnetUri}
            onCopy={copy ? () => void copy(detail.magnetUri as string) : undefined}
          />
        )}
        <Field label={t("torrentDetail.source")} value={detail.sourceName} />
        <Field
          label={t("torrentDetail.addedAt")}
          value={new Date(detail.addedAt * 1000).toLocaleString()}
        />
        {detail.completedAt != null && (
          <Field
            label={t("torrentDetail.completedAt")}
            value={new Date(detail.completedAt * 1000).toLocaleString()}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="dl-torrent-stat">
      <span className="dl-torrent-stat-label">{label}</span>
      <span className="dl-torrent-stat-value">{value}</span>
    </div>
  );
}

function PeerChip({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <span className={`dl-torrent-peer-chip${tone ? ` dl-torrent-peer-chip--${tone}` : ""}`}>
      <span className="dl-torrent-peer-chip-label">{label}</span>
      <span className="dl-torrent-peer-chip-value">{value}</span>
    </span>
  );
}

function PeersTab({ detail, sizeUnit }: TabProps) {
  const { t } = useLanguage();
  const b = detail.breakdown;
  return (
    <div className="dl-torrent-peers">
      <div className="dl-torrent-peer-summary">
        <PeerChip label={t("torrentDetail.live")} value={b.live} tone="live" />
        <PeerChip label={t("torrentDetail.liveTcp")} value={b.liveTcp} />
        <PeerChip label={t("torrentDetail.liveUtp")} value={b.liveUtp} />
        <PeerChip label={t("torrentDetail.connecting")} value={b.connecting} tone="connecting" />
        <PeerChip label={t("torrentDetail.queued")} value={b.queued} />
        <PeerChip label={t("torrentDetail.dead")} value={b.dead} tone="dead" />
        <PeerChip label={t("torrentDetail.seen")} value={b.seen} />
        <PeerChip
          label={t("torrentDetail.avgPiece")}
          value={b.averagePieceMs != null ? `${b.averagePieceMs} ms` : "—"}
        />
      </div>

      {detail.peerList.length === 0 ? (
        <p className="dl-torrent-empty">{t("torrentDetail.noPeers")}</p>
      ) : (
        <div className="dl-torrent-table-wrap">
          <table className="dl-torrent-peer-table">
            <thead>
              <tr>
                <th>{t("torrentDetail.peerAddress")}</th>
                <th>{t("torrentDetail.peerClient")}</th>
                <th>{t("torrentDetail.peerConn")}</th>
                <th className="dl-torrent-col-num">{t("torrentDetail.peerDown")}</th>
                <th className="dl-torrent-col-num">{t("torrentDetail.peerUp")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.peerList.map((p) => (
                <tr key={p.address}>
                  <td className="dl-torrent-col-mono" title={p.address}>
                    {p.address}
                  </td>
                  <td>
                    {p.client ? (
                      <span className="dl-torrent-client" title={p.client}>
                        {p.client}
                      </span>
                    ) : (
                      <span className="dl-torrent-state">{p.state}</span>
                    )}
                  </td>
                  <td>
                    {p.connection ? (
                      <span className={`dl-torrent-link dl-torrent-link--${p.connection}`}>
                        {p.connection.toUpperCase()}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="dl-torrent-col-num">{displayBytes(p.downloaded, sizeUnit)}</td>
                  <td className="dl-torrent-col-num">{displayBytes(p.uploaded, sizeUnit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function trackerProtocol(url: string): string {
  try {
    return new URL(url).protocol.replace(":", "").toUpperCase();
  } catch {
    return "—";
  }
}

function TrackersTab({ detail, copy }: TabProps) {
  const { t } = useLanguage();
  if (detail.trackers.length === 0) {
    return <p className="dl-torrent-empty">{t("torrentDetail.noTrackers")}</p>;
  }
  return (
    <ul className="dl-torrent-trackers">
      {detail.trackers.map((url) => (
        <li key={url}>
          <span className="dl-torrent-tracker-proto">{trackerProtocol(url)}</span>
          <span className="dl-torrent-tracker-url" title={url}>
            {url}
          </span>
          {copy && (
            <button
              type="button"
              className="dl-torrent-copy"
              onClick={() => void copy(url)}
              aria-label={`Copy ${url}`}
            >
              <Copy size={13} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function FilesTab({ detail, sizeUnit }: TabProps) {
  const { t } = useLanguage();
  if (detail.files.length === 0) {
    return <p className="dl-torrent-empty">{t("torrentDetail.noFiles")}</p>;
  }
  const total = detail.files.reduce((sum, f) => sum + (f.selected ? f.size : 0), 0);
  return (
    <div className="dl-torrent-files">
      <div className="dl-torrent-files-summary">
        <span>
          {t("torrentDetail.tabFiles")} · {detail.files.length}
        </span>
        <span>{displayBytes(total, sizeUnit)}</span>
      </div>
      <div className="dl-torrent-file dl-torrent-file--head">
        <span>{t("torrentDetail.columnFile")}</span>
        <span className="dl-torrent-file-size">{t("torrentDetail.columnSize")}</span>
        <span className="dl-torrent-file-progress-label">{t("torrentDetail.columnProgress")}</span>
        <span />
      </div>
      {detail.files.map((file, idx) => {
        const percent = file.progress != null ? Math.round(file.progress * 100) : null;
        return (
          <div key={file.name || idx} className={`dl-torrent-file${file.selected ? "" : " skipped"}`}>
            <span className="dl-torrent-file-name" title={file.name}>
              {file.name}
            </span>
            <span className="dl-torrent-file-size">{displayBytes(file.size, sizeUnit)}</span>
            <div className="dl-torrent-file-bar">
              <div
                className={`dl-torrent-file-fill${percent === 100 ? " complete" : ""}`}
                style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
              />
            </div>
            <span
              className={`dl-torrent-file-pct${percent === 100 ? " complete" : percent === 0 ? " zero" : ""}`}
            >
              {percent != null ? `${percent}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
