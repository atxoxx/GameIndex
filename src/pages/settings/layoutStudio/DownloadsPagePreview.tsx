import { useMemo } from "react";
import {
  Activity,
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FolderOpen,
  Gauge,
  Globe,
  HardDrive,
  History,
  LayoutGrid,
  LayoutList,
  List,
  Magnet,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Rows3,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicSearchBar,
  SchematicSparkline,
  Track,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./DownloadsPagePreview.css";

export interface DownloadsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

type PrimaryTone = "pause" | "resume" | "retry";

interface StatusChip {
  key: string;
  label: string;
  count: number;
  active?: boolean;
}

interface QueueRow {
  status: string;
  statusLabel: string;
  source: string;
  pct: number;
  size: string;
  meta: string;
  eta?: string;
  swarm?: boolean;
  primary: { tone: PrimaryTone; label: string };
  error?: string;
}

/**
 * Layout Studio preview for `/downloads`.
 *
 * Mirrors the shipped page: page header, the persistent bandwidth band, the
 * Active/Scheduled/History switcher, then the bodies those tabs own — the
 * dashboard-gated network graph, the status filter bar, the queue with its
 * toolbar, the scheduler and the history ledger.
 */
export function DownloadsPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: DownloadsPagePreviewProps) {
  const { t, language } = useLanguage();
  const widgetDrag = useOrderDrag(onReorderWidgets);

  const byId = useMemo(
    () => new Map(widgetItems.map((item, index) => [item.id, { item, index }])),
    [widgetItems],
  );

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(language, { weekday: "short" });
    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2024, 0, 1 + index)));
  }, [language]);

  const statusChips = useMemo<StatusChip[]>(
    () => [
      { key: "all", label: t("downloadsFilter.statusAll"), count: 3, active: true },
      { key: "downloading", label: t("downloadsFilter.statusActive"), count: 1 },
      { key: "seeding", label: t("downloadRow.badgeSeeding"), count: 0 },
      { key: "queued", label: t("download.status.queued"), count: 1 },
      { key: "paused", label: t("downloadsFilter.statusPaused"), count: 1 },
      { key: "completed", label: t("downloadsFilter.statusCompleted"), count: 14 },
      { key: "error", label: t("downloadsFilter.statusErrored"), count: 1 },
    ],
    [t],
  );

  const historyChips = useMemo<StatusChip[]>(
    () => [
      { key: "all", label: t("downloadsFilter.statusAll"), count: 14, active: true },
      { key: "completed", label: t("downloadsFilter.statusCompleted"), count: 11 },
      { key: "removed", label: t("downloadsFilter.statusRemoved"), count: 2 },
      { key: "error", label: t("downloadsFilter.statusErrored"), count: 1 },
    ],
    [t],
  );

  const queueRows = useMemo<QueueRow[]>(
    () => [
      {
        status: "downloading",
        statusLabel: t("download.status.downloading"),
        source: "Steam",
        pct: 44,
        size: "18.4 GB / 42.0 GB",
        meta: "↓ 48.5 MB/s",
        eta: "ETA: 4m 12s",
        swarm: true,
        primary: { tone: "pause", label: t("downloadRow.pause") },
      },
      {
        status: "paused",
        statusLabel: t("download.status.paused"),
        source: "GOG",
        pct: 32,
        size: "8.2 GB / 25.0 GB",
        meta: t("download.status.paused"),
        primary: { tone: "resume", label: t("downloadRow.resume") },
      },
      {
        status: "error",
        statusLabel: t("download.status.error"),
        source: "Direct",
        pct: 68,
        size: "12.6 GB / 18.5 GB",
        meta: "",
        primary: { tone: "retry", label: t("downloadRow.retry") },
        error: "Connection reset by peer",
      },
    ],
    [t],
  );

  const primaryIcon = (tone: PrimaryTone) => {
    if (tone === "resume") return <Play size={8} />;
    if (tone === "retry") return <RotateCcw size={8} />;
    return <Pause size={8} />;
  };

  const automationSettings: { label: string; value?: string; on?: boolean }[] = [
    { label: t("scheduler.maxConcurrent"), value: "3" },
    { label: t("scheduler.autoStart"), on: true },
    { label: t("scheduler.pauseOnGame"), on: true },
    { label: t("scheduler.pauseOutsideWindow"), on: false },
  ];

  const renderCard = (id: string, variant: "card" | "slot" = "card", children?: React.ReactNode) => {
    const entry = byId.get(id);
    if (!entry) return null;
    const { item, index } = entry;
    const isDragging = widgetDrag.dragIndex === index;
    const isDropTarget =
      widgetDrag.overIndex === index &&
      widgetDrag.dragIndex !== null &&
      widgetDrag.dragIndex !== index;
    const isLit = highlightedId === item.id;

    return (
      <StudioPageWidgetCard
        key={item.id}
        item={item}
        index={index}
        isDragging={isDragging}
        isDropTarget={isDropTarget}
        isLit={isLit}
        inspectMode={inspectMode}
        variant={variant}
        onStartDrag={(e) => {
          if (e.button !== 0 || inspectMode) return;
          widgetDrag.startDrag(index, { x: e.clientX, y: e.clientY });
        }}
        onToggle={() => onToggleWidget(item.id)}
        onInspect={onInspectElement}
      >
        {children}
      </StudioPageWidgetCard>
    );
  };

  return (
    <div
      className="studio-page-preview studio-page-preview--downloads"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Page header — eyebrow, title, description, add-download action */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsHeader",
          "slot",
          <div className="studio-dl-header-mock">
            <div className="studio-dl-header-left">
              <Download size={13} className="studio-dl-header-icon" />
              <div className="studio-dl-header-text">
                <span className="studio-dlp-eyebrow">{t("downloads.eyebrow")}</span>
                <span className="studio-dlp-title">{t("downloads.title")}</span>
                <Line w={72} h={6} />
              </div>
            </div>
            <div className="studio-dl-header-right">
              <span className="studio-dl-btn-add">
                <Plus size={9} />
                <span>{t("downloads.addDownload")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Persistent bandwidth band — rates, destination drive, transfer actions */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsHero",
          "slot",
          <div className="studio-dlp-hero">
            <div className="studio-dlp-rate">
              <span className="studio-dlp-rate-head">
                <i className="studio-dlp-rate-dot" aria-hidden="true" />
                {t("downloads.downloadSpeed")}
              </span>
              <span className="studio-dlp-rate-value">48.5 MB/s</span>
              <span className="studio-dlp-rate-sub">
                <span>▲ 64.2 MB/s</span>
                <span>128.4 GB</span>
              </span>
            </div>

            <span className="studio-dlp-vsep" aria-hidden="true" />

            <div className="studio-dlp-rate">
              <span className="studio-dlp-rate-head">
                <i className="studio-dlp-rate-dot studio-dlp-rate-dot--up" aria-hidden="true" />
                {t("downloads.uploadSpeed")}
              </span>
              <span className="studio-dlp-rate-value">2.1 MB/s</span>
              <span className="studio-dlp-rate-sub">
                <span>▲ 4.0 MB/s</span>
                <span>{t("downloads.liveSwarm")}</span>
              </span>
            </div>

            <div className="studio-dlp-drive">
              <span className="studio-dlp-drive-head">
                <HardDrive size={10} aria-hidden="true" />
                <span className="studio-dlp-drive-name">D:</span>
                <span className="studio-dlp-drive-free">
                  412 GB {t("downloads.driveFree")}
                </span>
                <span className="studio-dlp-drive-total">/ 2.0 TB</span>
              </span>
              <Track value={78} color="var(--color-accent)" height={3} />
              <span className="studio-dlp-drive-required">
                {t("downloads.driveRequired")}: 82.4 GB
              </span>
            </div>

            <div className="studio-dlp-actions">
              <span className="studio-dlp-icon-btn" title={t("downloadsToolbar.pauseAll")}>
                <Pause size={9} />
              </span>
              <span className="studio-dlp-icon-btn" title={t("downloadsToolbar.resumeAll")}>
                <Play size={9} />
              </span>
              <span
                className="studio-dlp-icon-btn studio-dlp-icon-btn--counted"
                title={t("downloadsToolbar.retryAllHint")}
              >
                <RotateCcw size={9} />
                <span className="studio-dlp-count">1</span>
              </span>
              <span className="studio-dlp-vsep" aria-hidden="true" />
              <span className="studio-dlp-pill-btn">
                <BarChart3 size={9} />
                <span>{t("downloadStats.buttonLabel")}</span>
              </span>
              <span className="studio-dlp-pill-btn">
                <SlidersHorizontal size={9} />
                <span>{t("downloads.speedLimiterTitle")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 3. Section switcher — Active / Scheduled / History */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsTabs",
          "slot",
          <div className="studio-dl-tabs-mock">
            <span className="studio-dlp-tab is-active">
              <LayoutList size={10} aria-hidden="true" />
              <span>{t("downloads.tabActive")}</span>
              <span className="studio-dlp-tab-count">1</span>
            </span>
            <span className="studio-dlp-tab">
              <CalendarClock size={10} aria-hidden="true" />
              <span>{t("downloads.tabScheduled")}</span>
              <span className="studio-dlp-tab-count">2</span>
              <i className="studio-dlp-tab-dot" title={t("scheduler.windowOpen")} />
            </span>
            <span className="studio-dlp-tab">
              <History size={10} aria-hidden="true" />
              <span>{t("downloads.tabHistory")}</span>
              <span className="studio-dlp-tab-count">14</span>
            </span>
          </div>,
        )}
      </div>

      {/* 4. Active tab: network telemetry (inside the dashboard widget gate) */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsSparkline",
          "card",
          <div className="studio-dlp-spark">
            <div className="studio-dlp-spark-head">
              <div className="studio-dlp-spark-titles">
                <span className="studio-dlp-spark-title">
                  <Activity size={10} aria-hidden="true" />
                  {t("downloads.networkTelemetry")}
                </span>
                <span className="studio-dlp-toggles">
                  {[t("downloads.time60s"), t("downloads.time3m"), t("downloads.time5m")].map(
                    (label, index) => (
                      <span
                        key={label}
                        className={`studio-dlp-toggle${index === 0 ? " is-active" : ""}`}
                      >
                        {label}
                      </span>
                    ),
                  )}
                </span>
              </div>
              <div className="studio-dlp-spark-stats">
                <span className="studio-dlp-legend">
                  <i className="studio-dlp-legend-dot" aria-hidden="true" />↓ 48.5 MB/s
                </span>
                <span className="studio-dlp-legend">
                  <i
                    className="studio-dlp-legend-dot studio-dlp-legend-dot--up"
                    aria-hidden="true"
                  />
                  ↑ 2.1 MB/s
                </span>
                <span className="studio-dlp-peak">
                  {t("downloads.maxSpeedLabel", { speed: "64.2 MB/s" })}
                </span>
                <ChevronDown size={10} className="studio-dlp-chev" aria-hidden="true" />
              </div>
            </div>
            <SchematicSparkline height={36} color="var(--color-accent)" />
          </div>,
        )}
      </div>

      {/* 5. Status filter, search, sort and view mode */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsFilter",
          "slot",
          <div className="studio-dlp-filter">
            <div className="studio-dlp-chips">
              {statusChips.map((chip) => (
                <span
                  key={chip.key}
                  className={`studio-dlp-chip${chip.active ? " is-active" : ""}`}
                >
                  <span>{chip.label}</span>
                  <span className="studio-dlp-chip-count">{chip.count}</span>
                </span>
              ))}
            </div>
            <div className="studio-dlp-tools">
              <span className="studio-dlp-search">
                <SchematicSearchBar placeholder={t("downloadsFilter.searchPlaceholder")} />
              </span>
              <span className="studio-dlp-select">
                <span>{t("downloadsFilter.sortNewest")}</span>
                <ChevronDown size={9} aria-hidden="true" />
              </span>
              <span className="studio-dlp-views">
                <span className="studio-dlp-view is-active" title={t("downloadsFilter.viewDetailed")}>
                  <List size={9} />
                </span>
                <span className="studio-dlp-view" title={t("downloadsFilter.viewGrid")}>
                  <LayoutGrid size={9} />
                </span>
                <span className="studio-dlp-view" title={t("downloadsFilter.viewCompact")}>
                  <Rows3 size={9} />
                </span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 6. Active tab: queue header, bulk toolbar and transfer rows */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsQueue",
          "slot",
          <div className="studio-dlp-queue">
            <div className="studio-dlp-section-head">
              <span className="studio-dlp-section-title">
                {t("downloads.title")}
                <span className="studio-dlp-section-count">3</span>
              </span>
              <span className="studio-dlp-selectall">{t("downloadFiles.selectAll")}</span>
            </div>

            {queueRows.map((row) => (
              <div key={row.status} className={`studio-dlp-row is-${row.status}`}>
                <span className="studio-dlp-check" aria-hidden="true" />
                <span className="studio-dlp-thumb" aria-hidden="true">
                  <Download size={10} />
                </span>
                <div className="studio-dlp-main">
                  <div className="studio-dlp-row-head">
                    <Line w={34} h={9} />
                    <span className={`studio-dlp-status is-${row.status}`}>{row.statusLabel}</span>
                    <span className="studio-dlp-source">{row.source}</span>
                  </div>
                  <div className="studio-dlp-progress-line">
                    <span className="studio-dlp-progress" aria-hidden="true">
                      <span className="studio-dlp-progress-fill" style={{ width: `${row.pct}%` }} />
                    </span>
                    <span className="studio-dlp-pct">{row.pct}%</span>
                    <span className="studio-dlp-size">{row.size}</span>
                  </div>
                  {row.error ? (
                    <span className="studio-dlp-error">{row.error}</span>
                  ) : (
                    <div className="studio-dlp-meta">
                      <span>{row.meta}</span>
                      {row.eta && <span>{row.eta}</span>}
                      {row.swarm && (
                        <span className="studio-dlp-swarm" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="studio-dlp-row-actions">
                  <span className={`studio-dlp-primary is-${row.primary.tone}`}>
                    {primaryIcon(row.primary.tone)}
                    <span>{row.primary.label}</span>
                  </span>
                  <span className="studio-dlp-icon-btn" title={t("downloads.rowActions")}>
                    <MoreHorizontal size={9} />
                  </span>
                </div>
              </div>
            ))}
          </div>,
        )}
      </div>

      {/* 7. Scheduled tab: window, bandwidth rules, automation and waiting queue */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsScheduled",
          "slot",
          <div className="studio-dlp-sched">
            <div className="studio-dlp-card-head">
              <span className="studio-dlp-card-title">
                <CalendarClock size={10} aria-hidden="true" />
                {t("scheduler.title")}
              </span>
              <span className="studio-dlp-sched-actions">
                <span className="studio-dlp-status is-open">{t("scheduler.statusWindowOpen")}</span>
                <span className="studio-dlp-switch is-on" aria-hidden="true" />
              </span>
            </div>

            <div className="studio-dlp-grid2">
              <div className="studio-dlp-card">
                <div className="studio-dlp-card-head">
                  <span className="studio-dlp-card-title">
                    <CalendarClock size={10} aria-hidden="true" />
                    {t("scheduler.groupWindow")}
                  </span>
                  <span className="studio-dlp-window-badge">02:00–06:00 · 4h</span>
                </div>
                <div className="studio-dlp-week">
                  {weekdayLabels.map((label, index) => (
                    <div className="studio-dlp-week-row" key={label + index}>
                      <span className="studio-dlp-week-day">{label}</span>
                      <span className="studio-dlp-week-track" aria-hidden="true">
                        {index < 5 && <span className="studio-dlp-week-band" />}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="studio-dlp-fields">
                  <span className="studio-dlp-field">
                    <span>{t("scheduler.windowStart")}</span>
                    <b>02:00</b>
                  </span>
                  <span className="studio-dlp-field">
                    <span>{t("scheduler.windowEnd")}</span>
                    <b>06:00</b>
                  </span>
                  <span className="studio-dlp-field studio-dlp-field--days">
                    <span>{t("scheduler.days")}</span>
                    <span className="studio-dlp-day-chips" aria-hidden="true">
                      {weekdayLabels.map((label, index) => (
                        <i key={label + index} className={index < 5 ? "is-on" : undefined} />
                      ))}
                    </span>
                  </span>
                </div>
              </div>

              <div className="studio-dlp-card">
                <div className="studio-dlp-card-head">
                  <span className="studio-dlp-card-title">
                    <Gauge size={10} aria-hidden="true" />
                    {t("scheduler.rulesTitle")}
                  </span>
                  <span className="studio-dlp-pill-btn">
                    <Plus size={9} />
                    <span>{t("scheduler.addRule")}</span>
                  </span>
                </div>
                <p className="studio-dlp-hint">{t("scheduler.rulesHint")}</p>
                {[0, 1].map((rule) => (
                  <div className="studio-dlp-rule" key={rule}>
                    <div className="studio-dlp-rule-head">
                      <Line w={rule === 0 ? 46 : 32} h={8} />
                      <Trash2 size={9} className="studio-dlp-rule-remove" aria-hidden="true" />
                    </div>
                    <div className="studio-dlp-rule-fields">
                      <span>00:00</span>
                      <span>06:00</span>
                      <span>{t("scheduler.ruleDownload")} 2048</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="studio-dlp-card">
              <div className="studio-dlp-card-head">
                <span className="studio-dlp-card-title">
                  <Gauge size={10} aria-hidden="true" />
                  {t("scheduler.groupAutomation")}
                </span>
              </div>
              <div className="studio-dlp-settings">
                {automationSettings.map((setting) => (
                  <div className="studio-dlp-setting" key={setting.label}>
                    <span className="studio-dlp-setting-label">{setting.label}</span>
                    {setting.value ? (
                      <span className="studio-dlp-number">{setting.value}</span>
                    ) : (
                      <span
                        className={`studio-dlp-switch${setting.on ? " is-on" : ""}`}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="studio-dlp-card">
              <div className="studio-dlp-card-head">
                <span className="studio-dlp-card-title">
                  <CalendarClock size={10} aria-hidden="true" />
                  {t("scheduler.queueTitle")}
                  <span className="studio-dlp-section-count">2</span>
                </span>
              </div>
              {[0, 1].map((row) => (
                <div className="studio-dlp-queue-row" key={row}>
                  <div className="studio-dlp-queue-main">
                    <div className="studio-dlp-queue-title">
                      <Line w={row === 0 ? 42 : 30} h={8} />
                      <span className="studio-dlp-status is-paused">{t("download.status.paused")}</span>
                    </div>
                    <span className="studio-dlp-queue-size">
                      {row === 0 ? "8.2 GB / 25.0 GB" : "4.0 GB / 12.0 GB"}
                    </span>
                  </div>
                  <div className="studio-dlp-queue-controls">
                    <span className="studio-dlp-stepper" title={t("scheduler.priorityHint")}>
                      <ChevronUp size={9} aria-hidden="true" />
                      <span className="studio-dlp-stepper-value">{row === 0 ? 2 : 1}</span>
                      <ChevronDown size={9} aria-hidden="true" />
                    </span>
                    <span className="studio-dlp-queue-when">{t("scheduler.noSchedule")}</span>
                    <span className="studio-dlp-pill-btn">
                      <Play size={9} />
                      <span>{t("scheduler.startNow")}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>,
        )}
      </div>

      {/* 8. History tab: search, state chips, day groups and ledger rows */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsHistory",
          "slot",
          <div className="studio-dlp-hist">
            <div className="studio-dlp-hist-toolbar">
              <span className="studio-dlp-search">
                <SchematicSearchBar placeholder={t("downloads.historySearch")} />
              </span>
              <div className="studio-dlp-chips">
                {historyChips.map((chip) => (
                  <span
                    key={chip.key}
                    className={`studio-dlp-chip${chip.active ? " is-active" : ""}`}
                  >
                    <span>{chip.label}</span>
                    <span className="studio-dlp-chip-count">{chip.count}</span>
                  </span>
                ))}
              </div>
              <span className="studio-dlp-hist-count">
                {t("downloads.countLabel", { count: 14 })}
              </span>
              <span className="studio-dlp-clear">
                <Trash2 size={9} aria-hidden="true" />
                <span>{t("downloads.clearHistory")}</span>
              </span>
            </div>

            {[
              { label: t("downloads.today"), count: 2, rows: ["Magnet", "Globe"] },
              { label: t("downloads.yesterday"), count: 1, rows: ["Zap"] },
            ].map((group) => (
              <div className="studio-dlp-hist-group" key={group.label}>
                <div className="studio-dlp-group-head">
                  <span className="studio-dlp-group-label">{group.label}</span>
                  <span className="studio-dlp-section-count">{group.count}</span>
                  <span className="studio-dlp-group-line" aria-hidden="true" />
                </div>
                {group.rows.map((kind, index) => (
                  <div className="studio-dlp-hist-row" key={kind + index}>
                    <span className={`studio-dlp-hist-tile is-${kind.toLowerCase()}`}>
                      {kind === "Magnet" && <Magnet size={10} />}
                      {kind === "Zap" && <Zap size={10} />}
                      {kind === "Globe" && <Globe size={10} />}
                    </span>
                    <div className="studio-dlp-hist-main">
                      <div className="studio-dlp-row-head">
                        <Line w={index === 0 ? 38 : 28} h={8} />
                        <span className="studio-dlp-status is-completed">
                          {t("downloadsFilter.statusCompleted")}
                        </span>
                        <span className="studio-dlp-source">Steam</span>
                      </div>
                      <div className="studio-dlp-hist-meta">
                        <span className="studio-dlp-hist-path">
                          <HardDrive size={9} aria-hidden="true" />
                          D:/Games/Library
                        </span>
                        <span>42.0 GB</span>
                        <span>18:42</span>
                      </div>
                    </div>
                    <div className="studio-dlp-hist-actions">
                      <span className="studio-dlp-icon-btn" title={t("downloadRow.openFolder")}>
                        <FolderOpen size={9} />
                      </span>
                      <span className="studio-dlp-icon-btn" title={t("downloads.copyPath")}>
                        <Copy size={9} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>,
        )}
      </div>

    </div>
  );
}
