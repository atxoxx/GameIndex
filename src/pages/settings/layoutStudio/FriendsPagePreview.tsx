import { useMemo } from "react";
import {
  Activity,
  Gamepad2,
  Heart,
  MessageSquare,
  Plus,
  RefreshCw,
  Scale,
  Users,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  MiniTile,
  SchematicSearchBar,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface FriendsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function FriendsPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: FriendsPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--friends"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Friends Toolbar / Tabs Header */}
      <div className="studio-page-full">
        {renderCard(
          "friendsHeader",
          "slot",
          <div className="studio-friends-header-mock">
            <div className="studio-friends-nav-tabs">
              <span className="studio-friends-nav-tab is-active">
                <Users size={10} />
                <span>Friends</span>
                <i className="studio-friends-count-badge">18</i>
              </span>
              <span className="studio-friends-nav-tab">
                <Activity size={10} />
                <span>Activity</span>
              </span>
              <span className="studio-friends-nav-tab">
                <MessageSquare size={10} />
                <span>Messages</span>
                <i className="studio-friends-count-badge is-unread">2</i>
              </span>
              <span className="studio-friends-nav-tab">
                <Gamepad2 size={10} />
                <span>Sessions</span>
              </span>
            </div>
            <div className="studio-friends-header-actions">
              <span className="studio-friends-sync-pill">
                <RefreshCw size={8} />
                <span>Synced</span>
              </span>
              <span className="studio-friends-btn-add">
                <Plus size={9} />
                <span>Add Friend</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Hero Online & Presence Stats */}
      <div className="studio-page-full">
        {renderCard(
          "friendsHero",
          "slot",
          <div className="studio-friends-hero-mock">
            <MiniTile label="Online Friends" value="4" icon={Users} />
            <MiniTile label="In Game" value="2" icon={Gamepad2} />
            <MiniTile label="Active Sessions" value="1" icon={Activity} />
            <MiniTile label="Mutual Games" value="28" icon={Scale} />
          </div>,
        )}
      </div>

      {/* 3. Friends List & Cards Grid */}
      <div className="studio-page-full">
        {renderCard(
          "friendsTabs",
          "slot",
          <div className="studio-friends-content-mock">
            <div className="studio-friends-filter-bar">
              <div className="studio-friends-filter-pills">
                <span className="studio-friends-pill is-active">All (18)</span>
                <span className="studio-friends-pill">Online (4)</span>
                <span className="studio-friends-pill">In Game (2)</span>
                <span className="studio-friends-pill">Favorites (5)</span>
              </div>
              <SchematicSearchBar placeholder="Search friends by name..." />
            </div>

            <div className="studio-friends-grid">
              {[
                { name: 50, game: "Playing Cyberpunk 2077", online: true, playing: true },
                { name: 45, game: "Playing Elden Ring", online: true, playing: true },
                { name: 40, game: "Online · Idle", online: true, playing: false },
                { name: 55, game: "Last seen 2h ago", online: false, playing: false },
              ].map((f, i) => (
                <div key={i} className="studio-friends-card">
                  <div className="studio-friends-avatar-wrap">
                    <span className="studio-friends-avatar">
                      <Users size={11} />
                    </span>
                    <span
                      className={`studio-friends-status-dot${
                        f.playing ? " is-playing" : f.online ? " is-online" : ""
                      }`}
                    />
                  </div>
                  <div className="studio-friends-card-meta">
                    <div className="studio-friends-name-row">
                      <Line w={f.name} h={11} />
                      <Heart size={8} className="studio-friends-heart-icon" />
                    </div>
                    <span className="studio-friends-game-status">{f.game}</span>
                  </div>
                  <div className="studio-friends-card-actions">
                    <span className="studio-friends-action-btn">
                      <MessageSquare size={9} />
                    </span>
                    <span className="studio-friends-action-btn">
                      <Scale size={9} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
