import { useEffect, type ReactNode } from "react";
import {
  BadgeCheck,
  Clock,
  EyeOff,
  Gamepad2,
  GripVertical,
  HardDrive,
  LayoutGrid,
  type LucideIcon,
  PanelLeft,
  PanelRight,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Store,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { HeroGridLayout } from "../../../context/heroGrid";
import {
  SIDEBAR_SECTIONS,
  interfacePageDef,
  type DetailTabScope,
  type InterfacePageKey,
} from "../../../context/interfaceLayout";
import {
  BADGE_ITEMS,
  MASTER_GATED_BADGES,
  WIDGET_ITEMS,
} from "../interfaceItems";
import { useOrderDrag } from "../useOrderDrag";
import { DetailPagePreview } from "./DetailPagePreview";
import { WIDGET_ICON, WIDGET_KEY_BY_ITEM } from "./widgetIcons";
import type { OrderListItem, ViewportPreset } from "./types";

/** Compact icon for each card-badge toggle in the preview's badge tuner. */
const BADGE_ICON: Record<string, LucideIcon> = {
  badgePlatform: Store,
  badgePlaytime: Clock,
  badgeInstall: HardDrive,
  badgeRating: Star,
  badgeCrackwatch: ShieldAlert,
  badgeCompare: Scale,
};

const SIDEBAR_LABEL_KEY: Record<string, string> = Object.fromEntries(
  SIDEBAR_SECTIONS.map((section) => [section.key, section.labelKey]),
);

/** Card-badge key → label key, for the clickable badges drawn on the mock cards. */
const BADGE_LABEL_KEY: Record<string, string> = Object.fromEntries(
  BADGE_ITEMS.map((badge) => [badge.key, badge.labelKey]),
);

interface ToggleChipProps {
  id: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  disabled?: boolean;
  lit?: boolean;
  inspectMode?: boolean;
  onInspect?: (id: string) => void;
  onToggle: () => void;
}

/**
 * ToggleChip — a compact on/off pill used by the preview's global tuners
 * (widget masters, card badges). Rendered inside `.studio-preview`, so its
 * styles carry the extra `.studio-preview` prefix to beat the shared
 * `button` reset in LayoutStudio.css.
 */
function ToggleChip({
  id,
  label,
  icon: Icon,
  active,
  disabled,
  lit,
  inspectMode,
  onInspect,
  onToggle,
}: ToggleChipProps) {
  const { t } = useLanguage();
  const title =
    inspectMode && onInspect
      ? `${label} — ${t("settings.interface.inspectElementHint")}`
      : `${label} — ${t(
          active ? "settings.interface.studioHide" : "settings.interface.studioShow",
        )}`;
  return (
    <button
      type="button"
      className={`studio-chip${active ? "" : " is-off"}${
        lit ? " is-preview-lit" : ""
      }`}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onClick={() => {
        if (inspectMode && onInspect) onInspect(id);
        else onToggle();
      }}
    >
      <Icon size={11} aria-hidden="true" />
      <span className="studio-chip__label">{label}</span>
    </button>
  );
}

export interface StudioPreviewProps {
  navTabs: OrderListItem[];
  navButtons: OrderListItem[];
  sidebarPosition: "left" | "right";
  sidebarVisible: Record<string, boolean>;
  page: InterfacePageKey;
  pageItems: OrderListItem[];
  /** The full `interfaceVisibility` map (nav items, card badges, widget masters). */
  globalVisibility?: Record<string, boolean>;
  showNowPlaying?: boolean;
  showCardBadgesMaster?: boolean;
  highlightedId?: string | null;
  viewport?: ViewportPreset;
  inspectMode?: boolean;
  /** Detail-page mocks rendered in the main area (game + store only). */
  detailTabItems: OrderListItem[];
  detailTopBarItems: OrderListItem[];
  heroElementItems: OrderListItem[];
  detailScope: DetailTabScope | null;
  onReorderNavTabs: (from: number, to: number) => void;
  onReorderNavButtons: (from: number, to: number) => void;
  onReorderPageItems: (from: number, to: number) => void;
  onToggleNavTab: (id: string) => void;
  onToggleNavButton: (id: string) => void;
  onTogglePageItem: (id: string) => void;
  onToggleSidebarSection: (id: string) => void;
  onInspectElement?: (id: string) => void;
  onReorderDetailTabs: (from: number, to: number) => void;
  onToggleDetailTab: (id: string, hidden: boolean) => void;
  onReorderDetailTopBar: (from: number, to: number) => void;
  onToggleDetailTopBar: (id: string, hidden: boolean) => void;
  onReorderHeroElements: (from: number, to: number) => void;
  onToggleHeroElement: (id: string, hidden: boolean) => void;
  /** Toggle a global `interfaceVisibility` item — card badges and widget masters. */
  onToggleGlobalItem: (id: string) => void;
  /** Toggle the "Show Card Badges" master switch. */
  onToggleCardBadgesMaster: () => void;
  /** Toggle the navbar now-playing indicator. */
  onToggleNowPlaying: () => void;
  /** Dock the app sidebar left or right. */
  onSetSidebarPosition: (side: "left" | "right") => void;
  /** Authored hero grid for the active detail scope; null/undefined => flex. */
  heroGridLayout?: HeroGridLayout | null;
  /** Commit a hero grid edit from the detail mock. */
  onHeroGridChange?: (next: HeroGridLayout) => void;
  /** Repack the hero grid to the shipped layout. */
  onHeroGridTidy?: () => void;
  /** Drop the hero grid and go back to flex. */
  onHeroGridReset?: () => void;
  /** Seed a hero grid from the current flex order. */
  onHeroGridConvert?: () => void;
}

export function StudioPreview({
  navTabs,
  navButtons,
  sidebarPosition,
  sidebarVisible,
  page,
  pageItems,
  globalVisibility = {},
  showNowPlaying = true,
  showCardBadgesMaster = true,
  highlightedId,
  viewport = "desktop",
  inspectMode = false,
  detailTabItems,
  detailTopBarItems,
  heroElementItems,
  detailScope,
  onReorderNavTabs,
  onReorderNavButtons,
  onReorderPageItems,
  onToggleNavTab,
  onToggleNavButton,
  onTogglePageItem,
  onToggleSidebarSection,
  onInspectElement,
  onReorderDetailTabs,
  onToggleDetailTab,
  onReorderDetailTopBar,
  onToggleDetailTopBar,
  onReorderHeroElements,
  onToggleHeroElement,
  onToggleGlobalItem,
  onToggleCardBadgesMaster,
  onToggleNowPlaying,
  onSetSidebarPosition,
  heroGridLayout,
  onHeroGridChange,
  onHeroGridTidy,
  onHeroGridReset,
  onHeroGridConvert,
}: StudioPreviewProps) {
  const { t } = useLanguage();
  const isGlobal = page === "global";
  const pageDef = interfacePageDef(page);
  const showDetailMocks = detailScope !== null && (page === "game" || page === "store");

  const tabsDrag = useOrderDrag(onReorderNavTabs);
  const buttonsDrag = useOrderDrag(onReorderNavButtons);
  const itemsDrag = useOrderDrag(onReorderPageItems);

  const isTabActive = (tabId: string) => {
    const pageFromId = tabId.replace(/^nav/, "").toLowerCase();
    return page.toLowerCase() === pageFromId || (page === "game" && pageFromId === "library");
  };

  useEffect(() => {
    if (!tabsDrag.containerRef.current) return;
    const activeEl = tabsDrag.containerRef.current.querySelector<HTMLElement>(
      ".studio-preview__tab.is-active",
    );
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [page]);

  const rowClass = (
    base: string,
    drag: ReturnType<typeof useOrderDrag>,
    index: number,
    hidden: boolean,
    id?: string,
    isActive?: boolean,
  ) => {
    const isTarget =
      drag.overIndex === index &&
      drag.dragIndex !== null &&
      drag.dragIndex !== index;
    const isLit = id && highlightedId === id;
    return `${base}${hidden ? " is-off" : ""}${
      drag.dragIndex === index ? " is-dragging" : ""
    }${isTarget ? " is-drop-target" : ""}${isLit ? " is-preview-lit" : ""}${
      isActive ? " is-active" : ""
    }`;
  };

  const handleItemInteraction = (
    drag: ReturnType<typeof useOrderDrag>,
    id: string,
    toggleAction: () => void,
  ) => {
    if (drag.movedRef.current) return;
    if (inspectMode && onInspectElement) {
      onInspectElement(id);
    } else {
      toggleAction();
    }
  };

  const startRowDrag =
    (drag: ReturnType<typeof useOrderDrag>, index: number) =>
    (e: React.PointerEvent) => {
      if (e.button !== 0 || inspectMode) return;
      drag.startDrag(index);
    };

  const toggleTitle = (label: string, hidden: boolean, _id?: string) => {
    if (inspectMode) {
      return `${label} — ${t("settings.interface.inspectElementHint")}`;
    }
    return `${label} — ${t(
      hidden ? "settings.interface.studioShow" : "settings.interface.studioHide",
    )}`;
  };

  // A clickable badge drawn on the mock cards. Clicking toggles that badge,
  // mirroring the minimised version of the real card badges.
  const renderCardBadge = (id: string, variant: string, content: ReactNode) => {
    const label = t(BADGE_LABEL_KEY[id] ?? id);
    return (
      <button
        type="button"
        className={`studio-preview__mini-badge studio-preview__mini-badge--${variant}`}
        aria-pressed={true}
        title={toggleTitle(label, false)}
        onClick={(e) => {
          e.stopPropagation();
          if (inspectMode && onInspectElement) onInspectElement(id);
          else onToggleGlobalItem(id);
        }}
      >
        {content}
      </button>
    );
  };

  // Flat, orderable list of the active page's widgets. Used as the whole body
  // for pages without a bespoke mock, and inline below the store detail shell
  // for the store page's own (list) blocks.
  const renderPageItemsList = (inline = false) => (
    <div
      className={`studio-preview__items${inline ? " studio-preview__items--inline" : ""}`}
      ref={itemsDrag.containerRef}
    >
      {pageItems.map((item, index) => (
        <button
          key={item.id}
          type="button"
          data-order-index={index}
          className={rowClass("studio-preview__item", itemsDrag, index, item.hidden, item.id)}
          aria-pressed={!item.hidden}
          title={toggleTitle(item.label, item.hidden, item.id)}
          onPointerDown={startRowDrag(itemsDrag, index)}
          onClick={() =>
            handleItemInteraction(itemsDrag, item.id, () => onTogglePageItem(item.id))
          }
        >
          <GripVertical className="studio-preview__grip" size={12} aria-hidden="true" />
          <item.icon size={13} className="studio-preview__item-icon" aria-hidden="true" />
          <span className="studio-preview__item-label">{item.label}</span>
          {item.hidden && (
            <EyeOff size={12} className="studio-preview__item-off-icon" aria-hidden="true" />
          )}
        </button>
      ))}

      {pageItems.length === 0 && (
        <div className="studio-preview__item is-empty">
          <span>{t("settings.interface.studioPageItemsEmpty")}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="studio-preview-container">
      {/* Frame wrapper for aspect ratio simulation */}
      <div className={`studio-preview-frame studio-preview-frame--${viewport}`}>
        <div
          className={`studio-preview${sidebarPosition === "right" ? " is-sidebar-right" : ""}${
            inspectMode ? " is-inspect-cursor" : ""
          }`}
          role="group"
          aria-label={t("settings.interface.studioPreview")}
        >
          {/* Topnav Header */}
          <div className="studio-preview__topnav">
            <span
              className={`studio-preview__logo${highlightedId === "header-brand" ? " is-preview-lit" : ""}`}
              aria-hidden="true"
              title="GameIndex App Brand"
            />

            <div
              className="studio-preview__tabs"
              ref={tabsDrag.containerRef}
              onWheel={(e) => {
                if (e.deltaY !== 0) {
                  e.currentTarget.scrollLeft += e.deltaY;
                }
              }}
            >
              {navTabs.map((tab, index) => (
                <button
                  key={tab.id}
                  type="button"
                  data-order-index={index}
                  className={rowClass(
                    "studio-preview__tab",
                    tabsDrag,
                    index,
                    tab.hidden,
                    tab.id,
                    isTabActive(tab.id),
                  )}
                  aria-pressed={!tab.hidden}
                  title={toggleTitle(tab.label, tab.hidden, tab.id)}
                  onPointerDown={startRowDrag(tabsDrag, index)}
                  onClick={() =>
                    handleItemInteraction(tabsDrag, tab.id, () => onToggleNavTab(tab.id))
                  }
                >
                  <GripVertical className="studio-preview__grip" size={10} aria-hidden="true" />
                  <tab.icon size={11} className="studio-preview__tab-icon" aria-hidden="true" />
                  <span className="studio-preview__tab-label">{tab.label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`studio-preview__now-playing${
                showNowPlaying ? "" : " is-off"
              }${highlightedId === "now-playing" ? " is-preview-lit" : ""}`}
              aria-pressed={showNowPlaying}
              title={toggleTitle(
                t("settings.appearance.navbarNowPlayingTitle"),
                !showNowPlaying,
                "now-playing",
              )}
              onClick={() =>
                inspectMode && onInspectElement
                  ? onInspectElement("now-playing")
                  : onToggleNowPlaying()
              }
            >
              <span className="studio-preview__now-playing-pulse" aria-hidden="true" />
              <Gamepad2 size={10} aria-hidden="true" />
              <span>Playing</span>
            </button>

            <div className="studio-preview__actions" ref={buttonsDrag.containerRef}>
              {navButtons.map((button, index) => (
                <button
                  key={button.id}
                  type="button"
                  data-order-index={index}
                  className={rowClass(
                    "studio-preview__action",
                    buttonsDrag,
                    index,
                    button.hidden,
                    button.id,
                  )}
                  aria-pressed={!button.hidden}
                  title={toggleTitle(button.label, button.hidden, button.id)}
                  onPointerDown={startRowDrag(buttonsDrag, index)}
                  onClick={() =>
                    handleItemInteraction(buttonsDrag, button.id, () =>
                      onToggleNavButton(button.id),
                    )
                  }
                >
                  <button.icon size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          {/* Main Body with Sidebar + Content */}
          <div className="studio-preview__body">
            {/* Sidebar */}
            <div
              className={`studio-preview__sidebar${
                highlightedId === "studio-group-sidebar" ? " is-preview-lit" : ""
              }`}
            >
              {/* Sidebar side control — docks the whole sidebar left/right. */}
              <div
                className="studio-preview__sidebar-dock"
                role="group"
                aria-label={t("settings.interface.studioSidebarPosition")}
              >
                <button
                  type="button"
                  className={`studio-preview__sidebar-side${
                    sidebarPosition === "left" ? " is-active" : ""
                  }`}
                  aria-pressed={sidebarPosition === "left"}
                  aria-label={t("settings.interface.studioSidebarLeft")}
                  title={t("settings.interface.studioSidebarLeft")}
                  onClick={() => onSetSidebarPosition("left")}
                >
                  <PanelLeft size={11} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`studio-preview__sidebar-side${
                    sidebarPosition === "right" ? " is-active" : ""
                  }`}
                  aria-pressed={sidebarPosition === "right"}
                  aria-label={t("settings.interface.studioSidebarRight")}
                  title={t("settings.interface.studioSidebarRight")}
                  onClick={() => onSetSidebarPosition("right")}
                >
                  <PanelRight size={11} aria-hidden="true" />
                </button>
              </div>

              {(["search", "activeFilters", "gameList", "statsFooter"] as const).map(
                (sectionKey) => {
                  const label = t(SIDEBAR_LABEL_KEY[sectionKey]);
                  const isOff = !sidebarVisible[sectionKey];
                  const isLit = highlightedId === sectionKey;
                  return (
                    <button
                      key={sectionKey}
                      type="button"
                      className={`studio-preview__section studio-preview__section--${sectionKey}${
                        isOff ? " is-off" : ""
                      }${isLit ? " is-preview-lit" : ""}`}
                      aria-pressed={!isOff}
                      aria-label={label}
                      title={toggleTitle(label, isOff, sectionKey)}
                      onClick={() =>
                        inspectMode && onInspectElement
                          ? onInspectElement(sectionKey)
                          : onToggleSidebarSection(sectionKey)
                      }
                    >
                      {sectionKey === "search" && (
                        <span className="studio-preview__search-bar">
                          <Search size={9} aria-hidden="true" />
                          <span>Search library...</span>
                        </span>
                      )}
                      {sectionKey === "activeFilters" && (
                        <span className="studio-preview__chips">
                          <i>All</i>
                          <i>Installed</i>
                        </span>
                      )}
                      {sectionKey === "gameList" && (
                        <div className="studio-preview__game-list">
                          {Array.from({ length: 5 }, (_, i) => (
                            <span key={i} className="studio-preview__game-item">
                              <span className="studio-preview__game-dot" />
                              <span className="studio-preview__game-bar" />
                            </span>
                          ))}
                        </div>
                      )}
                      {sectionKey === "statsFooter" && (
                        <span className="studio-preview__stats-inner">
                          <span>148 Games</span>
                          <span>3.2 TB</span>
                        </span>
                      )}
                    </button>
                  );
                },
              )}

              {/* A-Z scrubber rail */}
              <button
                type="button"
                className={`studio-preview__section studio-preview__rail${
                  sidebarVisible.alphabetRail ? "" : " is-off"
                }${highlightedId === "alphabetRail" ? " is-preview-lit" : ""}`}
                aria-pressed={sidebarVisible.alphabetRail}
                aria-label={t(SIDEBAR_LABEL_KEY.alphabetRail)}
                title={toggleTitle(
                  t(SIDEBAR_LABEL_KEY.alphabetRail),
                  !sidebarVisible.alphabetRail,
                  "alphabetRail",
                )}
                onClick={() =>
                  inspectMode && onInspectElement
                    ? onInspectElement("alphabetRail")
                    : onToggleSidebarSection("alphabetRail")
                }
              />
            </div>

            {/* Main Content Area */}
            <div className="studio-preview__main">
              {!isGlobal && (
                <div className="studio-preview__main-head">
                  <span className="studio-preview__main-title">
                    {t(pageDef?.labelKey ?? "settings.interface.studioPreview")}
                  </span>
                  <span className="studio-preview__main-pill" />
                </div>
              )}

              {/* Page items or realistic library mockup */}
              {isGlobal ? (
                <div className="studio-preview__generic">
                  {/* Widget masters — "hide everywhere" counterparts of the
                   *  per-page widget toggles on each page tab. */}
                  <div
                    className="studio-preview__tuner"
                    role="group"
                    aria-label={t("settings.interface.studioWidgetsAllPages")}
                  >
                    <span className="studio-preview__tuner-label">
                      <LayoutGrid size={11} aria-hidden="true" />
                      {t("settings.interface.studioWidgetsAllPages")}
                    </span>
                    <div className="studio-preview__tuner-chips">
                      {WIDGET_ITEMS.map((item) => (
                        <ToggleChip
                          key={item.key}
                          id={item.key}
                          label={t(item.labelKey)}
                          icon={WIDGET_ICON[WIDGET_KEY_BY_ITEM[item.key]]}
                          active={globalVisibility[item.key] !== false}
                          lit={highlightedId === item.key}
                          inspectMode={inspectMode}
                          onInspect={onInspectElement}
                          onToggle={() => onToggleGlobalItem(item.key)}
                        />
                      ))}
                    </div>
                  </div>

                  <div
                    className={`studio-preview__mock-hero${
                      globalVisibility.widgetHero === false ? " is-off" : ""
                    }${highlightedId === "widgetHero" ? " is-preview-lit" : ""}`}
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    <span>Hero Spotlight Banner</span>
                  </div>

                  <div className="studio-preview__card-grid">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className="studio-preview__mock-card">
                        <div className="studio-preview__mock-card-cover">
                          {showCardBadgesMaster &&
                            globalVisibility.badgePlatform !== false &&
                            renderCardBadge("badgePlatform", "plat", "Steam")}
                          {showCardBadgesMaster &&
                            globalVisibility.badgeRating !== false &&
                            renderCardBadge(
                              "badgeRating",
                              "rating",
                              <>
                                <Star size={7} fill="currentColor" /> 95%
                              </>,
                            )}
                          {showCardBadgesMaster &&
                            globalVisibility.badgeInstall !== false &&
                            renderCardBadge("badgeInstall", "installed", "Ready")}
                        </div>
                        <div className="studio-preview__mock-card-meta">
                          <span className="studio-preview__mock-card-title" />
                          {showCardBadgesMaster && globalVisibility.badgePlaytime !== false && (
                            <span className="studio-preview__mock-card-time">
                              <Clock size={7} /> 28h
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Card badges — master switch + every badge, attached to
                   *  the card mock above so edits have an obvious home. */}
                  <div
                    className="studio-preview__tuner"
                    role="group"
                    aria-label={t("settings.interface.subtabBadges")}
                  >
                    <div className="studio-preview__tuner-head">
                      <span className="studio-preview__tuner-label">
                        <BadgeCheck size={11} aria-hidden="true" />
                        {t("settings.interface.subtabBadges")}
                      </span>
                      <ToggleChip
                        id="show-card-badges"
                        label={t("settings.appearance.cardBadgesTitle")}
                        icon={BadgeCheck}
                        active={showCardBadgesMaster}
                        inspectMode={inspectMode}
                        onInspect={onInspectElement}
                        onToggle={onToggleCardBadgesMaster}
                      />
                    </div>
                    <div className="studio-preview__tuner-chips">
                      {BADGE_ITEMS.map((item) => (
                        <ToggleChip
                          key={item.key}
                          id={item.key}
                          label={t(item.labelKey)}
                          icon={BADGE_ICON[item.key] ?? BadgeCheck}
                          active={globalVisibility[item.key] !== false}
                          disabled={
                            MASTER_GATED_BADGES.has(item.key) && !showCardBadgesMaster
                          }
                          lit={highlightedId === item.key}
                          inspectMode={inspectMode}
                          onInspect={onInspectElement}
                          onToggle={() => onToggleGlobalItem(item.key)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : showDetailMocks && detailScope ? (
                <div className="studio-detail-scroll">
                  <DetailPagePreview
                    scope={detailScope}
                    inspectMode={inspectMode}
                    highlightedId={highlightedId}
                    widgetItems={pageItems}
                    heroElementItems={heroElementItems}
                    detailTabItems={detailTabItems}
                    detailTopBarItems={detailTopBarItems}
                    onReorderWidgets={onReorderPageItems}
                    onToggleWidget={onTogglePageItem}
                    onReorderHeroElements={onReorderHeroElements}
                    onToggleHeroElement={onToggleHeroElement}
                    onReorderDetailTabs={onReorderDetailTabs}
                    onToggleDetailTab={onToggleDetailTab}
                    onReorderDetailTopBar={onReorderDetailTopBar}
                    onToggleDetailTopBar={onToggleDetailTopBar}
                    onInspectElement={onInspectElement}
                    heroPlacement={heroGridLayout ?? undefined}
                    onHeroGridChange={onHeroGridChange}
                    onHeroGridTidy={onHeroGridTidy}
                    onHeroGridReset={onHeroGridReset}
                    onHeroGridConvert={onHeroGridConvert}
                  />

                  {/* The store page's registered widgets are its *list* blocks;
                   *  the store detail shell above has no widget keys of its own,
                   *  so they stay editable here rather than inside the grid. */}
                  {page === "store" && pageItems.length > 0 && (
                    <div className="studio-detail-pageblocks">
                      <span className="studio-detail-pageblocks__label">
                        {t("settings.interface.studioPageItems")}
                      </span>
                      {renderPageItemsList(true)}
                    </div>
                  )}
                </div>
              ) : (
                renderPageItemsList()
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
