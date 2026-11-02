import { useMemo } from "react";
import {
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  HardDrive,
  Library,
  Pause,
  Settings2,
  Trophy,
  Users,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  MiniTile,
  SchematicCardRail,
  SchematicHero,
  Track,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./HomePagePreview.css";

export interface HomePagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  /** Simple UI mode swaps the hero for the first-run welcome header. */
  simpleUi?: boolean;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

/** The pinned shelves the home ShelfRails widget draws, one rail per shelf. */
const SAMPLE_SHELVES = [
  { nameKey: "game.status.backlog", count: 24 },
  { nameKey: "game.status.completed", count: 18 },
];

/** Rows HomeAchievements draws: recent unlock, game name, rarity share. */
const SAMPLE_ACHIEVEMENTS = [
  { name: 58, rarity: "4.2%" },
  { name: 46, rarity: "12.8%" },
  { name: 70, rarity: "31.5%" },
];

export function HomePagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  simpleUi = false,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: HomePagePreviewProps) {
  const { t } = useLanguage();
  const widgetDrag = useOrderDrag(onReorderWidgets);

  const byId = useMemo(
    () => new Map(widgetItems.map((item, index) => [item.id, { item, index }])),
    [widgetItems],
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

  // HomeSection widgets carry a "View all" link; the library rails
  // (Continue Playing, Recently Added) carry a collapse chevron instead.
  const railAction = (kind: "viewAll" | "collapse") => (
    <div className="studio-home-rail-head">
      {kind === "viewAll" ? (
        <span className="studio-home-rail-viewall">
          {t("home.viewAll")}
          <ChevronRight size={8} aria-hidden="true" />
        </span>
      ) : (
        <span className="studio-home-rail-collapse">
          <ChevronUp size={9} aria-hidden="true" />
        </span>
      )}
    </div>
  );

  return (
    <div
      className="studio-page-preview studio-page-preview--home"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* First-run Simple UI header: HomePage renders it instead of the hero,
          outside every PageWidget. Kept as static chrome so the hero widget
          stays reorderable. */}
      {simpleUi && (
        <div className="studio-home-simple-header">
          <span className="studio-home-simple-tag">{t("settings.appearance.simpleUiTitle")}</span>
          <div className="studio-home-simple-text">
            <span className="studio-home-simple-title">{t("home.simple.title")}</span>
            <span className="studio-home-simple-subtitle">{t("home.simple.subtitle")}</span>
          </div>
          <div className="studio-home-simple-actions">
            <span className="studio-home-simple-btn is-primary">
              {t("home.simple.browseStore")}
            </span>
            <span className="studio-home-simple-btn">{t("home.simple.yourLibrary")}</span>
          </div>
        </div>
      )}

      {/* 1. Spotlight Hero Banner */}
      <div className="studio-page-full">
        {renderCard("hero", "slot", <SchematicHero variant="home" />)}
      </div>

      {/* 2. Glanceable Quick Stats Bar */}
      <div className="studio-page-full">
        {renderCard(
          "homeQuickStats",
          "slot",
          <div className="studio-home-stats-strip">
            <MiniTile
              label={t("home.stats.library")}
              value="148"
              icon={Library}
              footer={
                <span className="studio-home-kpi-detail">
                  {t("home.stats.installed", { count: 148 })}
                </span>
              }
            />
            <MiniTile
              label={t("home.stats.weekPlaytime")}
              value="6h 30m"
              icon={Clock}
              footer={
                <span className="studio-home-kpi-detail">
                  {t("home.stats.sessions", { count: 14 })}
                </span>
              }
            />
            <MiniTile
              label={t("home.stats.achievements")}
              value="84%"
              icon={Trophy}
              footer={
                <span className="studio-home-kpi-detail">
                  {t("home.stats.unlocked", { count: 84 })}
                </span>
              }
            />
            <MiniTile
              label={t("home.stats.storage")}
              value="3.2 TB"
              icon={HardDrive}
              footer={
                <span className="studio-home-kpi-detail">
                  {t("home.stats.sized", { count: 120 })}
                </span>
              }
            />
          </div>,
        )}
      </div>

      {/* 3. Dashboard Header with the Customize trigger. Rendered outside
             PageWidget on the real page, so it stays put here too. */}
      <div className="studio-home-dashboard-header">
        <span className="studio-home-dashboard-title">{t("stats.tab.overview")}</span>
        <span className="studio-home-customize-btn">
          <Settings2 size={10} aria-hidden="true" />
          <span>{t("home.customize.title")}</span>
        </span>
      </div>

      {/* 4. Two-Column Player Dashboard */}
      <div className="studio-home-dashboard">
        {/* Left Sidebar */}
        <aside className="studio-home-sidebar">
          {/* Quick Launch */}
          {renderCard(
            "homeQuickLaunch",
            "card",
            <>
              {railAction("viewAll")}
              <div className="studio-home-quicklaunch">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="studio-home-quicklaunch-tile">
                    <span className="studio-home-quicklaunch-dot" />
                    <Line w={60} />
                  </div>
                ))}
              </div>
            </>,
          )}

          {/* Activity Recap */}
          {renderCard(
            "homeActivity",
            "card",
            <div className="studio-home-activity-body">
              {railAction("viewAll")}
              <div className="studio-home-activity-cells">
                <span className="studio-home-activity-cell">
                  <span className="studio-home-activity-cell-value">6h 30m</span>
                  <span className="studio-home-activity-cell-label">
                    {t("activityDash.totalPlaytime")}
                  </span>
                </span>
                <span className="studio-home-activity-cell">
                  <span className="studio-home-activity-cell-value">14</span>
                  <span className="studio-home-activity-cell-label">
                    {t("activityDash.sessions")}
                  </span>
                </span>
                <span className="studio-home-activity-cell">
                  <span className="studio-home-activity-cell-value">5</span>
                  <span className="studio-home-activity-cell-label">
                    {t("home.activity.gamesPlayed")}
                  </span>
                </span>
              </div>
              <div className="studio-home-activity-footer">
                <span className="studio-home-activity-mostlabel">
                  {t("home.activity.mostPlayed")}
                </span>
                <Line w={38} />
                <span className="studio-home-activity-hours">6h 12m</span>
              </div>
              <div className="studio-home-sparkline" aria-hidden="true">
                {[30, 65, 45, 90, 60, 100, 75].map((h, i) => (
                  <i key={i} style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>,
          )}

          {/* Achievements Showcase: a list of recent unlocks with rarity share */}
          {renderCard(
            "homeAchievements",
            "card",
            <div className="studio-home-achievements-body">
              {railAction("viewAll")}
              {SAMPLE_ACHIEVEMENTS.map((row) => (
                <div key={row.rarity} className="studio-home-ach-row">
                  <span className="studio-home-ach-icon">
                    <Trophy size={8} aria-hidden="true" />
                  </span>
                  <span className="studio-home-ach-meta">
                    <Line w={row.name} />
                    <Line w={34} />
                  </span>
                  <span className="studio-home-ach-rarity">{row.rarity}</span>
                </div>
              ))}
            </div>,
          )}

          {/* Friends Feed */}
          {renderCard(
            "homeFriends",
            "card",
            <div className="studio-home-friends-body">
              {railAction("viewAll")}
              {[0, 1, 2].map((i) => (
                <div key={i} className="studio-home-friend-row">
                  <span className="studio-home-friend-avatar">
                    <Users size={8} />
                  </span>
                  <div className="studio-home-friend-meta">
                    <Line w={55} />
                    <Line w={35} />
                  </div>
                  <span
                    className={`studio-home-friend-status${i === 0 ? " is-online" : ""}`}
                  />
                </div>
              ))}
            </div>,
          )}
        </aside>

        {/* Right Main Column */}
        <div className="studio-home-main">
          {/* Continue Playing */}
          {renderCard(
            "homeContinuePlaying",
            "card",
            <>
              {railAction("collapse")}
              <SchematicCardRail variant="progress" count={3} />
            </>,
          )}

          {/* Recently Added */}
          {renderCard(
            "homeRecentlyAdded",
            "card",
            <>
              {railAction("collapse")}
              <SchematicCardRail variant="standard" count={3} />
            </>,
          )}

          {/* Pinned shelves: one rail per shelf, each with its own collapse toggle */}
          {renderCard(
            "homeShelves",
            "card",
            <div className="studio-home-shelves">
              {SAMPLE_SHELVES.map((shelf) => (
                <div key={shelf.nameKey} className="studio-home-shelf-row">
                  <div className="studio-home-shelf-head">
                    <span className="studio-home-shelf-dot" aria-hidden="true" />
                    <span className="studio-home-shelf-name">{t(shelf.nameKey)}</span>
                    <span className="studio-home-shelf-count">
                      {t("shelves.rail.subtitle", { count: shelf.count })}
                    </span>
                    <span className="studio-home-shelf-collapse" aria-hidden="true">
                      <ChevronUp size={9} />
                    </span>
                  </div>
                  <SchematicCardRail variant="standard" count={3} />
                </div>
              ))}
            </div>,
          )}

          {/* Active Downloads */}
          {renderCard(
            "homeDownloads",
            "card",
            <div className="studio-home-download-card">
              {railAction("viewAll")}
              <div className="studio-home-download-row">
                <Download size={11} className="studio-home-download-icon" />
                <div className="studio-home-download-text">
                  <Line w={65} />
                  <span className="studio-home-download-speed">48.2 MB/s · 12 GB / 45 GB</span>
                </div>
                <span className="studio-home-download-pause">
                  <Pause size={9} />
                </span>
              </div>
              <Track value={27} color="var(--color-accent)" />
            </div>,
          )}

          {/* Wishlist Rail */}
          {renderCard(
            "homeWishlist",
            "card",
            <>
              {railAction("viewAll")}
              <SchematicCardRail variant="standard" count={3} />
            </>,
          )}

          {/* Deals Rail */}
          {renderCard(
            "homeDeals",
            "card",
            <>
              {railAction("viewAll")}
              <SchematicCardRail variant="sale" count={3} />
            </>,
          )}

          {/* News Rail */}
          {renderCard(
            "homeNews",
            "card",
            <>
              {railAction("viewAll")}
              <SchematicCardRail variant="news" count={3} />
            </>,
          )}
        </div>
      </div>
    </div>
  );
}
