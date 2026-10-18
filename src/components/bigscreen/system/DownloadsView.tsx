// DownloadsView — System hub sub-view listing active/completed
// downloads with pause / resume / cancel actions.
//
// Cancel is destructive (removes the record and its files), so it is
// confirmed by a `ConfirmModal` — the shell's Exit uses the same
// deliberate-two-step pattern.

import { useCallback, useState } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useDownloads, type TorrentDownload } from "../../../context/DownloadContext";
import { ConfirmModal } from "../../ui/ConfirmModal";
import { BigScreenEmptyState } from "../BigScreenState";
import DownloadRow from "./DownloadRow";

export default function DownloadsView() {
  const { t } = useLanguage();
  const { downloads, pauseDownload, resumeDownload, removeDownload } = useDownloads();
  const [pendingCancel, setPendingCancel] = useState<TorrentDownload | null>(null);

  const handlePause = useCallback((id: string) => {
    pauseDownload(id);
  }, [pauseDownload]);

  const handleResume = useCallback((id: string) => {
    resumeDownload(id);
  }, [resumeDownload]);

  const confirmCancel = useCallback(() => {
    if (!pendingCancel) return;
    removeDownload(pendingCancel.id, true);
    setPendingCancel(null);
  }, [pendingCancel, removeDownload]);

  return (
    <div className="bigscreen-system-section-view">
      <h3>{t("bigscreen.system.activeDownloads")}</h3>
      {downloads.length === 0 ? (
        <BigScreenEmptyState message={t("bigscreen.system.noDownloads")} />
      ) : (
        <div className="system-downloads-list">
          {downloads.map((dl) => (
            <DownloadRow
              key={dl.id}
              dl={dl}
              onPause={() => handlePause(dl.id)}
              onResume={() => handleResume(dl.id)}
              onCancel={() => setPendingCancel(dl)}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        open={pendingCancel !== null}
        title={t("bigscreen.system.cancelConfirmTitle")}
        message={t("bigscreen.system.cancelConfirmBody", { name: pendingCancel?.name ?? "" })}
        confirmLabel="bigscreen.system.cancelConfirmLabel"
        onConfirm={confirmCancel}
        onCancel={() => setPendingCancel(null)}
      />
    </div>
  );
}
