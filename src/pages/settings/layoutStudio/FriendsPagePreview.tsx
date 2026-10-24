import { useMemo } from "react";
import {
  Activity,
  CalendarDays,
  ChartColumn,
  Gamepad2,
  Heart,
  MessageSquare,
  Plus,
  RefreshCw,
  Scale,
  User,
  Users,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { Line, MiniTile, SchematicSearchBar } from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface FriendsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

const HUB_TABS = [
  { label: "Friends", icon: Users, active: true },
  { label: "Activity", icon: Activity },
  { label: "Messages", icon: MessageSquare },
  { label: "Sessions", icon: CalendarDays },
  { label: "Play", icon: Gamepad2 },
  { label: "Stats", icon: ChartColumn },
  { label: "Profile", icon: User },
];

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
    [widgetItems]
  );

  const renderCard = (id: string, variant: "card" | "slot" = "card", children?: React.ReactNode) => {
    const entry = byId.get(id);
    if (!entry) return null;
    const { item, index } = entry;
    const isDragging = widgetDrag.dragIndex === index;
    const isDropTarget =
      widgetDrag.overIndex === index && widgetDrag.dragIndex !== null && widgetDrag.dragIndex !== index;
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
      className="studio-page-preview studio-page-preview--friends"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Cockpit: identity + primary actions + sync state */}
      <div className="studio-page-full">
        {renderCard(
          "friendsHeader",
          "slot",
          <div className="studio-friends-header-mock">
            <div className="studio-friends-cockpit-identity">
              <span className="studio-friends-avatar is-large">
                <Users size={13} />
              </span>
              <div className="studio-friends-id-text">
                <Line w={64} h={11} />
                <span className="studio-friends-game-status">Ready to Play! · 4 online</span>
              </div>
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
              <span className="studio-friends-btn-add is-secondary">
                <CalendarDays size={9} />
                <span>Start session</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 2. Hero band: five live numbers + presence rail */}
      <div className="studio-page-full">
        {renderCard(
          "friendsHero",
          "slot",
          <div className="studio-friends-hero-stack">
            <div className="studio-friends-hero-mock">
              <MiniTile label="Friends" value="7" icon={Users} />
              <MiniTile label="Online" value="4" icon={Activity} />
              <MiniTile label="In game" value="3" icon={Gamepad2} />
              <MiniTile label="Upcoming" value="3" icon={CalendarDays} />
              <MiniTile label="Shared" value="6" icon={Scale} />
            </div>
            <div className="studio-friends-presence-row">
              <span className="studio-friends-pill is-active">Playing now</span>
              {[0, 1, 2].map((index) => (
                <span key={index} className="studio-friends-presence-chip">
                  <span className="studio-friends-status-dot is-playing" />
                  <Line w={36} h={8} />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. Hub nav + roster/detail split */}
      <div className="studio-page-full">
        {renderCard(
          "friendsTabs",
          "slot",
          <div className="studio-friends-content-mock">
            <div className="studio-friends-nav-tabs">
              {HUB_TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <span key={tab.label} className={`studio-friends-nav-tab${tab.active ? " is-active" : ""}`}>
                    <Icon size={10} />
                    <span>{tab.label}</span>
                    {tab.label === "Friends" && <i className="studio-friends-count-badge">7</i>}
                    {tab.label === "Messages" && <i className="studio-friends-count-badge is-unread">2</i>}
                  </span>
                );
              })}
            </div>

            <div className="studio-friends-workspace">
              <div className="studio-friends-roster">
                <div className="studio-friends-filter-bar">
                  <div className="studio-friends-filter-pills">
                    <span className="studio-friends-pill is-active">All</span>
                    <span className="studio-friends-pill">Online</span>
                    <span className="studio-friends-pill">In game</span>
                  </div>
                </div>
                <SchematicSearchBar placeholder="Search friends by name..." />

                <div className="studio-friends-row-list">
                  {[
                    { name: 64, game: "Playing Helldivers 2", playing: true, online: true, active: true },
                    { name: 48, game: "Playing Hades II", playing: true, online: true },
                    { name: 56, game: "Online · Idle", online: true },
                    { name: 42, game: "Last seen 2h ago" },
                    { name: 50, game: "Last seen yesterday" },
                  ].map((friend, index) => (
                    <div key={index} className={`studio-friends-row${friend.active ? " is-active" : ""}`}>
                      <div className="studio-friends-avatar-wrap">
                        <span className="studio-friends-avatar">
                          <Users size={10} />
                        </span>
                        <span
                          className={`studio-friends-status-dot${
                            friend.playing ? " is-playing" : friend.online ? " is-online" : ""
                          }`}
                        />
                      </div>
                      <div className="studio-friends-card-meta">
                        <Line w={friend.name} h={9} />
                        <span className="studio-friends-game-status">{friend.game}</span>
                      </div>
                      <span className="studio-friends-action-btn">
                        <MessageSquare size={8} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="studio-friends-detail">
                <div className="studio-friends-detail-head">
                  <span className="studio-friends-avatar is-large">
                    <Users size={14} />
                  </span>
                  <div className="studio-friends-card-meta">
                    <Line w={86} h={12} />
                    <span className="studio-friends-game-status">Playing Helldivers 2 · Europe / Amsterdam</span>
                  </div>
                  <div className="studio-friends-card-actions">
                    <span className="studio-friends-action-btn">
                      <MessageSquare size={9} />
                    </span>
                    <span className="studio-friends-action-btn">
                      <CalendarDays size={9} />
                    </span>
                    <span className="studio-friends-action-btn">
                      <Scale size={9} />
                    </span>
                  </div>
                </div>
                <div className="studio-friends-detail-facts">
                  <MiniTile label="Games" value="214" icon={Gamepad2} />
                  <MiniTile label="Playtime" value="683h" icon={Activity} />
                  <MiniTile label="Shared" value="4" icon={Scale} />
                </div>
                <div className="studio-friends-detail-lines">
                  <span className="studio-friends-game-status">Shared library</span>
                  {[80, 64, 72].map((width) => (
                    <span key={width} className="studio-friends-detail-game">
                      <span className="studio-friends-action-btn">
                        <Heart size={8} />
                      </span>
                      <Line w={width} h={8} />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
