import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChartColumn,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  LayoutDashboard,
  LayoutList,
  LayoutTemplate,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import {
  DEFAULT_NAVBAR_BUTTON_ORDER,
  DEFAULT_NAVBAR_TAB_ORDER,
  useSettings,
  type InterfaceItemKey,
} from "../../context/SettingsContext";
import {
  DEFAULT_PAGE_ITEM_ORDER,
  INTERFACE_PAGES,
  SIDEBAR_SECTIONS,
  WIDGET_LABEL_KEY,
  interfacePageDef,
  type InterfacePageKey,
  type PageWidgetKey,
  type SidebarSectionKey,
} from "../../context/interfaceLayout";
import {
  NAV_BUTTON_ITEMS,
  NAV_TAB_ITEMS,
  moveKey,
  sortByOrder,
} from "./interfaceItems";
import { useOrderDrag } from "./useOrderDrag";
import SettingsToggleCard from "./SettingsToggleCard";
import { playActionSound } from "../../utils/soundEffects";
import "./LayoutEditorModal.css";

interface LayoutEditorModalProps {
  open: boolean;
  onClose: () => void;
}

/** Icon shown for each page-level widget category. */
const WIDGET_ICON: Record<PageWidgetKey, LucideIcon> = {
  hero: Sparkles,
  kpis: ChartColumn,
  filters: Filter,
  subtabs: LayoutList,
  dashboard: LayoutDashboard,
};

/** One entry of an order/visibility list. `id` is the persisted key. */
interface OrderListItem {
  id: string;
  label: string;
  icon: LucideIcon;
  hidden: boolean;
}

// ── Row ─────────────────────────────────────────────────────────────────────

function StudioRow({
  index,
  icon: Icon,
  label,
  hidden,
  onToggle,
  onMove,
  onDragStart,
  isDragging,
  isDropTarget,
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  icon: LucideIcon;
  label: string;
  hidden: boolean;
  onToggle: () => void;
  /** Omitted for visibility-only rows (sidebar sections). */
  onMove?: (delta: number) => void;
  /** Omitted when the list is not reorderable. */
  onDragStart?: () => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={`studio-row${isDragging ? " is-dragging" : ""}${
        isDropTarget ? " is-drop-target" : ""
      }${hidden ? " is-hidden-item" : ""}`}
      data-order-index={index}
      role="listitem"
    >
      {onDragStart && (
        <span
          className="studio-row__handle"
          title={t("settings.interface.studioDragHandle")}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            onDragStart();
          }}
        >
          <GripVertical size={15} aria-hidden="true" />
        </span>
      )}
      <Icon className="studio-row__icon" size={16} aria-hidden="true" />
      <span className="studio-row__label">{label}</span>
      {hidden && (
        <span className="studio-row__badge">
          {t("settings.interface.studioHidden")}
        </span>
      )}
      {onMove && (
        <div className="studio-row__moves">
          <button
            type="button"
            className="studio-row__move"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            aria-label={t("settings.interface.studioMoveUp")}
            title={t("settings.interface.studioMoveUp")}
          >
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="studio-row__move"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            aria-label={t("settings.interface.studioMoveDown")}
            title={t("settings.interface.studioMoveDown")}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <button
        type="button"
        className="studio-row__eye"
        onClick={onToggle}
        aria-pressed={!hidden}
        aria-label={
          hidden
            ? t("settings.interface.studioShow")
            : t("settings.interface.studioHide")
        }
        title={
          hidden
            ? t("settings.interface.studioShow")
            : t("settings.interface.studioHide")
        }
      >
        {hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
      </button>
    </div>
  );
}

// ── Orderable list ──────────────────────────────────────────────────────────

function OrderList({
  label,
  items,
  onReorder,
  onToggle,
  visibilityOnly,
}: {
  label: string;
  items: OrderListItem[];
  onReorder?: (from: number, to: number) => void;
  onToggle: (id: string, hidden: boolean) => void;
  visibilityOnly?: boolean;
}) {
  const { t } = useLanguage();
  const handleReorder = useCallback(
    (from: number, to: number) => onReorder?.(from, to),
    [onReorder],
  );
  const { containerRef, dragIndex, overIndex, startDrag } =
    useOrderDrag(handleReorder);
  const reorderable = !visibilityOnly && typeof onReorder === "function";

  return (
    <div className="studio-list" role="list" ref={containerRef} aria-label={label}>
      {items.map((item, index) => (
        <StudioRow
          key={item.id}
          index={index}
          icon={item.icon}
          label={item.label}
          hidden={item.hidden}
          onToggle={() => onToggle(item.id, !item.hidden)}
          onMove={
            reorderable
              ? (delta) => onReorder?.(index, index + delta)
              : undefined
          }
          onDragStart={reorderable ? () => startDrag(index) : undefined}
          isDragging={dragIndex === index}
          isDropTarget={overIndex === index && dragIndex !== null && dragIndex !== index}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
        />
      ))}
      {items.length === 0 && (
        <p className="studio-list__empty">
          {t("settings.interface.studioPageItemsEmpty")}
        </p>
      )}
    </div>
  );
}

// ── Simplified app preview ──────────────────────────────────────────────────

/** Label lookup for the sidebar sections shown in the preview. */
const SIDEBAR_LABEL_KEY: Record<string, string> = Object.fromEntries(
  SIDEBAR_SECTIONS.map((section) => [section.key, section.labelKey]),
);

/**
 * StudioPreview — a simplified, *interactive* rendering of the app shell.
 *
 * Every element mirrors a real setting: drag one to reorder it (header tabs,
 * header buttons, page blocks) and click it to hide/show it. Reordering is
 * driven by the same `useOrderDrag` hook as the control lists, so the counts
 * at the top can be edited from either place.
 */
function StudioPreview({
  navTabs,
  navButtons,
  sidebarPosition,
  sidebarVisible,
  page,
  pageItems,
  onReorderNavTabs,
  onReorderNavButtons,
  onReorderPageItems,
  onToggleNavTab,
  onToggleNavButton,
  onTogglePageItem,
  onToggleSidebarSection,
}: {
  navTabs: OrderListItem[];
  navButtons: OrderListItem[];
  sidebarPosition: "left" | "right";
  sidebarVisible: Record<string, boolean>;
  page: InterfacePageKey;
  pageItems: OrderListItem[];
  onReorderNavTabs: (from: number, to: number) => void;
  onReorderNavButtons: (from: number, to: number) => void;
  onReorderPageItems: (from: number, to: number) => void;
  onToggleNavTab: (id: string) => void;
  onToggleNavButton: (id: string) => void;
  onTogglePageItem: (id: string) => void;
  onToggleSidebarSection: (id: string) => void;
}) {
  const { t } = useLanguage();
  const isGlobal = page === "global";
  const pageDef = interfacePageDef(page);
  const tabsDrag = useOrderDrag(onReorderNavTabs);
  const buttonsDrag = useOrderDrag(onReorderNavButtons);
  const itemsDrag = useOrderDrag(onReorderPageItems);

  /** Shared row class so the drag states read the same in every preview list. */
  const rowClass = (
    base: string,
    drag: ReturnType<typeof useOrderDrag>,
    index: number,
    hidden: boolean,
  ) =>
    `${base}${hidden ? " is-off" : ""}${drag.dragIndex === index ? " is-dragging" : ""}${
      drag.overIndex === index && drag.dragIndex !== null && drag.dragIndex !== index
        ? " is-drop-target"
        : ""
    }`;

  /** Click-to-toggle guard: a drag that ended on another row must not also
   *  flip visibility. */
  const handleClick = (
    drag: ReturnType<typeof useOrderDrag>,
    action: () => void,
  ) => {
    if (drag.movedRef.current) return;
    action();
  };

  const startRowDrag =
    (drag: ReturnType<typeof useOrderDrag>, index: number) =>
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      drag.startDrag(index);
    };

  const toggleTitle = (label: string, hidden: boolean) =>
    `${label} — ${t(
      hidden ? "settings.interface.studioShow" : "settings.interface.studioHide",
    )}`;

  return (
    <div
      className={`studio-preview${sidebarPosition === "right" ? " is-sidebar-right" : ""}`}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* Header — drag a tab to reorder it, click it to hide/show. */}
      <div className="studio-preview__topnav">
        <span className="studio-preview__logo" aria-hidden="true" />
        <div className="studio-preview__tabs" ref={tabsDrag.containerRef}>
          {navTabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              data-order-index={index}
              className={rowClass("studio-preview__tab", tabsDrag, index, tab.hidden)}
              aria-pressed={!tab.hidden}
              title={toggleTitle(tab.label, tab.hidden)}
              onPointerDown={startRowDrag(tabsDrag, index)}
              onClick={() => handleClick(tabsDrag, () => onToggleNavTab(tab.id))}
            >
              <GripVertical className="studio-preview__grip" size={10} aria-hidden="true" />
              <tab.icon size={11} aria-hidden="true" />
              <span className="studio-preview__tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="studio-preview__actions" ref={buttonsDrag.containerRef}>
          {navButtons.map((button, index) => (
            <button
              key={button.id}
              type="button"
              data-order-index={index}
              className={rowClass("studio-preview__action", buttonsDrag, index, button.hidden)}
              aria-pressed={!button.hidden}
              title={toggleTitle(button.label, button.hidden)}
              onPointerDown={startRowDrag(buttonsDrag, index)}
              onClick={() => handleClick(buttonsDrag, () => onToggleNavButton(button.id))}
            >
              <button.icon size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="studio-preview__body">
        <div className="studio-preview__sidebar">
          {(["search", "activeFilters", "gameList", "statsFooter"] as const).map(
            (sectionKey) => {
              const label = t(SIDEBAR_LABEL_KEY[sectionKey]);
              return (
                <button
                  key={sectionKey}
                  type="button"
                  className={`studio-preview__section studio-preview__section--${sectionKey}${
                    sidebarVisible[sectionKey] ? "" : " is-off"
                  }`}
                  aria-pressed={sidebarVisible[sectionKey]}
                  aria-label={label}
                  title={toggleTitle(label, !sidebarVisible[sectionKey])}
                  onClick={() => onToggleSidebarSection(sectionKey)}
                >
                  {sectionKey === "activeFilters" && (
                    <span className="studio-preview__chips">
                      <i />
                      <i />
                    </span>
                  )}
                  {sectionKey === "gameList" &&
                    Array.from({ length: 6 }, (_, i) => (
                      <span key={i} className="studio-preview__game" />
                    ))}
                </button>
              );
            },
          )}
          {/* The A-Z scrubber is an overlay rail in the real sidebar, so it is
           *  drawn over the list instead of taking a row. */}
          <button
            type="button"
            className={`studio-preview__section studio-preview__rail${
              sidebarVisible.alphabetRail ? "" : " is-off"
            }`}
            aria-pressed={sidebarVisible.alphabetRail}
            aria-label={t(SIDEBAR_LABEL_KEY.alphabetRail)}
            title={toggleTitle(
              t(SIDEBAR_LABEL_KEY.alphabetRail),
              !sidebarVisible.alphabetRail,
            )}
            onClick={() => onToggleSidebarSection("alphabetRail")}
          />
        </div>

        <div className="studio-preview__main">
          <div className="studio-preview__main-head">
            <span className="studio-preview__main-title">
              {isGlobal
                ? t("settings.interface.studioPreview")
                : t(pageDef?.labelKey ?? "settings.interface.studioPreview")}
            </span>
            <span className="studio-preview__main-pill" />
          </div>
          {isGlobal ? (
            <div className="studio-preview__generic">
              <span className="studio-preview__block" style={{ height: 46 }} />
              <div className="studio-preview__grid">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className="studio-preview__block" />
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
                  className={rowClass("studio-preview__item", itemsDrag, index, item.hidden)}
                  aria-pressed={!item.hidden}
                  title={toggleTitle(item.label, item.hidden)}
                  onPointerDown={startRowDrag(itemsDrag, index)}
                  onClick={() => handleClick(itemsDrag, () => onTogglePageItem(item.id))}
                >
                  <GripVertical className="studio-preview__grip" size={11} aria-hidden="true" />
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
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

export default function LayoutEditorModal({ open, onClose }: LayoutEditorModalProps) {
  const { t } = useLanguage();
  const {
    uiSoundEnabled,
    navbarTabOrder,
    setNavbarTabOrder,
    navbarButtonOrder,
    setNavbarButtonOrder,
    interfaceVisibility,
    setInterfaceVisibility,
    sidebarPosition,
    setSidebarPosition,
    sidebarSectionVisible,
    setSidebarSectionVisible,
    pageItemVisible,
    setPageItemVisible,
    pageItemOrder,
    setPageItemOrder,
    uiDensityMode,
    setUiDensityMode,
    navbarMode,
    setNavbarMode,
  } = useSettings();

  const [activePage, setActivePage] = useState<InterfacePageKey>("global");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const playSound = useCallback(() => {
    if (uiSoundEnabled) playActionSound();
  }, [uiSoundEnabled]);

  const pageDef = interfacePageDef(activePage);

  // ── Global lists ──────────────────────────────────────────────────────────
  const navTabItems = useMemo<OrderListItem[]>(
    () =>
      sortByOrder(NAV_TAB_ITEMS, navbarTabOrder).map((item) => ({
        id: item.key,
        label: t(item.labelKey),
        icon: item.icon,
        hidden: !interfaceVisibility[item.key],
      })),
    [navbarTabOrder, interfaceVisibility, t],
  );

  const navButtonItems = useMemo<OrderListItem[]>(
    () =>
      sortByOrder(NAV_BUTTON_ITEMS, navbarButtonOrder).map((item) => ({
        id: item.key,
        label: t(item.labelKey),
        icon: item.icon,
        hidden: !interfaceVisibility[item.key],
      })),
    [navbarButtonOrder, interfaceVisibility, t],
  );

  const handleReorderNavTabs = useCallback(
    (from: number, to: number) => {
      setNavbarTabOrder(
        moveKey(
          navTabItems.map((item) => item.id) as InterfaceItemKey[],
          from,
          to,
        ),
      );
      playSound();
    },
    [navTabItems, setNavbarTabOrder, playSound],
  );

  const handleReorderNavButtons = useCallback(
    (from: number, to: number) => {
      setNavbarButtonOrder(
        moveKey(
          navButtonItems.map((item) => item.id) as InterfaceItemKey[],
          from,
          to,
        ),
      );
      playSound();
    },
    [navButtonItems, setNavbarButtonOrder, playSound],
  );

  // ── Per-page list ─────────────────────────────────────────────────────────
  const pageItems = useMemo<OrderListItem[]>(() => {
    if (!pageDef || activePage === "global") return [];
    const stored = pageItemOrder[activePage];
    const order = [
      ...(stored ?? []).filter((key) => pageDef.items.includes(key)),
      ...pageDef.items.filter((key) => !(stored ?? []).includes(key)),
    ];
    const hidden = pageItemVisible[activePage] ?? {};
    return order.map((key) => ({
      id: key,
      label: t(WIDGET_LABEL_KEY[key]),
      icon: WIDGET_ICON[key],
      hidden: hidden[key] === false,
    }));
  }, [activePage, pageDef, pageItemOrder, pageItemVisible, t]);

  const handleReorderPageItems = useCallback(
    (from: number, to: number) => {
      if (activePage === "global") return;
      setPageItemOrder(
        activePage,
        moveKey(
          pageItems.map((item) => item.id) as PageWidgetKey[],
          from,
          to,
        ),
      );
      playSound();
    },
    [activePage, pageItems, setPageItemOrder, playSound],
  );

  const toggleGlobalItem = useCallback(
    (id: string, hidden: boolean) => {
      setInterfaceVisibility(id as InterfaceItemKey, !hidden);
      playSound();
    },
    [setInterfaceVisibility, playSound],
  );

  const togglePageItem = useCallback(
    (id: string, hidden: boolean) => {
      if (activePage === "global") return;
      setPageItemVisible(activePage, id as PageWidgetKey, !hidden);
      playSound();
    },
    [activePage, setPageItemVisible, playSound],
  );

  // Toggle-by-id helpers used by the preview, which knows an element's key but
  // not whether it is currently on (unlike the control rows).
  const toggleInterfaceItemById = useCallback(
    (id: string) => {
      const key = id as InterfaceItemKey;
      setInterfaceVisibility(key, !interfaceVisibility[key]);
      playSound();
    },
    [interfaceVisibility, setInterfaceVisibility, playSound],
  );

  const togglePageItemById = useCallback(
    (id: string) => {
      if (activePage === "global") return;
      const key = id as PageWidgetKey;
      const hidden = pageItemVisible[activePage]?.[key] === false;
      setPageItemVisible(activePage, key, hidden);
      playSound();
    },
    [activePage, pageItemVisible, setPageItemVisible, playSound],
  );

  const toggleSidebarSectionById = useCallback(
    (id: string) => {
      const key = id as SidebarSectionKey;
      setSidebarSectionVisible(key, !sidebarSectionVisible[key]);
      playSound();
    },
    [sidebarSectionVisible, setSidebarSectionVisible, playSound],
  );

  const sidebarItems = useMemo<OrderListItem[]>(
    () =>
      SIDEBAR_SECTIONS.map((section) => ({
        id: section.key,
        label: t(section.labelKey),
        icon: SlidersHorizontal,
        hidden: !sidebarSectionVisible[section.key],
      })),
    [sidebarSectionVisible, t],
  );

  // ── Resets ────────────────────────────────────────────────────────────────
  const resetGlobal = useCallback(() => {
    setNavbarTabOrder(DEFAULT_NAVBAR_TAB_ORDER);
    setNavbarButtonOrder(DEFAULT_NAVBAR_BUTTON_ORDER);
    setSidebarPosition("left");
    for (const section of SIDEBAR_SECTIONS) {
      setSidebarSectionVisible(section.key, true);
    }
    playSound();
  }, [
    setNavbarTabOrder,
    setNavbarButtonOrder,
    setSidebarPosition,
    setSidebarSectionVisible,
    playSound,
  ]);

  const resetPage = useCallback(
    (page: InterfacePageKey) => {
      if (page === "global") return;
      const def = interfacePageDef(page);
      for (const key of def?.items ?? []) setPageItemVisible(page, key, true);
      setPageItemOrder(page, DEFAULT_PAGE_ITEM_ORDER[page] ?? []);
      playSound();
    },
    [setPageItemVisible, setPageItemOrder, playSound],
  );

  const resetEverything = useCallback(() => {
    resetGlobal();
    for (const page of INTERFACE_PAGES) resetPage(page.key);
    setInterfaceVisibility("btnDownloads", true);
    setInterfaceVisibility("btnSettings", true);
    setInterfaceVisibility("btnDocs", true);
    setInterfaceVisibility("btnBigScreen", true);
    for (const tab of NAV_TAB_ITEMS) setInterfaceVisibility(tab.key, true);
  }, [resetGlobal, resetPage, setInterfaceVisibility]);

  if (!open) return null;

  const hiddenCountForPage = (page: InterfacePageKey) => {
    const entry = pageItemVisible[page];
    if (!entry) return 0;
    return Object.values(entry).filter((visible) => visible === false).length;
  };

  return createPortal(
    <>
      <div className="modal-backdrop studio-backdrop" onMouseDown={onClose}>
        <div
          className="modal studio-modal"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="layout-studio-title"
        >
          <div className="modal-header">
            <div className="modal-header-icon">
              <LayoutTemplate />
            </div>
            <div className="modal-header-text">
              <h2 className="modal-title" id="layout-studio-title">
                {t("settings.interface.studioTitle")}
              </h2>
              <p className="modal-subtitle">
                {t("settings.interface.studioSubtitle")}
              </p>
            </div>
            <button
              type="button"
              className="studio-close"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Page tabs — top of the modal, one tab per page. */}
          <nav
            className="studio-pages"
            role="tablist"
            aria-label={t("settings.interface.studioPages")}
          >
            {INTERFACE_PAGES.map((page) => {
              const hiddenCount = hiddenCountForPage(page.key);
              const isActive = page.key === activePage;
              return (
                <button
                  key={page.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`studio-pages__tab${isActive ? " is-active" : ""}`}
                  onClick={() => setActivePage(page.key)}
                >
                  {page.key === "global" ? (
                    <LayoutTemplate size={14} aria-hidden="true" />
                  ) : (
                    <span className="studio-pages__dot" aria-hidden="true" />
                  )}
                  {t(page.labelKey)}
                  {hiddenCount > 0 && (
                    <span className="studio-pages__count">{hiddenCount}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="modal-body studio-body">
            {/* Live simplified preview of the main app. */}
            <section className="studio-pane studio-pane--preview">
              <h3 className="studio-pane__title">
                {t("settings.interface.studioPreview")}
              </h3>
              <StudioPreview
                navTabs={navTabItems}
                navButtons={navButtonItems}
                sidebarPosition={sidebarPosition}
                sidebarVisible={sidebarSectionVisible}
                page={activePage}
                pageItems={pageItems}
                onReorderNavTabs={handleReorderNavTabs}
                onReorderNavButtons={handleReorderNavButtons}
                onReorderPageItems={handleReorderPageItems}
                onToggleNavTab={toggleInterfaceItemById}
                onToggleNavButton={toggleInterfaceItemById}
                onTogglePageItem={togglePageItemById}
                onToggleSidebarSection={toggleSidebarSectionById}
              />
              <p className="studio-pane__hint">
                {t("settings.interface.studioPreviewHint")}
              </p>
            </section>

            {/* Controls for the active page. */}
            <section className="studio-pane studio-pane--controls">
              {activePage === "global" ? (
                <>
                  <h3 className="studio-pane__title">
                    {t("settings.interface.studioHeader")}
                  </h3>
                  <div className="studio-group">
                    <span className="studio-group__label">
                      {t("settings.interface.studioNavTabs")}
                    </span>
                    <OrderList
                      label={t("settings.interface.studioNavTabs")}
                      items={navTabItems}
                      onReorder={handleReorderNavTabs}
                      onToggle={toggleGlobalItem}
                    />
                  </div>
                  <div className="studio-group">
                    <span className="studio-group__label">
                      {t("settings.interface.studioNavButtons")}
                    </span>
                    <OrderList
                      label={t("settings.interface.studioNavButtons")}
                      items={navButtonItems}
                      onReorder={handleReorderNavButtons}
                      onToggle={toggleGlobalItem}
                    />
                  </div>

                  <h3 className="studio-pane__title">
                    {t("settings.interface.studioSidebar")}
                  </h3>
                  <div className="studio-group">
                    <span className="studio-group__label">
                      {t("settings.interface.studioSidebarPosition")}
                    </span>
                    <div
                      className="studio-segmented"
                      role="group"
                      aria-label={t("settings.interface.studioSidebarPosition")}
                    >
                      <button
                        type="button"
                        className={sidebarPosition === "left" ? "is-active" : ""}
                        aria-pressed={sidebarPosition === "left"}
                        onClick={() => {
                          setSidebarPosition("left");
                          playSound();
                        }}
                      >
                        {t("settings.interface.studioSidebarLeft")}
                      </button>
                      <button
                        type="button"
                        className={sidebarPosition === "right" ? "is-active" : ""}
                        aria-pressed={sidebarPosition === "right"}
                        onClick={() => {
                          setSidebarPosition("right");
                          playSound();
                        }}
                      >
                        {t("settings.interface.studioSidebarRight")}
                      </button>
                    </div>
                  </div>
                  <div className="studio-group">
                    <span className="studio-group__label">
                      {t("settings.interface.studioSidebarSections")}
                    </span>
                    <OrderList
                      label={t("settings.interface.studioSidebarSections")}
                      items={sidebarItems}
                      visibilityOnly
                      onToggle={(id, hidden) => {
                        setSidebarSectionVisible(id as SidebarSectionKey, !hidden);
                        playSound();
                      }}
                    />
                  </div>

                  <div className="studio-toggles">
                    <SettingsToggleCard
                      title={t("settings.appearance.simpleUiTitle")}
                      desc={t("settings.appearance.simpleUiDesc")}
                      checked={uiDensityMode === "simple"}
                      onChange={(checked) => {
                        setUiDensityMode(checked ? "simple" : "complete");
                        playSound();
                      }}
                    />
                    <SettingsToggleCard
                      title={t("settings.appearance.navbarCompactTitle")}
                      desc={t("settings.appearance.navbarCompactDesc")}
                      checked={navbarMode === "compact"}
                      onChange={(checked) => {
                        setNavbarMode(checked ? "compact" : "full");
                        playSound();
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="studio-pane__head">
                    <h3 className="studio-pane__title">
                      {t("settings.interface.studioPageItems")}
                    </h3>
                    <button
                      type="button"
                      className="studio-reset"
                      onClick={() => resetPage(activePage)}
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      {t("settings.interface.studioResetPage")}
                    </button>
                  </div>
                  <p className="studio-pane__hint">
                    {t("settings.interface.studioPageOrderHint")}
                  </p>
                  <OrderList
                    label={t("settings.interface.studioPageItems")}
                    items={pageItems}
                    onReorder={handleReorderPageItems}
                    onToggle={togglePageItem}
                  />
                </>
              )}
            </section>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="studio-reset"
              onClick={resetEverything}
            >
              <RotateCcw size={13} aria-hidden="true" />
              {t("settings.interface.studioResetAll")}
            </button>
            <div className="modal-footer-actions">
              <button type="button" className="studio-done" onClick={onClose}>
                {t("settings.interface.studioDone")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
