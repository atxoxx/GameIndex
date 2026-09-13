import { useEffect } from "react";
import {
  Clock,
  EyeOff,
  Gamepad2,
  GripVertical,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import {
  SIDEBAR_SECTIONS,
  interfacePageDef,
  type DetailTabScope,
  type HeroElementKey,
  type InterfacePageKey,
} from "../../../context/interfaceLayout";
import { useOrderDrag } from "../useOrderDrag";
import type { OrderListItem, ViewportPreset } from "./types";

const SIDEBAR_LABEL_KEY: Record<string, string> = Object.fromEntries(
  SIDEBAR_SECTIONS.map((section) => [section.key, section.labelKey]),
);

/** Tiny stand-in for an element inside the preview's hero mock. */
function HeroElementVisual({ element }: { element: HeroElementKey }) {
  switch (element) {
    case "background":
      return <span className="studio-hero-visual studio-hero-visual--background" aria-hidden="true" />;
    case "poster":
      return <span className="studio-hero-visual studio-hero-visual--poster" aria-hidden="true" />;
    case "title":
      return <span className="studio-hero-visual studio-hero-visual--title" aria-hidden="true" />;
    case "meta":
      return (
        <span className="studio-hero-visual studio-hero-visual--meta" aria-hidden="true">
          <i />
          <i />
        </span>
      );
    case "genres":
      return (
        <span className="studio-hero-visual studio-hero-visual--genres" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      );
    case "kpis":
      return (
        <span className="studio-hero-visual studio-hero-visual--kpis" aria-hidden="true">
          <i />
          <i />
        </span>
      );
    case "actions":
      return (
        <span className="studio-hero-visual studio-hero-visual--actions" aria-hidden="true">
          <i />
          <i />
        </span>
      );
    default:
      return null;
  }
}

export interface StudioPreviewProps {
  navTabs: OrderListItem[];
  navButtons: OrderListItem[];
  sidebarPosition: "left" | "right";
  sidebarVisible: Record<string, boolean>;
  page: InterfacePageKey;
  pageItems: OrderListItem[];
  badgesVisible?: Record<string, boolean>;
  showNowPlaying?: boolean;
  showCardBadgesMaster?: boolean;
  highlightedId?: string | null;
  viewport?: ViewportPreset;
  inspectMode?: boolean;
  /** Detail-page mocks rendered in the main area (game + store only). */
  detailTabItems: OrderListItem[];
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
  onReorderHeroElements: (from: number, to: number) => void;
  onToggleHeroElement: (id: string, hidden: boolean) => void;
}

export function StudioPreview({
  navTabs,
  navButtons,
  sidebarPosition,
  sidebarVisible,
  page,
  pageItems,
  badgesVisible = {},
  showNowPlaying = true,
  showCardBadgesMaster = true,
  highlightedId,
  viewport = "desktop",
  inspectMode = false,
  detailTabItems,
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
  onReorderHeroElements,
  onToggleHeroElement,
}: StudioPreviewProps) {
  const { t } = useLanguage();
  const isGlobal = page === "global";
  const pageDef = interfacePageDef(page);
  const showDetailMocks = detailScope !== null && (page === "game" || page === "store");

  const tabsDrag = useOrderDrag(onReorderNavTabs);
  const buttonsDrag = useOrderDrag(onReorderNavButtons);
  const itemsDrag = useOrderDrag(onReorderPageItems);
  const detailTabsDrag = useOrderDrag(onReorderDetailTabs);
  const heroDrag = useOrderDrag(onReorderHeroElements);

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

            {showNowPlaying && (
              <div
                className={`studio-preview__now-playing${
                  highlightedId === "now-playing" ? " is-preview-lit" : ""
                }`}
                title={t("settings.appearance.navbarNowPlayingTitle")}
              >
                <span className="studio-preview__now-playing-pulse" aria-hidden="true" />
                <Gamepad2 size={10} aria-hidden="true" />
                <span>Playing</span>
              </div>
            )}

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
                  <div
                    className={`studio-preview__mock-hero${
                      highlightedId === "widgetHero" ? " is-preview-lit" : ""
                    }`}
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    <span>Hero Spotlight Banner</span>
                  </div>

                  <div className="studio-preview__card-grid">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className="studio-preview__mock-card">
                        <div className="studio-preview__mock-card-cover">
                          {showCardBadgesMaster && badgesVisible.badgePlatform !== false && (
                            <span className="studio-preview__mini-badge studio-preview__mini-badge--plat">
                              Steam
                            </span>
                          )}
                          {showCardBadgesMaster && badgesVisible.badgeRating !== false && (
                            <span className="studio-preview__mini-badge studio-preview__mini-badge--rating">
                              <Star size={7} fill="currentColor" /> 95%
                            </span>
                          )}
                          {showCardBadgesMaster && badgesVisible.badgeInstall !== false && (
                            <span className="studio-preview__mini-badge studio-preview__mini-badge--installed">
                              Ready
                            </span>
                          )}
                        </div>
                        <div className="studio-preview__mock-card-meta">
                          <span className="studio-preview__mock-card-title" />
                          {showCardBadgesMaster && badgesVisible.badgePlaytime !== false && (
                            <span className="studio-preview__mock-card-time">
                              <Clock size={7} /> 28h
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {showDetailMocks && (
                    <>
                      {/* Editable hero mock — blocks reorder/hide in place */}
                      <div
                        className="studio-hero-editor__mock studio-preview__detail-hero"
                        role="group"
                        ref={heroDrag.containerRef}
                        aria-label={t("settings.interface.studioHeroElementsTitle")}
                      >
                        {heroElementItems.map((item, index) => {
                          const isLit = highlightedId === item.id;
                          const isDragging = heroDrag.dragIndex === index;
                          const isDropTarget =
                            heroDrag.overIndex === index &&
                            heroDrag.dragIndex !== null &&
                            heroDrag.dragIndex !== index;
                          const className = [
                            "studio-hero-block",
                            `studio-hero-block--${item.id}`,
                            item.hidden ? "is-off" : "",
                            isDragging ? "is-dragging" : "",
                            isDropTarget ? "is-drop-target" : "",
                            isLit ? "is-preview-lit" : "",
                          ]
                            .filter(Boolean)
                            .join(" ");
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-order-index={index}
                              className={className}
                              aria-pressed={!item.hidden}
                              title={toggleTitle(item.label, item.hidden, item.id)}
                              onPointerDown={startRowDrag(heroDrag, index)}
                              onClick={() =>
                                handleItemInteraction(heroDrag, item.id, () =>
                                  onToggleHeroElement(item.id, !item.hidden),
                                )
                              }
                            >
                              <span className="studio-hero-block__head">
                                <GripVertical
                                  className="studio-preview__grip"
                                  size={10}
                                  aria-hidden="true"
                                />
                                <item.icon
                                  size={10}
                                  className="studio-hero-block__icon"
                                  aria-hidden="true"
                                />
                                <span className="studio-hero-block__label">{item.label}</span>
                              </span>
                              <HeroElementVisual element={item.id as HeroElementKey} />
                            </button>
                          );
                        })}
                      </div>

                      {/* Editable detail subtab bar mock — overview stays visible */}
                      <div
                        className="studio-subtab-bar"
                        role="group"
                        ref={detailTabsDrag.containerRef}
                        aria-label={t("settings.interface.studioDetailTabsTitle")}
                      >
                        {detailTabItems.map((item, index) => {
                          const isOverview = item.id === "overview";
                          const isLit = highlightedId === item.id;
                          const isDragging = detailTabsDrag.dragIndex === index;
                          const isDropTarget =
                            detailTabsDrag.overIndex === index &&
                            detailTabsDrag.dragIndex !== null &&
                            detailTabsDrag.dragIndex !== index;
                          const className = [
                            "studio-subtab",
                            item.hidden ? "is-off" : "",
                            isDragging ? "is-dragging" : "",
                            isDropTarget ? "is-drop-target" : "",
                            isLit ? "is-preview-lit" : "",
                          ]
                            .filter(Boolean)
                            .join(" ");
                          const title = inspectMode
                            ? `${item.label} — ${t("settings.interface.inspectElementHint")}`
                            : isOverview
                              ? `${item.label} — ${t("settings.interface.studioAlwaysVisible")}`
                              : toggleTitle(item.label, item.hidden, item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-order-index={index}
                              className={className}
                              aria-pressed={!item.hidden}
                              title={title}
                              onPointerDown={startRowDrag(detailTabsDrag, index)}
                              onClick={() =>
                                handleItemInteraction(detailTabsDrag, item.id, () => {
                                  if (!isOverview) onToggleDetailTab(item.id, !item.hidden);
                                })
                              }
                            >
                              <GripVertical
                                className="studio-preview__grip"
                                size={10}
                                aria-hidden="true"
                              />
                              <item.icon
                                size={11}
                                className="studio-preview__tab-icon"
                                aria-hidden="true"
                              />
                              <span className="studio-preview__tab-label">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="studio-preview__items" ref={itemsDrag.containerRef}>
                    {pageItems.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        data-order-index={index}
                        className={rowClass(
                          "studio-preview__item",
                          itemsDrag,
                          index,
                          item.hidden,
                          item.id,
                        )}
                        aria-pressed={!item.hidden}
                        title={toggleTitle(item.label, item.hidden, item.id)}
                        onPointerDown={startRowDrag(itemsDrag, index)}
                        onClick={() =>
                          handleItemInteraction(itemsDrag, item.id, () => onTogglePageItem(item.id))
                        }
                      >
                        <GripVertical
                          className="studio-preview__grip"
                          size={12}
                          aria-hidden="true"
                        />
                        <item.icon size={13} className="studio-preview__item-icon" aria-hidden="true" />
                        <span className="studio-preview__item-label">{item.label}</span>
                        {item.hidden && <EyeOff size={12} className="studio-preview__item-off-icon" aria-hidden="true" />}
                      </button>
                    ))}

                    {pageItems.length === 0 && (
                      <div className="studio-preview__item is-empty">
                        <span>{t("settings.interface.studioPageItemsEmpty")}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
