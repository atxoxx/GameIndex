import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Columns3,
  Download,
  Gamepad2,
  HardDrive,
  HelpCircle,
  Layers,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { Line, SchematicSearchBar, Track } from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./StoragePagePreview.css";

export interface StoragePagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

const DRIVES = [
  { label: "C:", used: "450 GB", games: 42, libraryPct: 13, otherPct: 33, free: "182 GB", low: false },
  { label: "D:", used: "1.8 TB", games: 86, libraryPct: 62, otherPct: 14, free: "312 GB", low: false },
  { label: "E:", used: "950 GB", games: 20, libraryPct: 78, otherPct: 18, free: "24 GB", low: true },
];

const ROWS = [
  { name: 62, platform: "Steam", drive: "D:", size: "124.5 GB", pct: 100, mods: "8.4 GB", played: "2d", measured: "1h", stale: false },
  { name: 48, platform: "GOG", drive: "C:", size: "86.2 GB", pct: 69, mods: "—", played: "1w", measured: "3h", stale: true },
  { name: 54, platform: "Epic", drive: "D:", size: "54.0 GB", pct: 43, mods: "2.1 GB", played: "Never", measured: "1d", stale: false },
  { name: 38, platform: "Steam", drive: "E:", size: "28.4 GB", pct: 23, mods: "—", played: "3w", measured: "Never", stale: false },
];

type FigureTone = "default" | "accent" | "warning" | "danger" | "info";

interface StorageFigure {
  id: string;
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  progress?: number;
  tone: FigureTone;
  /** Unmeasured and Missing are buttons on the real band. */
  action?: boolean;
}

interface FilterChip {
  id: string;
  label: string;
  count: number;
  active?: boolean;
}

/**
 * Layout Studio preview for `/storage`.
 *
 * Mirrors the shipped composition: header, the floating figure band, the
 * Overview/Games/Health/Emulators switcher and the Games view it opens on —
 * drive rail plus recommendation strip, toolbar and the library table.
 */
export function StoragePagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: StoragePagePreviewProps) {
  const { t } = useLanguage();
  const widgetDrag = useOrderDrag(onReorderWidgets);

  const byId = useMemo(
    () => new Map(widgetItems.map((item, index) => [item.id, { item, index }])),
    [widgetItems],
  );

  const figures = useMemo<StorageFigure[]>(
    () => [
      {
        id: "tracked",
        icon: HardDrive,
        label: t("storageStat.tracked"),
        value: "3.2 TB",
        tone: "accent",
      },
      {
        id: "free",
        icon: Layers,
        label: t("storageStat.free"),
        value: "412 GB",
        detail: t("storageStat.freeOf", { total: "3.5 TB" }),
        progress: 88,
        tone: "default",
      },
      {
        id: "games",
        icon: Gamepad2,
        label: t("storageStat.games"),
        value: "148",
        detail: t("storageStat.installedOnly"),
        tone: "default",
      },
      {
        id: "unmeasured",
        icon: HelpCircle,
        label: t("storageStat.unmeasured"),
        value: "18",
        detail: t("storageStat.measureNow"),
        tone: "warning",
        action: true,
      },
      {
        id: "stale",
        icon: AlertTriangle,
        label: t("storageStat.stale"),
        value: "2",
        detail: t("storageStat.fixPaths"),
        tone: "danger",
        action: true,
      },
      {
        id: "largest",
        icon: Sparkles,
        label: t("storageStat.largest"),
        value: "124.5 GB",
        detail: "Elden Ring",
        tone: "default",
      },
      {
        id: "mods",
        icon: Trash2,
        label: t("storageStat.mods"),
        value: "38.4 GB",
        detail: t("storageStat.modsDetail"),
        tone: "info",
      },
    ],
    [t],
  );

  const filterChips = useMemo<FilterChip[]>(
    () => [
      { id: "all", label: t("storage.all"), count: 148, active: true },
      { id: "sized", label: t("storage.sized"), count: 130 },
      { id: "missing", label: t("storage.missing"), count: 18 },
      { id: "stale", label: t("storage.stale"), count: 2 },
      { id: "hasMods", label: t("storage.filter.hasMods"), count: 12 },
    ],
    [t],
  );

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
      className="studio-page-preview studio-page-preview--storage"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Page header — eyebrow, title, description, drive glyph */}
      <div className="studio-page-full">
        {renderCard(
          "storageHeader",
          "slot",
          <div className="studio-storage-header-mock">
            <div className="studio-storage-header-left">
              <HardDrive size={13} className="studio-storage-header-icon" />
              <div className="studio-storage-header-text">
                <span className="studio-stp-eyebrow">{t("storage.eyebrow")}</span>
                <span className="studio-stp-title">{t("storage.title")}</span>
                <Line w={76} h={6} />
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Floating figure band — the page's only summary surface */}
      <div className="studio-page-full">
        {renderCard(
          "storageHero",
          "slot",
          <div className="studio-stp-figures">
            {figures.map((figure) => {
              const Icon = figure.icon;
              return (
                <div
                  key={figure.id}
                  className={`studio-stp-figure is-${figure.tone}${
                    figure.action ? " is-action" : ""
                  }`}
                >
                  <span className="studio-stp-figure-label">
                    <Icon size={9} aria-hidden="true" />
                    {figure.label}
                  </span>
                  <span className="studio-stp-figure-value">{figure.value}</span>
                  {figure.progress !== undefined && <Track value={figure.progress} height={2} />}
                  {figure.detail && <span className="studio-stp-figure-detail">{figure.detail}</span>}
                </div>
              );
            })}
          </div>,
        )}
      </div>

      {/* 3. View switcher — Overview / Games / Health / Emulators */}
      <div className="studio-page-full">
        {renderCard(
          "storageControls",
          "slot",
          <div className="studio-stp-tabs">
            <span className="studio-stp-tab">
              <LayoutDashboard size={10} aria-hidden="true" />
              <span>{t("storage.tab.overview")}</span>
            </span>
            <span className="studio-stp-tab is-active">
              <Table2 size={10} aria-hidden="true" />
              <span>{t("storage.tab.games")}</span>
              <span className="studio-stp-tab-count">148</span>
            </span>
            <span className="studio-stp-tab">
              <ShieldCheck size={10} aria-hidden="true" />
              <span>{t("storage.tab.health")}</span>
              <span className="studio-stp-tab-badge">2</span>
            </span>
            <span className="studio-stp-tab">
              <Gamepad2 size={10} aria-hidden="true" />
              <span>{t("storage.tab.emulators")}</span>
            </span>
          </div>,
        )}
      </div>

      {/* 4. Games view — drive rail beside recommendations, toolbar and table */}
      <div className="studio-page-full">
        {renderCard(
          "storageList",
          "slot",
          <div className="studio-stp-deck">
            <aside className="studio-stp-rail">
              <div className="studio-stp-rail-head">
                <span className="studio-stp-rail-title">
                  <HardDrive size={9} aria-hidden="true" />
                  {t("storage.rail.title")}
                </span>
                <span className="studio-stp-rail-refresh" title={t("storage.recheckTitle")}>
                  <RefreshCw size={9} />
                </span>
              </div>

              <div className="studio-stp-rail-all is-active">
                <span className="studio-stp-rail-all-label">{t("storage.rail.all")}</span>
                <span className="studio-stp-rail-meta">
                  3.2 TB · {t("storage.gamesCount", { count: 148, plural: "s" })}
                </span>
              </div>

              {DRIVES.map((drive) => (
                <div
                  key={drive.label}
                  className={`studio-stp-rail-item${drive.low ? " is-low" : ""}`}
                >
                  <div className="studio-stp-rail-item-head">
                    <span className="studio-stp-drive-tag">{drive.label}</span>
                    <span className="studio-stp-rail-meta-col">
                      <span className="studio-stp-rail-size">{drive.used}</span>
                      <span className="studio-stp-rail-count">
                        {t("storage.gamesCount", {
                          count: drive.games,
                          plural: drive.games === 1 ? "" : "s",
                        })}
                      </span>
                    </span>
                  </div>
                  <span className="studio-stp-rail-bar" aria-hidden="true">
                    <span
                      className="studio-stp-rail-seg is-library"
                      style={{ width: `${drive.libraryPct}%` }}
                    />
                    <span
                      className="studio-stp-rail-seg is-other"
                      style={{ width: `${drive.otherPct}%` }}
                    />
                  </span>
                  <div className="studio-stp-rail-foot">
                    <span className="studio-stp-rail-free">
                      {drive.low && <AlertTriangle size={8} aria-hidden="true" />}
                      {t("storage.rail.free", { size: drive.free })}
                    </span>
                    <span className="studio-stp-rail-open" title={t("storage.rail.open", { drive: drive.label })}>
                      <ChevronRight size={9} />
                    </span>
                  </div>
                </div>
              ))}
            </aside>

            <div className="studio-stp-main">
              {/* Recommendation strip — only while there is something to act on */}
              <div className="studio-stp-recs">
                <span className="studio-stp-recs-lead">
                  <Sparkles size={9} aria-hidden="true" />
                  {t("storageRec.lead")}
                </span>
                <span className="studio-stp-rec is-danger">
                  <AlertTriangle size={9} aria-hidden="true" />
                  <span>{t("storageRec.stale", { count: 2, plural: "s" })}</span>
                  <span className="studio-stp-rec-action">
                    {t("storageRec.stale.action")}
                    <ArrowRight size={8} aria-hidden="true" />
                  </span>
                </span>
                <span className="studio-stp-rec is-warning">
                  <HelpCircle size={9} aria-hidden="true" />
                  <span>{t("storageRec.unmeasured", { count: 18, plural: "s" })}</span>
                  <span className="studio-stp-rec-action">
                    {t("storageRec.unmeasured.action")}
                    <ArrowRight size={8} aria-hidden="true" />
                  </span>
                </span>
                <span className="studio-stp-rec-close" title={t("storageRec.dismiss")}>
                  <X size={9} />
                </span>
              </div>

              {/* Toolbar — search, filter chips, count, column/refresh/select/export */}
              <div className="studio-stp-toolbar">
                <span className="studio-stp-search">
                  <SchematicSearchBar placeholder={t("storage.searchPlaceholder")} />
                </span>
                <div className="studio-stp-chips">
                  {filterChips.map((chip) => (
                    <span
                      key={chip.id}
                      className={`studio-stp-chip${chip.active ? " is-active" : ""}`}
                    >
                      <span>{chip.label}</span>
                      <span className="studio-stp-chip-count">{chip.count}</span>
                    </span>
                  ))}
                </div>
                <span className="studio-stp-count">
                  {t("storage.gamesCount", { count: 148, plural: "s" })}
                </span>
                <div className="studio-stp-toolbar-actions">
                  <span className="studio-stp-tool-btn">
                    <Columns3 size={9} />
                    <span>{t("storage.columns.button")}</span>
                  </span>
                  <span className="studio-stp-tool-btn">
                    <RefreshCw size={9} />
                    <span>{t("common.refresh")}</span>
                  </span>
                  <span className="studio-stp-tool-btn">{t("storage.select")}</span>
                  <span className="studio-stp-tool-btn">
                    <Download size={9} />
                    <span>{t("storage.export")}</span>
                  </span>
                </div>
              </div>

              {/* Library table — name, optional columns, size, chevron */}
              <div className="studio-stp-table">
                <div className="studio-stp-tr is-head">
                  <span className="studio-stp-td is-name">{t("storage.table.name")}</span>
                  <span className="studio-stp-td">{t("storage.columns.platform")}</span>
                  <span className="studio-stp-td">{t("storage.columns.drive")}</span>
                  <span className="studio-stp-td is-sorted">
                    {t("storage.columns.size")}
                    <ArrowDown size={8} aria-hidden="true" />
                  </span>
                  <span className="studio-stp-td">{t("storage.columns.mods")}</span>
                  <span className="studio-stp-td">{t("storage.columns.lastPlayed")}</span>
                  <span className="studio-stp-td">{t("storage.columns.measuredAt")}</span>
                  <span className="studio-stp-td" aria-hidden="true" />
                </div>

                {ROWS.map((row, index) => (
                  <div key={index} className="studio-stp-tr">
                    <span className="studio-stp-td is-name">
                      <span className="studio-stp-art" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="studio-stp-name">
                        <Line w={row.name} h={8} />
                        <span className="studio-stp-badges">
                          {row.stale && (
                            <span className="studio-stp-badge is-danger">{t("storage.stale")}</span>
                          )}
                          {row.mods !== "—" && (
                            <span className="studio-stp-badge is-mods">
                              {t("storageRow.mods.label")}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                    <span className="studio-stp-td is-muted">{row.platform}</span>
                    <span className="studio-stp-td is-muted">{row.drive}</span>
                    <span className="studio-stp-td is-size">
                      <span>{row.size}</span>
                      <span className="studio-stp-sizebar" aria-hidden="true">
                        <span style={{ width: `${row.pct}%` }} />
                      </span>
                    </span>
                    <span className={`studio-stp-td${row.mods !== "—" ? " is-accent" : " is-muted"}`}>
                      {row.mods}
                    </span>
                    <span className={`studio-stp-td${row.stale ? " is-danger" : " is-muted"}`}>
                      {row.played}
                    </span>
                    <span className={`studio-stp-td${row.stale ? " is-danger" : " is-muted"}`}>
                      {row.measured}
                    </span>
                    <span className="studio-stp-td is-chev">
                      <ChevronDown size={9} aria-hidden="true" />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
