import { useMemo } from "react";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Ellipsis,
  Gamepad2,
  Inbox,
  LayoutList,
  MapPin,
  MessageCircle,
  MessageSquare,
  Pencil,
  Pin,
  Rows3,
  Swords,
  Tag,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { Line, SchematicSearchBar, Track } from "./StudioSchematics";
import type { OrderListItem } from "./types";

import "./FriendsPagePreview.css";

export interface FriendsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

/** Hub nav: three always-on destinations, the three Complete-UI ones, then Profile. */
interface HubTab {
  labelKey: string;
  icon: typeof Users;
  count?: number;
  unread?: boolean;
}

const HUB_TABS: HubTab[] = [
  { labelKey: "friendsPage.friendList", icon: Users, count: 7 },
  { labelKey: "friends.tab.activity", icon: Activity, count: 5 },
  { labelKey: "friends.tab.messages", icon: MessageSquare, count: 2, unread: true },
  { labelKey: "friendsPage.hubSessions", icon: CalendarDays },
  { labelKey: "friends.tab.play", icon: Gamepad2 },
  { labelKey: "friends.tab.stats", icon: ChartNoAxesColumn },
  { labelKey: "friendsPage.hubProfile", icon: User },
];

const ROSTER_FILTERS = [
  { id: "all", count: 7 },
  { id: "online", count: 4 },
  { id: "ingame", count: 3 },
  { id: "pinned", count: 2 },
  { id: "blocked", count: 1 },
];

interface RosterRow {
  name: number;
  presence: string;
  playing?: boolean;
  pinned?: boolean;
  selected?: boolean;
}

const ROSTER_ROWS: RosterRow[] = [
  { name: 62, presence: "Playing Helldivers 2", playing: true, pinned: true, selected: true },
  { name: 48, presence: "Playing Hades II", playing: true },
  { name: 56, presence: "Online" },
  { name: 42, presence: "Last seen 2h ago" },
  { name: 50, presence: "Last seen yesterday" },
];

const SHARED_GAMES = [
  { name: 58, meta: "142h · 68% achievements", pct: 68 },
  { name: 46, meta: "96h · 41% achievements", pct: 41 },
  { name: 52, meta: "31h · 22% achievements", pct: 22 },
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
    [widgetItems],
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
      {/* 1. FriendsCockpit: identity, circle pulse, primary actions + sync chip */}
      <div className="studio-page-full">
        {renderCard(
          "friendsHeader",
          "slot",
          <div className="studio-fhub-cockpit">
            <div className="studio-fhub-cockpit__identity">
              <span className="studio-fhub-avatar is-xl">
                <Users size={15} />
              </span>
              <div className="studio-fhub-cockpit__text">
                <span className="studio-fhub-eyebrow">{t("friendsPage.playerCard")}</span>
                <span className="studio-fhub-cockpit__name">Nova</span>
                <span className="studio-fhub-cockpit__status">
                  <i className="studio-fhub-live" aria-hidden="true" />
                  <span>{t("friendsPage.playingGame", { game: "Helldivers 2" })}</span>
                  <span className="studio-fhub-region">Europe / Amsterdam</span>
                </span>
              </div>
              <span className="studio-fhub-icon-btn" title={t("friendsPage.editProfile")}>
                <Pencil size={10} />
              </span>
            </div>

            <div className="studio-fhub-pulse">
              <span className="studio-fhub-pulse__icon">
                <Users size={10} />
              </span>
              <span>
                <strong>4</strong> / 7 {t("friendsPage.onlineNowShort")}
              </span>
              <span className="studio-fhub-pulse__sep" aria-hidden="true" />
              <span className="studio-fhub-pulse__icon">
                <Gamepad2 size={10} />
              </span>
              <span>
                <strong>3</strong> {t("friendsPage.inGameShort")}
              </span>
            </div>

            <div className="studio-fhub-cockpit__actions">
              <span className="studio-fhub-btn is-primary">
                <UserPlus size={10} />
                {t("friends.addFriend")}
              </span>
              <span className="studio-fhub-btn">
                <CalendarPlus size={10} />
                {t("friendsPage.startSession")}
              </span>
              <span className="studio-fhub-icon-btn" title={t("friendsPage.manageCircles")}>
                <Tag size={10} />
              </span>
              <span className="studio-fhub-sync">
                <i className="studio-fhub-sync__dot" aria-hidden="true" />
                <span>Synced 2m ago</span>
                <ChevronDown size={9} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 2. FriendsHeroBand: five stat figures + the playing-now rail */}
      <div className="studio-page-full">
        {renderCard(
          "friendsHero",
          "slot",
          <div className="studio-fhub-hero">
            <div className="studio-fhub-statband">
              <span className="studio-fhub-stat">
                <span className="studio-fhub-stat__label">
                  <Users size={9} />
                  {t("friendsPage.friendList")}
                </span>
                <span className="studio-fhub-stat__value">7</span>
              </span>
              <span className="studio-fhub-stat">
                <span className="studio-fhub-stat__label">{t("friendsPage.onlineNow")}</span>
                <span className="studio-fhub-stat__value studio-fhub-tone--success">4</span>
              </span>
              <span className="studio-fhub-stat">
                <span className="studio-fhub-stat__label">{t("friendsPage.inGame")}</span>
                <span className="studio-fhub-stat__value studio-fhub-tone--accent">3</span>
              </span>
              <span className="studio-fhub-stat">
                <span className="studio-fhub-stat__label">{t("friendsPage.upcomingSessions")}</span>
                <span className="studio-fhub-stat__value studio-fhub-tone--warning">3</span>
              </span>
              <span className="studio-fhub-stat">
                <span className="studio-fhub-stat__label">{t("friendsPage.sharedGames")}</span>
                <span className="studio-fhub-stat__value studio-fhub-tone--info">6</span>
              </span>
            </div>

            <div className="studio-fhub-presence">
              <div className="studio-fhub-presence__head">
                <span className="studio-fhub-presence__title">
                  <Gamepad2 size={10} />
                  {t("friendsPage.friendsPlayingNow")}
                </span>
                <span className="studio-fhub-presence__hint">{t("friendsPage.presenceHint")}</span>
              </div>
              <div className="studio-fhub-presence__rail">
                {["Helldivers 2", "Hades II", "Deep Rock"].map((game, index) => (
                  <span key={game} className="studio-fhub-presence__card">
                    <span className="studio-fhub-avatar">
                      <Users size={9} />
                      <i className="studio-fhub-dot is-playing" aria-hidden="true" />
                    </span>
                    <span className="studio-fhub-presence__meta">
                      <Line w={index === 0 ? 62 : index === 1 ? 48 : 54} h={8} />
                      <span className="studio-fhub-presence__game">{game}</span>
                    </span>
                    <span className="studio-fhub-row-actions">
                      <span className="studio-fhub-action-btn" title={t("friends.message")}>
                        <MessageCircle size={8} />
                      </span>
                      <span className="studio-fhub-action-btn" title={t("friends.invite")}>
                        <CalendarPlus size={8} />
                      </span>
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Hub panel: SubTabs strip + roster/detail workspace */}
      <div className="studio-page-full">
        {renderCard(
          "friendsTabs",
          "slot",
          <div className="studio-fhub-panel">
            <div className="studio-fhub-subtabs" aria-hidden="true">
              {HUB_TABS.map((tab, index) => {
                const Icon = tab.icon;
                return (
                  <span
                    key={tab.labelKey}
                    className={["studio-fhub-subtab", index === 0 ? "is-active" : ""]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <Icon size={10} />
                    <span>{t(tab.labelKey)}</span>
                    {tab.count ? (
                      <i className={`studio-fhub-count${tab.unread ? " is-unread" : ""}`}>{tab.count}</i>
                    ) : null}
                  </span>
                );
              })}
            </div>

            <div className="studio-fhub-workspace">
              <aside className="studio-fhub-roster">
                <div className="studio-fhub-roster__head">
                  <div>
                    <span className="studio-fhub-eyebrow">{t("friendsPage.yourCircle")}</span>
                    <span className="studio-fhub-roster__title">
                      {t("friendsPage.friendList")}
                      <i className="studio-fhub-roster__count">7</i>
                    </span>
                  </div>
                  <span className="studio-fhub-icon-btn" title={t("friends.addFriend")}>
                    <UserPlus size={10} />
                  </span>
                </div>

                <div className="studio-fhub-invites">
                  <div className="studio-fhub-invites__head">
                    <Inbox size={9} />
                    {t("friendsPage.pendingInvitations", { count: 1 })}
                  </div>
                  <span className="studio-fhub-invite">
                    <span className="studio-fhub-avatar">
                      <Users size={9} />
                    </span>
                    <span className="studio-fhub-invite__meta">
                      <Line w={54} h={8} />
                      <span className="studio-fhub-muted">{t("friendsPage.formatOnline")}</span>
                    </span>
                    <span className="studio-fhub-action-btn">
                      <Check size={8} />
                    </span>
                    <span className="studio-fhub-action-btn">
                      <X size={8} />
                    </span>
                  </span>
                </div>

                <SchematicSearchBar placeholder={t("friends.searchPlaceholder")} />

                <div className="studio-fhub-filters">
                  {ROSTER_FILTERS.map((filter) => (
                    <span
                      key={filter.id}
                      className={`studio-fhub-chip${filter.id === "all" ? " is-active" : ""}`}
                    >
                      {t(`friendsPage.filter.${filter.id}`)}
                      <i>{filter.count}</i>
                    </span>
                  ))}
                </div>

                <div className="studio-fhub-tools">
                  <span className="studio-fhub-select">
                    {t("friendsPage.sortDefault")}
                    <ChevronDown size={8} />
                  </span>
                  <span className="studio-fhub-density">
                    <span className="is-active" title={t("friendsPage.densityComfortable")}>
                      <Rows3 size={9} />
                    </span>
                    <span title={t("friendsPage.densityCompact")}>
                      <LayoutList size={9} />
                    </span>
                  </span>
                  <span className="studio-fhub-action-btn" title={t("friendsPage.selectMultiple")}>
                    <Check size={9} />
                  </span>
                  <span className="studio-fhub-action-btn" title={t("friendsPage.manageCircles")}>
                    <Tag size={9} />
                  </span>
                </div>

                <div className="studio-fhub-circles">
                  <span className="studio-fhub-circle is-active">{t("friendsPage.allCircles")}</span>
                  <span className="studio-fhub-circle">
                    <i style={{ background: "var(--color-accent)" }} />
                    Co-op
                  </span>
                  <span className="studio-fhub-circle">
                    <i style={{ background: "var(--color-info)" }} />
                    Weekend crew
                  </span>
                  <span className="studio-fhub-circle is-ghost">
                    <Tag size={8} />
                    {t("friendsPage.createCircle")}
                  </span>
                </div>

                <div className="studio-fhub-rows">
                  {ROSTER_ROWS.map((friend, index) => (
                    <div
                      key={index}
                      className={[
                        "studio-fhub-row",
                        friend.selected ? "is-selected" : "",
                        friend.playing ? "is-playing" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className="studio-fhub-avatar">
                        <Users size={9} />
                        <i
                          className={`studio-fhub-dot${
                            friend.playing ? " is-playing" : index === 2 ? " is-online" : ""
                          }`}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="studio-fhub-row__main">
                        <span className="studio-fhub-row__name">
                          <Line w={friend.name} h={8} />
                          {friend.pinned && (
                            <i className="studio-fhub-row__badge">
                              <Pin size={7} />
                            </i>
                          )}
                        </span>
                        <span className="studio-fhub-muted">{friend.presence}</span>
                      </span>
                      <span className="studio-fhub-row-actions">
                        <span className="studio-fhub-action-btn">
                          <MessageCircle size={8} />
                        </span>
                        <span className="studio-fhub-action-btn">
                          <CalendarPlus size={8} />
                        </span>
                        <span className="studio-fhub-action-btn">
                          <Swords size={8} />
                        </span>
                        <span className="studio-fhub-action-btn">
                          <Ellipsis size={8} />
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </aside>

              <div className="studio-fhub-detail">
                <span className="studio-fhub-back">
                  <ArrowLeft size={9} />
                  {t("friendsPage.backToFriends")}
                </span>

                <div className="studio-fhub-detail__hero">
                  <span className="studio-fhub-avatar is-xl">
                    <Users size={16} />
                  </span>
                  <div className="studio-fhub-detail__identity">
                    <span className="studio-fhub-eyebrow">{t("friendsPage.playingNow")}</span>
                    <span className="studio-fhub-detail__name">Nova</span>
                    <span className="studio-fhub-muted">@nova</span>
                    <span className="studio-fhub-detail__meta">
                      <span>
                        <Gamepad2 size={8} /> Helldivers 2
                      </span>
                      <span>
                        <MapPin size={8} /> Europe / Amsterdam
                      </span>
                      <span>
                        <Clock size={8} /> 12m ago
                      </span>
                    </span>
                  </div>
                  <span className="studio-fhub-detail__actions">
                    <span className="studio-fhub-btn is-primary">
                      <MessageCircle size={9} />
                      {t("friends.message")}
                    </span>
                    <span className="studio-fhub-btn">
                      <CalendarPlus size={9} />
                      {t("friends.invite")}
                    </span>
                    <span className="studio-fhub-btn">
                      <Swords size={9} />
                      {t("friends.compare")}
                    </span>
                    <span className="studio-fhub-icon-btn">
                      <Ellipsis size={10} />
                    </span>
                  </span>
                </div>

                <div className="studio-fhub-facts">
                  <span className="studio-fhub-fact">
                    <span className="studio-fhub-muted">{t("friendsPage.gamesOwned")}</span>
                    <strong>214</strong>
                  </span>
                  <span className="studio-fhub-fact">
                    <span className="studio-fhub-muted">{t("friendsPage.totalPlaytime")}</span>
                    <strong>683h</strong>
                  </span>
                  <span className="studio-fhub-fact">
                    <span className="studio-fhub-muted">{t("friendsPage.totalAchievements")}</span>
                    <strong>1,842</strong>
                  </span>
                  <span className="studio-fhub-fact">
                    <span className="studio-fhub-muted">{t("friendsPage.sharedGames")}</span>
                    <strong>4</strong>
                  </span>
                </div>

                <div className="studio-fhub-detail__grid">
                  <section className="studio-fhub-section">
                    <div className="studio-fhub-section__head">
                      <span className="studio-fhub-section__title">
                        <Gamepad2 size={9} />
                        {t("friendsPage.sharedLibrary")}
                      </span>
                      <span className="studio-fhub-section__link">
                        {t("friendsPage.openCompare")}
                        <ChevronRight size={8} />
                      </span>
                    </div>
                    <div className="studio-fhub-games">
                      {SHARED_GAMES.map((game) => (
                        <span key={game.name} className="studio-fhub-game">
                          <span className="studio-fhub-game__mark" aria-hidden="true" />
                          <span className="studio-fhub-game__main">
                            <Line w={game.name} h={8} />
                            <span className="studio-fhub-muted">{game.meta}</span>
                            <Track value={game.pct} height={3} />
                          </span>
                        </span>
                      ))}
                    </div>
                  </section>

                  <div className="studio-fhub-detail__side">
                    <section className="studio-fhub-section">
                      <div className="studio-fhub-section__head">
                        <span className="studio-fhub-section__title">
                          <CalendarPlus size={9} />
                          {t("friendsPage.nextTogether")}
                        </span>
                        <span className="studio-fhub-section__link">
                          {t("friendsPage.viewSession")}
                          <ChevronRight size={8} />
                        </span>
                      </div>
                      <span className="studio-fhub-next-session">
                        <span className="studio-fhub-muted">Sat 8 Nov · 20:00</span>
                        <strong>Helldivers 2</strong>
                        <span className="studio-fhub-muted">Nova</span>
                      </span>
                    </section>

                    <section className="studio-fhub-section">
                      <div className="studio-fhub-section__head">
                        <span className="studio-fhub-section__title">
                          <Tag size={9} />
                          {t("friendsPage.circles")}
                        </span>
                        <span className="studio-fhub-section__link">
                          {t("friendsPage.manageCircles")}
                          <ChevronRight size={8} />
                        </span>
                      </div>
                      <div className="studio-fhub-circles">
                        <span className="studio-fhub-circle">
                          <i style={{ background: "var(--color-accent)" }} />
                          Co-op
                        </span>
                        <span className="studio-fhub-circle">
                          <i style={{ background: "var(--color-info)" }} />
                          Weekend crew
                        </span>
                      </div>
                    </section>

                    <section className="studio-fhub-section">
                      <div className="studio-fhub-section__head">
                        <span className="studio-fhub-section__title">
                          <Users size={9} />
                          {t("friendsPage.friendship")}
                        </span>
                      </div>
                      <span className="studio-fhub-dl">
                        <span>
                          <span className="studio-fhub-muted">{t("friendsPage.friendsSince")}</span>
                          <strong>Mar 2023</strong>
                        </span>
                        <span>
                          <span className="studio-fhub-muted">{t("friendsPage.favoriteGameLabel")}</span>
                          <strong>Elden Ring</strong>
                        </span>
                      </span>
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
