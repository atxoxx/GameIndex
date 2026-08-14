import { useMemo, useState } from "react";
import { useDownloads } from "../context/DownloadContext";
import { useToast } from "../context/ToastContext";
import { useSizeUnit } from "../hooks/useSizeUnit";
import {
  compareDownloads,
  formatBytesShort,
  isActiveStatus,
  matchesSearchQuery,
  matchesStatusFilter,
  type DownloadSort,
  type DownloadStatusFilter,
  type TorrentDownload,
} from "../types/download";
import BandwidthHero from "../components/downloads/BandwidthHero";
import BandwidthSparkline from "../components/downloads/BandwidthSparkline";
import MagnetInputBar from "../components/downloads/MagnetInputBar";
import DownloadsToolbar from "../components/downloads/DownloadsToolbar";
import DownloadsFilterBar, { type DownloadViewMode } from "../components/downloads/DownloadsFilterBar";
import DownloadRow from "../components/downloads/DownloadRow";
import { DownloadGridCard } from "../components/downloads/DownloadGridCard";
import { ConfirmModal, PageHeader } from "../components/ui";
import { useLanguage } from "../context/LanguageContext";
import "../styles/page-downloads.css";

export default function DownloadsPage() {
  const { t } = useLanguage();
  const {
    downloads,
    activeDownloads,
    completedDownloads,
    pauseDownload,
    resumeDownload,
    removeDownload,
    loading,
  } = useDownloads();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();

  // ── Search / filter / sort / view mode state ─────────────────────
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DownloadStatusFilter>("all");
  const [sort, setSort] = useState<DownloadSort>("added-desc");
  const [viewMode, setViewMode] = useState<DownloadViewMode>("detailed");

  // ── Multi-select state ───────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Per-bucket counts for the filter pill badges
  const counts = useMemo<Record<DownloadStatusFilter, number>>(() => {
    const c: Record<DownloadStatusFilter, number> = {
      all: downloads.length,
      downloading: 0,
      seeding: 0,
      queued: 0,
      paused: 0,
      completed: 0,
      error: 0,
    };
    for (const d of downloads) {
      if (matchesStatusFilter(d, "downloading")) c.downloading += 1;
      else if (matchesStatusFilter(d, "seeding")) c.seeding += 1;
      else if (matchesStatusFilter(d, "queued")) c.queued += 1;
      else if (matchesStatusFilter(d, "paused")) c.paused += 1;
      else if (matchesStatusFilter(d, "completed")) c.completed += 1;
      else if (matchesStatusFilter(d, "error")) c.error += 1;
    }
    return c;
  }, [downloads]);

  const comparator = useMemo(() => compareDownloads(sort), [sort]);

  // Unified filtered downloads list
  const filteredDownloads = useMemo(() => {
    return downloads
      .filter((d) => matchesSearchQuery(d, query) && matchesStatusFilter(d, statusFilter))
      .sort(comparator);
  }, [downloads, query, statusFilter, comparator]);

  // ── Confirmation modals state ────────────────────────────────────
  const [deletingContext, setDeletingContext] = useState<TorrentDownload | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const [removingContext, setRemovingContext] = useState<TorrentDownload | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  // ── Handlers ─────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(filteredDownloads.map((d) => d.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  async function handlePause(id: string) {
    try {
      await pauseDownload(id);
    } catch (err) {
      showToast(t("downloads.pauseFailed", { error: String(err) }), "error");
    }
  }

  async function handleResume(id: string) {
    try {
      await resumeDownload(id);
    } catch (err) {
      showToast(t("downloads.resumeFailed", { error: String(err) }), "error");
    }
  }

  async function handleRemove(id: string) {
    const target = downloads.find((d) => d.id === id);
    if (target && isActiveStatus(target.status)) {
      setRemovingContext(target);
      return;
    }
    try {
      await removeDownload(id, false);
      showToast(t("downloads.removed"), "info");
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      showToast(t("downloads.removeFailed", { error: String(err) }), "error");
    }
  }

  async function confirmRemoveActive() {
    if (!removingContext) return;
    const target = removingContext;
    setRemovingBusy(true);
    try {
      await removeDownload(target.id, false);
      showToast(t("downloads.removedNamed", { name: target.name }), "info");
      setRemovingContext(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    } catch (err) {
      showToast(t("downloads.removeFailed", { error: String(err) }), "error");
    } finally {
      setRemovingBusy(false);
    }
  }

  function handleDeleteFiles(download: TorrentDownload) {
    setDeletingContext(download);
  }

  async function confirmDelete() {
    if (!deletingContext) return;
    const target = deletingContext;
    setDeletingBusy(true);
    try {
      await removeDownload(target.id, true);
      showToast(
        target.autoExtract
          ? t("downloads.deletedArchives", { name: target.name })
          : t("downloads.deletedFromDisk", { name: target.name }),
        "info",
      );
      setDeletingContext(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    } catch (err) {
      showToast(t("downloads.deleteFailed", { error: String(err) }), "error");
    } finally {
      setDeletingBusy(false);
    }
  }

  // Batch actions on selected IDs
  async function handleBatchPause() {
    for (const id of selectedIds) {
      try {
        await pauseDownload(id);
      } catch {}
    }
  }

  async function handleBatchResume() {
    for (const id of selectedIds) {
      try {
        await resumeDownload(id);
      } catch {}
    }
  }

  async function handleBatchRemove() {
    for (const id of selectedIds) {
      try {
        await removeDownload(id, false);
      } catch {}
    }
    setSelectedIds(new Set());
    showToast(t("downloads.removed"), "info");
  }

  async function handleBatchConfirmDelete() {
    setBatchBusy(true);
    try {
      for (const id of selectedIds) {
        try {
          await removeDownload(id, true);
        } catch {}
      }
      setSelectedIds(new Set());
      setBatchDeleteOpen(false);
      showToast(t("downloads.deletedFromDisk", { name: `${selectedIds.size} downloads` }), "info");
    } finally {
      setBatchBusy(false);
    }
  }

  // Calculate sum of bytes for selected items to be deleted
  const selectedBytes = useMemo(() => {
    return Array.from(selectedIds).reduce((acc, id) => {
      const d = downloads.find((item) => item.id === id);
      return acc + (d ? d.downloaded : 0);
    }, 0);
  }, [selectedIds, downloads]);

  return (
    <div className="dl-page page">
      <PageHeader
        eyebrow={t("downloads.eyebrow")}
        title={t("downloads.title")}
        description={t("downloads.description")}
        actions={<MagnetInputBar />}
      />

      {/* Hero Control Center & Network Sparkline */}
      <BandwidthHero />
      <BandwidthSparkline />

      {/* Filter and View Mode Switcher */}
      <DownloadsFilterBar
        query={query}
        onQueryChange={setQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        sort={sort}
        onSortChange={setSort}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        counts={counts}
      />

      {/* Main Downloads List / Grid / Table Section */}
      <section className="dl-section" aria-label="Downloads List">
        <div className="dl-section-header">
          <h3 className="dl-section-title">
            {statusFilter === "all"
              ? t("downloads.title")
              : counts[statusFilter] !== undefined
              ? `${counts[statusFilter]} ${statusFilter}`
              : t("downloads.title")}
            {filteredDownloads.length > 0 && (
              <span className="dl-section-count">{filteredDownloads.length}</span>
            )}
          </h3>

          <DownloadsToolbar
            activeCount={activeDownloads.length}
            historyCount={completedDownloads.length}
            selectedCount={selectedIds.size}
            totalVisibleCount={filteredDownloads.length}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onPauseSelected={handleBatchPause}
            onResumeSelected={handleBatchResume}
            onRemoveSelected={handleBatchRemove}
            onDeleteSelected={() => setBatchDeleteOpen(true)}
          />
        </div>

        {/* Empty States & Content Presentation */}
        {loading && downloads.length === 0 ? (
          <div className="dl-list-empty">
            <div className="spinner-small" />
            <span>{t("downloads.loading")}</span>
          </div>
        ) : filteredDownloads.length === 0 && downloads.length > 0 ? (
          <div className="dl-list-no-match">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 32, height: 32, opacity: 0.4 }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p>{t("downloads.noActiveMatch")}</p>
          </div>
        ) : downloads.length === 0 ? (
          <div className="dl-list-empty">
            <div className="dl-list-empty-icon-wrap">
              <svg
                className="dl-list-empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <h4 className="dl-list-empty-title">{t("downloads.noActive")}</h4>
            <p className="dl-list-empty-hint">{t("downloads.noActiveHint")}</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="dl-grid-view">
            {filteredDownloads.map((d) => (
              <DownloadGridCard
                key={d.id}
                download={d}
                selected={selectedIds.has(d.id)}
                onToggleSelect={toggleSelect}
                onPause={handlePause}
                onResume={handleResume}
                onRemove={handleRemove}
                onDeleteFiles={handleDeleteFiles}
              />
            ))}
          </div>
        ) : (
          <div className={`dl-list${viewMode === "compact" ? " dl-list--compact" : ""}`}>
            {filteredDownloads.map((d) => (
              <DownloadRow
                key={d.id}
                download={d}
                compact={viewMode === "compact"}
                selected={selectedIds.has(d.id)}
                onToggleSelect={toggleSelect}
                onPause={handlePause}
                onResume={handleResume}
                onRemove={handleRemove}
                onDeleteFiles={handleDeleteFiles}
              />
            ))}
          </div>
        )}
      </section>

      {/* Delete Single from disk confirmation */}
      <ConfirmModal
        open={deletingContext !== null}
        title={
          deletingContext ? (
            <>
              {t("downloads.deleteDiskTitle")}{" "}
              <strong>{deletingContext.name}</strong>?
            </>
          ) : (
            t("downloads.deleteDiskTitle")
          )
        }
        message={
          deletingContext &&
          t("downloads.deleteDiskBody", {
            size: formatBytesShort(deletingContext.downloaded, unit),
            path: deletingContext.savePath,
          })
        }
        warning={
          deletingContext?.autoExtract &&
          t("downloads.deleteDiskWarning")
        }
        confirmLabel={
          deletingContext?.autoExtract
            ? t("downloads.deleteArchives")
            : t("downloads.deleteDiskLabel")
        }
        busy={deletingBusy}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deletingBusy) setDeletingContext(null);
        }}
      />

      {/* Batch delete confirmation */}
      <ConfirmModal
        open={batchDeleteOpen}
        title={`${t("downloads.deleteDiskTitle")} (${selectedIds.size} downloads)`}
        message={`This will delete files for ${selectedIds.size} selected downloads (${formatBytesShort(selectedBytes, unit)}) from disk. This action cannot be undone.`}
        confirmLabel={t("downloads.deleteDiskLabel")}
        busy={batchBusy}
        onConfirm={handleBatchConfirmDelete}
        onCancel={() => {
          if (!batchBusy) setBatchDeleteOpen(false);
        }}
      />

      {/* Remove active download confirmation */}
      <ConfirmModal
        open={removingContext !== null}
        title={
          removingContext ? (
            <>
              {t("downloads.removeTitle")}{" "}
              <strong>{removingContext.name}</strong>?
            </>
          ) : (
            t("downloads.removeTitle")
          )
        }
        message={removingContext && t("downloads.removeBody")}
        confirmLabel={t("downloads.removeLabel")}
        busy={removingBusy}
        onConfirm={confirmRemoveActive}
        onCancel={() => {
          if (!removingBusy) setRemovingContext(null);
        }}
      />
    </div>
  );
}
