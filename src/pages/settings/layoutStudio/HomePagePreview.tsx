import { useMemo } from "react";
import {
  Activity,
  Download,
  Gamepad2,
  HardDrive,
  Pause,
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

export interface HomePagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function HomePagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
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
          widgetDrag.startDrag(index);
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
      className="studio-page-preview studio-page-preview--home"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
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
            <MiniTile label="Games" value="148" icon={Gamepad2} />
            <MiniTile label="Time" value="428h" icon={Activity} />
            <MiniTile label="Storage" value="3.2 TB" icon={HardDrive} />
            <MiniTile label="Trophies" value="84%" icon={Trophy} />
          </div>,
        )}
      </div>

      {/* 3. Two-Column Player Dashboard */}
      <div className="studio-home-dashboard">
        {/* Left Sidebar */}
        <aside className="studio-home-sidebar">
          {/* Quick Launch */}
          {renderCard(
            "homeQuickLaunch",
            "card",
            <div className="studio-home-quicklaunch">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="studio-home-quicklaunch-tile">
                  <span className="studio-home-quicklaunch-dot" />
                  <Line w={60} />
                </div>
              ))}
            </div>,
          )}

          {/* Activity Recap */}
          {renderCard(
            "homeActivity",
            "card",
            <div className="studio-home-activity-body">
              <div className="studio-home-sparkline" aria-hidden="true">
                {[30, 65, 45, 90, 60, 100, 75].map((h, i) => (
                  <i key={i} style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="studio-home-activity-footer">
                <Line w={45} />
                <span className="studio-home-activity-hours">18.4 hrs</span>
              </div>
            </div>,
          )}

          {/* Achievements Showcase */}
          {renderCard(
            "homeAchievements",
            "card",
            <div className="studio-home-achievements-body">
              <div className="studio-home-achievements-header">
                <Trophy size={11} className="studio-home-trophy" />
                <Line w={50} />
                <span className="studio-home-trophy-count">12 / 15</span>
              </div>
              <Track value={80} />
            </div>,
          )}

          {/* Friends Feed */}
          {renderCard(
            "homeFriends",
            "card",
            <div className="studio-home-friends-body">
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
            <SchematicCardRail variant="progress" count={3} />,
          )}

          {/* Recently Added */}
          {renderCard(
            "homeRecentlyAdded",
            "card",
            <SchematicCardRail variant="standard" count={3} />,
          )}

          {/* Active Downloads */}
          {renderCard(
            "homeDownloads",
            "card",
            <div className="studio-home-download-card">
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
            <SchematicCardRail variant="standard" count={3} />,
          )}

          {/* Deals Rail */}
          {renderCard(
            "homeDeals",
            "card",
            <SchematicCardRail variant="sale" count={3} />,
          )}

          {/* News Rail */}
          {renderCard(
            "homeNews",
            "card",
            <SchematicCardRail variant="news" count={3} />,
          )}
        </div>
      </div>
    </div>
  );
}
