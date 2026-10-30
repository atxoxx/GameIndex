import { useCallback, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useStoreInstalls } from "../../hooks/useStoreInstalls";
import { formatBytesPerSecond } from "../../types/download";
import { STORE_QUEUE_URLS, type StoreInstallSource } from "../../types/storeInstalls";
import {
  formatEtaLabel,
  storeInstallDetail,
  storeInstallHeadline,
  storeInstallPercent,
  storeInstallSourceName,
} from "../store/storeInstallText";
import "../../styles/store-installs.css";

/**
 * Store transfers running outside GameIndex, listed above its own queue.
 *
 * Deliberately separate from the download queue: nothing here can be
 * paused, resumed or prioritised from this app. Every transfer of the same
 * store is paused in the same place, so the action lives once in the header
 * instead of repeating on every row.
 */
export default function StoreInstallsSection() {
  const transfers = useStoreInstalls();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();

  const openQueue = useCallback(
    (source: StoreInstallSource) => {
      const url = STORE_QUEUE_URLS[source];
      if (!url) return;
      openUrl(url).catch((err) =>
        showToast(
          t("storeInstall.openQueueFailed", {
            store: storeInstallSourceName({ source }),
            err: String(err),
          }),
          "error",
        ),
      );
    },
    [showToast, t],
  );

  const formatSpeed = useCallback(
    (bytesPerSecond: number) => formatBytesPerSecond(bytesPerSecond, unit, language),
    [unit, language],
  );
  const formatEtaSeconds = useCallback((seconds: number) => formatEtaLabel(seconds, t), [t]);

  // One action per store, in a stable order, shared by every row below it.
  const stores = useMemo(() => {
    const seen: StoreInstallSource[] = [];
    for (const transfer of transfers) {
      if (!seen.includes(transfer.source)) seen.push(transfer.source);
    }
    return seen;
  }, [transfers]);

  const ordered = useMemo(
    () => [...transfers].sort((a, b) => a.title.localeCompare(b.title, language)),
    [transfers, language],
  );

  if (transfers.length === 0) return null;

  return (
    <section className="dl-store-installs" aria-label={t("storeInstall.sectionTitle")}>
      <header className="dl-store-installs-head">
        <div className="dl-store-installs-heading">
          <h2 className="dl-store-installs-title">{t("storeInstall.sectionTitle")}</h2>
          <span className="dl-store-installs-count">{transfers.length}</span>
        </div>
        <div className="dl-store-installs-actions">
          {stores.map((source) => (
            <button
              key={source}
              type="button"
              className="dl-store-installs-action"
              onClick={() => openQueue(source)}
            >
              <ExternalLink size={13} aria-hidden="true" />
              {t("storeInstall.openStore", { store: storeInstallSourceName({ source }) })}
            </button>
          ))}
        </div>
      </header>

      <ul className="dl-store-installs-list">
        {ordered.map((transfer) => {
          const percent = storeInstallPercent(transfer);
          const detail = storeInstallDetail(transfer, formatSpeed, formatEtaSeconds);
          const headline = storeInstallHeadline(transfer, t);
          return (
            <li className="dl-store-install" key={transfer.key}>
              <div className="dl-store-install-top">
                <span className="dl-store-install-name" title={transfer.title}>
                  {transfer.title}
                </span>
                <span className="dl-store-install-percent">
                  {percent == null ? "…" : `${percent}%`}
                </span>
              </div>

              <div className={`store-install-track${percent == null ? " is-indeterminate" : ""}`}>
                <div
                  className="store-install-fill"
                  style={percent == null ? undefined : { width: `${percent}%` }}
                />
              </div>

              <div className="dl-store-install-meta">
                <span>{headline}</span>
                {detail ? <span className="dl-store-install-detail"> · {detail}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="dl-store-installs-hint">{t("storeInstall.sectionHint")}</p>
    </section>
  );
}
