import { useState } from "react";
import {
  Clock,
  Crosshair,
  EyeOff,
  Gamepad2,
  GripVertical,
  Laptop,
  Monitor,
  Search,
  Smartphone,
  Sparkles,
  Star,
  Tv,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import {
  SIDEBAR_SECTIONS,
  interfacePageDef,
  type InterfacePageKey,
} from "../../../context/interfaceLayout";
import { useOrderDrag } from "../useOrderDrag";
import type { OrderListItem, ViewportPreset } from "./types";

const SIDEBAR_LABEL_KEY: Record<string, string> = Object.fromEntries(
  SIDEBAR_SECTIONS.map((section) => [section.key, section.labelKey]),
);

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
  onReorderNavTabs: (from: number, to: number) => void;
  onReorderNavButtons: (from: number, to: number) => void;
  onReorderPageItems: (from: number, to: number) => void;
  onToggleNavTab: (id: string) => void;
  onToggleNavButton: (id: string) => void;
  onTogglePageItem: (id: string) => void;
  onToggleSidebarSection: (id: string) => void;
  onInspectElement?: (id: string) => void;
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
  onReorderNavTabs,
  onReorderNavButtons,
  onReorderPageItems,
  onToggleNavTab,
  onToggleNavButton,
  onTogglePageItem,
  onToggleSidebarSection,
  onInspectElement,
}: StudioPreviewProps) {
  const { t } = useLanguage();
  const isGlobal = page === "global";
  const pageDef = interfacePageDef(page);

  const [viewport, setViewport] = useState<ViewportPreset>("desktop");
  const [inspectMode, setInspectMode] = useState(false);

  const tabsDrag = useOrderDrag(onReorderNavTabs);
  const buttonsDrag = useOrderDrag(onReorderNavButtons);
  const itemsDrag = useOrderDrag(onReorderPageItems);

  const rowClass = (
    base: string,
    drag: ReturnType<typeof useOrderDrag>,
    index: number,
    hidden: boolean,
    id?: string,
  ) => {
    const isTarget =
      drag.overIndex === index &&
      drag.dragIndex !== null &&
      drag.dragIndex !== index;
    const isLit = id && highlightedId === id;
    return `${base}${hidden ? " is-off" : ""}${
      drag.dragIndex === index ? " is-dragging" : ""
    }${isTarget ? " is-drop-target" : ""}${isLit ? " is-preview-lit" : ""}`;
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
      {/* Top toolbar: Viewport presets + Inspect mode toggle */}
      <div className="studio-preview-toolbar">
        <div className="studio-preview-toolbar__viewports">
          <button
            type="button"
            className={`studio-preview-toolbar__vp-btn${viewport === "desktop" ? " is-active" : ""}`}
            onClick={() => setViewport("desktop")}
            title={t("settings.interface.viewportDesktop")}
          >
            <Monitor size={13} aria-hidden="true" />
            <span>16:9</span>
          </button>
          <button
            type="button"
            className={`studio-preview-toolbar__vp-btn${viewport === "handheld" ? " is-active" : ""}`}
            onClick={() => setViewport("handheld")}
            title={t("settings.interface.viewportHandheld")}
          >
            <Smartphone size={13} aria-hidden="true" />
            <span>16:10</span>
          </button>
          <button
            type="button"
            className={`studio-preview-toolbar__vp-btn${viewport === "ultrawide" ? " is-active" : ""}`}
            onClick={() => setViewport("ultrawide")}
            title={t("settings.interface.viewportUltrawide")}
          >
            <Tv size={13} aria-hidden="true" />
            <span>21:9</span>
          </button>
          <button
            type="button"
            className={`studio-preview-toolbar__vp-btn${viewport === "compact" ? " is-active" : ""}`}
            onClick={() => setViewport("compact")}
            title={t("settings.interface.viewportCompact")}
          >
            <Laptop size={13} aria-hidden="true" />
            <span>4:3</span>
          </button>
        </div>

        <button
          type="button"
          className={`studio-preview-toolbar__inspect-btn${inspectMode ? " is-active" : ""}`}
          onClick={() => setInspectMode((prev) => !prev)}
          title={t("settings.interface.inspectModeTooltip")}
          aria-pressed={inspectMode}
        >
          <Crosshair size={13} aria-hidden="true" />
          <span>{t("settings.interface.inspectMode")}</span>
        </button>
      </div>

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

            <div className="studio-preview__tabs" ref={tabsDrag.containerRef}>
              {navTabs.map((tab, index) => (
                <button
                  key={tab.id}
                  type="button"
                  data-order-index={index}
                  className={rowClass("studio-preview__tab", tabsDrag, index, tab.hidden, tab.id)}
                  aria-pressed={!tab.hidden}
                  title={toggleTitle(tab.label, tab.hidden, tab.id)}
                  onPointerDown={startRowDrag(tabsDrag, index)}
                  onClick={() =>
                    handleItemInteraction(tabsDrag, tab.id, () => onToggleNavTab(tab.id))
                  }
                >
                  <GripVertical className="studio-preview__grip" size={10} aria-hidden="true" />
                  <tab.icon size={11} aria-hidden="true" />
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
                        size={11}
                        aria-hidden="true"
                      />
                      <item.icon size={12} aria-hidden="true" />
                      <span>{item.label}</span>
                      {item.hidden && <EyeOff size={11} aria-hidden="true" />}
                    </button>
                  ))}

                  {pageItems.length === 0 && (
                    <div className="studio-preview__item is-empty">
                      <span>{t("settings.interface.studioPageItemsEmpty")}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
