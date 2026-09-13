import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CheckCheck,
  Eye,
  EyeOff,
  Filter,
  Gamepad2,
  LayoutGrid,
  LayoutList,
  LayoutTemplate,
  List,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type {
  CommandPaletteMode,
  NavbarMode,
  SidebarPosition,
  UiDensityMode,
  UiScale,
} from "../../../context/SettingsContext";
import type {
  InterfacePageKey,
  PageWidgetKey,
} from "../../../context/interfaceLayout";
import { BADGE_ITEMS, MASTER_GATED_BADGES, WIDGET_ITEMS } from "../interfaceItems";
import { OrderList } from "./OrderList";
import type { FilterFilterMode, OrderListItem, StudioGroupKey } from "./types";

const UI_SCALE_OPTIONS: { value: UiScale; labelKey: string }[] = [
  { value: "auto", labelKey: "settings.appearance.uiScaleAuto" },
  { value: "85", labelKey: "settings.appearance.uiScale85" },
  { value: "100", labelKey: "settings.appearance.uiScale100" },
  { value: "110", labelKey: "settings.appearance.uiScale110" },
  { value: "125", labelKey: "settings.appearance.uiScale125" },
  { value: "150", labelKey: "settings.appearance.uiScale150" },
  { value: "175", labelKey: "settings.appearance.uiScale175" },
  { value: "200", labelKey: "settings.appearance.uiScale200" },
];

const WIDGET_ICON: Record<PageWidgetKey, LucideIcon> = {
  hero: Sparkles,
  kpis: SlidersHorizontal,
  filters: Filter,
  subtabs: LayoutList,
  dashboard: LayoutTemplate,
};

const WIDGET_KEY_BY_ITEM: Record<string, PageWidgetKey> = {
  widgetKpis: "kpis",
  widgetFilters: "filters",
  widgetSubtabs: "subtabs",
  widgetHero: "hero",
  widgetDashboard: "dashboard",
};

export interface StudioControlsProps {
  activePage: InterfacePageKey;
  uiScale: UiScale;
  uiDensityMode: UiDensityMode;
  navbarMode: NavbarMode;
  commandPaletteMode: CommandPaletteMode;
  showGameArtBackdrop: boolean;
  showCardBadges: boolean;
  showNavbarNowPlaying: boolean;
  sidebarPosition: SidebarPosition;
  interfaceVisibility: Record<string, boolean>;
  landingPage?: string;
  navTabItems: OrderListItem[];
  navButtonItems: OrderListItem[];
  sidebarItems: OrderListItem[];
  detailSectionItems: OrderListItem[];
  pageItems: OrderListItem[];
  highlightedId: string | null;
  onHoverItem: (id: string | null) => void;
  onSetUiScale: (val: UiScale) => void;
  onSetUiDensityMode: (val: UiDensityMode) => void;
  onSetNavbarMode: (val: NavbarMode) => void;
  onSetCommandPaletteMode: (val: CommandPaletteMode) => void;
  onSetShowGameArtBackdrop: (val: boolean) => void;
  onSetShowCardBadges: (val: boolean) => void;
  onSetShowNavbarNowPlaying: (val: boolean) => void;
  onSetSidebarPosition: (val: SidebarPosition) => void;
  onToggleGlobalItem: (id: string, hidden: boolean) => void;
  onToggleSidebarSection: (id: string, hidden: boolean) => void;
  onToggleDetailSection: (id: string, hidden: boolean) => void;
  onTogglePageItem: (id: string, hidden: boolean) => void;
  onReorderNavTabs: (from: number, to: number) => void;
  onReorderNavButtons: (from: number, to: number) => void;
  onReorderPageItems: (from: number, to: number) => void;
  onResetPage: (page: InterfacePageKey) => void;
  onResetGroup?: (group: StudioGroupKey) => void;
  onBatchToggleGroup?: (group: StudioGroupKey, visible: boolean) => void;
  onSetLandingPage?: (page: string) => void;
}

function StudioToggle({
  id,
  icon: Icon,
  label,
  desc,
  checked,
  disabled,
  isModified,
  isHighlighted,
  onHover,
  onChange,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  desc?: string;
  checked: boolean;
  disabled?: boolean;
  isModified?: boolean;
  isHighlighted?: boolean;
  onHover?: (hovering: boolean) => void;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      id={`studio-item-${id}`}
      data-studio-id={id}
      className={`studio-row studio-row--control${disabled ? " is-disabled" : ""}${
        isHighlighted ? " is-highlighted" : ""
      }`}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <Icon className="studio-row__icon" size={16} aria-hidden="true" />
      <span className="studio-row__text">
        <span className="studio-row__label">
          {label}
          {isModified && <span className="studio-row__modified-dot" />}
        </span>
        {desc && <span className="studio-row__desc">{desc}</span>}
      </span>
      <input
        type="checkbox"
        className="studio-row__check"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function StudioSelect({
  id,
  icon: Icon,
  label,
  desc,
  value,
  options,
  isModified,
  isHighlighted,
  onHover,
  onChange,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  desc?: string;
  value: string;
  options: { value: string; label: string }[];
  isModified?: boolean;
  isHighlighted?: boolean;
  onHover?: (hovering: boolean) => void;
  onChange: (next: string) => void;
}) {
  return (
    <label
      id={`studio-item-${id}`}
      data-studio-id={id}
      className={`studio-row studio-row--control${isHighlighted ? " is-highlighted" : ""}`}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <Icon className="studio-row__icon" size={16} aria-hidden="true" />
      <span className="studio-row__text">
        <span className="studio-row__label">
          {label}
          {isModified && <span className="studio-row__modified-dot" />}
        </span>
        {desc && <span className="studio-row__desc">{desc}</span>}
      </span>
      <select
        className="studio-row__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StudioControls({
  activePage,
  uiScale,
  uiDensityMode,
  navbarMode,
  commandPaletteMode,
  showGameArtBackdrop,
  showCardBadges,
  showNavbarNowPlaying,
  sidebarPosition,
  interfaceVisibility,
  landingPage,
  navTabItems,
  navButtonItems,
  sidebarItems,
  detailSectionItems,
  pageItems,
  highlightedId,
  onHoverItem,
  onSetUiScale,
  onSetUiDensityMode,
  onSetNavbarMode,
  onSetCommandPaletteMode,
  onSetShowGameArtBackdrop,
  onSetShowCardBadges,
  onSetShowNavbarNowPlaying,
  onSetSidebarPosition,
  onToggleGlobalItem,
  onToggleSidebarSection,
  onToggleDetailSection,
  onTogglePageItem,
  onReorderNavTabs,
  onReorderNavButtons,
  onReorderPageItems,
  onResetPage,
  onResetGroup,
  onBatchToggleGroup,
  onSetLandingPage,
}: StudioControlsProps) {
  const { t } = useLanguage();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterFilterMode>("all");

  const filterItem = (item: OrderListItem) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (
        !item.label.toLowerCase().includes(q) &&
        !item.id.toLowerCase().includes(q) &&
        !(item.hint && item.hint.toLowerCase().includes(q))
      ) {
        return false;
      }
    }
    if (filterMode === "visible") return !item.hidden;
    if (filterMode === "hidden") return item.hidden;
    if (filterMode === "modified") return !!item.isModified;
    return true;
  };

  const filteredNavTabs = useMemo(() => navTabItems.filter(filterItem), [navTabItems, searchQuery, filterMode]);
  const filteredNavButtons = useMemo(() => navButtonItems.filter(filterItem), [navButtonItems, searchQuery, filterMode]);
  const filteredSidebar = useMemo(() => sidebarItems.filter(filterItem), [sidebarItems, searchQuery, filterMode]);
  const filteredBadges = useMemo(() => {
    return BADGE_ITEMS.filter((item) => {
      const isHidden = !interfaceVisibility[item.key];
      const isMod = isHidden; // default is true
      if (searchQuery.trim()) {
        const label = t(item.labelKey).toLowerCase();
        if (!label.includes(searchQuery.toLowerCase())) return false;
      }
      if (filterMode === "visible") return !isHidden;
      if (filterMode === "hidden") return isHidden;
      if (filterMode === "modified") return isMod;
      return true;
    });
  }, [interfaceVisibility, searchQuery, filterMode, t]);

  const filteredWidgets = useMemo(() => {
    return WIDGET_ITEMS.filter((item) => {
      const isHidden = !interfaceVisibility[item.key];
      const isMod = isHidden;
      if (searchQuery.trim()) {
        const label = t(item.labelKey).toLowerCase();
        if (!label.includes(searchQuery.toLowerCase())) return false;
      }
      if (filterMode === "visible") return !isHidden;
      if (filterMode === "hidden") return isHidden;
      if (filterMode === "modified") return isMod;
      return true;
    });
  }, [interfaceVisibility, searchQuery, filterMode, t]);

  const filteredDetails = useMemo(() => detailSectionItems.filter(filterItem), [detailSectionItems, searchQuery, filterMode]);
  const filteredPageItems = useMemo(() => pageItems.filter(filterItem), [pageItems, searchQuery, filterMode]);

  const modifiedCount = useMemo(() => {
    let count = 0;
    count += navTabItems.filter((i) => i.isModified).length;
    count += navButtonItems.filter((i) => i.isModified).length;
    count += sidebarItems.filter((i) => i.isModified).length;
    count += detailSectionItems.filter((i) => i.isModified).length;
    count += BADGE_ITEMS.filter((i) => !interfaceVisibility[i.key]).length;
    count += WIDGET_ITEMS.filter((i) => !interfaceVisibility[i.key]).length;
    if (uiDensityMode !== "complete") count++;
    if (navbarMode !== "full") count++;
    if (commandPaletteMode !== "full") count++;
    if (!showGameArtBackdrop) count++;
    if (!showCardBadges) count++;
    if (!showNavbarNowPlaying) count++;
    if (sidebarPosition !== "left") count++;
    if (uiScale !== "auto") count++;
    return count;
  }, [
    navTabItems,
    navButtonItems,
    sidebarItems,
    detailSectionItems,
    interfaceVisibility,
    uiDensityMode,
    navbarMode,
    commandPaletteMode,
    showGameArtBackdrop,
    showCardBadges,
    showNavbarNowPlaying,
    sidebarPosition,
    uiScale,
  ]);

  const scrollToGroup = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const isCurrentLanding = landingPage === activePage;

  return (
    <div className="studio-controls-wrapper">
      {/* Search & Filter Bar */}
      <div className="studio-search-bar">
        <div className="studio-search-input-wrap">
          <Search size={14} className="studio-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="studio-search-input"
            placeholder={t("settings.interface.filterSearchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="studio-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label={t("settings.interface.clearSearch")}
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="studio-filter-chips">
          <button
            type="button"
            className={`studio-filter-chip${filterMode === "all" ? " is-active" : ""}`}
            onClick={() => setFilterMode("all")}
          >
            {t("settings.interface.filterAll")}
          </button>
          <button
            type="button"
            className={`studio-filter-chip${filterMode === "visible" ? " is-active" : ""}`}
            onClick={() => setFilterMode("visible")}
          >
            <Eye size={11} aria-hidden="true" />
            {t("settings.interface.filterVisible")}
          </button>
          <button
            type="button"
            className={`studio-filter-chip${filterMode === "hidden" ? " is-active" : ""}`}
            onClick={() => setFilterMode("hidden")}
          >
            <EyeOff size={11} aria-hidden="true" />
            {t("settings.interface.filterHidden")}
          </button>
          <button
            type="button"
            className={`studio-filter-chip${filterMode === "modified" ? " is-active" : ""}`}
            onClick={() => setFilterMode("modified")}
          >
            <span className="studio-row__modified-dot" />
            {t("settings.interface.filterModified")}
            {modifiedCount > 0 && <span className="studio-filter-count">{modifiedCount}</span>}
          </button>
        </div>
      </div>

      {activePage === "global" ? (
        <>
          {/* Sticky Group Jump Bar */}
          <nav className="studio-jumpbar" aria-label={t("settings.interface.studioJumpNav")}>
            <button
              type="button"
              className="studio-jumpbar__chip"
              onClick={() => scrollToGroup("studio-group-layout")}
            >
              {t("settings.appearance.interfaceTitle")}
            </button>
            <button
              type="button"
              className="studio-jumpbar__chip"
              onClick={() => scrollToGroup("studio-group-header")}
            >
              {t("settings.interface.studioHeader")}
            </button>
            <button
              type="button"
              className="studio-jumpbar__chip"
              onClick={() => scrollToGroup("studio-group-sidebar")}
            >
              {t("settings.interface.studioSidebar")}
            </button>
            <button
              type="button"
              className="studio-jumpbar__chip"
              onClick={() => scrollToGroup("studio-group-badges")}
            >
              {t("settings.section.interfaceBadges")}
            </button>
            <button
              type="button"
              className="studio-jumpbar__chip"
              onClick={() => scrollToGroup("studio-group-widgets")}
            >
              {t("settings.interface.studioWidgetsAllPages")}
            </button>
            <button
              type="button"
              className="studio-jumpbar__chip"
              onClick={() => scrollToGroup("studio-group-details")}
            >
              {t("settings.detailSections.title")}
            </button>
          </nav>

          {/* Group 1: General Shell Layout */}
          <div className="studio-section-head" id="studio-group-layout">
            <h3 className="studio-pane__title">{t("settings.appearance.interfaceTitle")}</h3>
            {onResetGroup && (
              <button
                type="button"
                className="studio-group-reset-btn"
                onClick={() => onResetGroup("layout")}
                title={t("settings.interface.resetGroup")}
              >
                <RotateCcw size={12} aria-hidden="true" />
                <span>{t("settings.interface.resetGroup")}</span>
              </button>
            )}
          </div>
          <div className="studio-group">
            <StudioSelect
              id="ui-scale"
              icon={SlidersHorizontal}
              label={t("settings.appearance.uiScaleTitle")}
              desc={t("settings.appearance.uiScaleDesc")}
              value={uiScale}
              options={UI_SCALE_OPTIONS.map((opt) => ({
                value: opt.value,
                label: t(opt.labelKey),
              }))}
              isModified={uiScale !== "auto"}
              isHighlighted={highlightedId === "ui-scale"}
              onHover={(hover) => onHoverItem(hover ? "ui-scale" : null)}
              onChange={(next) => onSetUiScale(next as UiScale)}
            />
            <StudioToggle
              id="density-simple"
              icon={LayoutTemplate}
              label={t("settings.appearance.simpleUiTitle")}
              desc={t("settings.appearance.simpleUiDesc")}
              checked={uiDensityMode === "simple"}
              isModified={uiDensityMode === "simple"}
              isHighlighted={highlightedId === "density-simple"}
              onHover={(hover) => onHoverItem(hover ? "density-simple" : null)}
              onChange={(checked) => onSetUiDensityMode(checked ? "simple" : "complete")}
            />
            <StudioToggle
              id="navbar-compact"
              icon={LayoutList}
              label={t("settings.appearance.navbarCompactTitle")}
              desc={t("settings.appearance.navbarCompactDesc")}
              checked={navbarMode === "compact"}
              isModified={navbarMode === "compact"}
              isHighlighted={highlightedId === "navbar-compact"}
              onHover={(hover) => onHoverItem(hover ? "navbar-compact" : null)}
              onChange={(checked) => onSetNavbarMode(checked ? "compact" : "full")}
            />
            <StudioToggle
              id="palette-mode"
              icon={List}
              label={t("settings.appearance.cmdPaletteSimpleTitle")}
              desc={t("settings.appearance.cmdPaletteSimpleDesc")}
              checked={commandPaletteMode === "simple"}
              isModified={commandPaletteMode === "simple"}
              isHighlighted={highlightedId === "palette-mode"}
              onHover={(hover) => onHoverItem(hover ? "palette-mode" : null)}
              onChange={(checked) => onSetCommandPaletteMode(checked ? "simple" : "full")}
            />
            <StudioToggle
              id="art-backdrop"
              icon={LayoutGrid}
              label={t("settings.appearance.artBackdropTitle")}
              desc={t("settings.appearance.artBackdropDesc")}
              checked={showGameArtBackdrop}
              isModified={!showGameArtBackdrop}
              isHighlighted={highlightedId === "art-backdrop"}
              onHover={(hover) => onHoverItem(hover ? "art-backdrop" : null)}
              onChange={onSetShowGameArtBackdrop}
            />
          </div>

          {/* Group 2: Header */}
          <div className="studio-section-head" id="studio-group-header">
            <h3 className="studio-pane__title">{t("settings.interface.studioHeader")}</h3>
            <div className="studio-section-head__actions">
              {onBatchToggleGroup && (
                <>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("header", true)}
                    title={t("settings.interface.showAll")}
                  >
                    <CheckCheck size={12} aria-hidden="true" />
                    <span>{t("settings.interface.showAll")}</span>
                  </button>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("header", false)}
                    title={t("settings.interface.hideAll")}
                  >
                    <EyeOff size={12} aria-hidden="true" />
                    <span>{t("settings.interface.hideAll")}</span>
                  </button>
                </>
              )}
              {onResetGroup && (
                <button
                  type="button"
                  className="studio-group-reset-btn"
                  onClick={() => onResetGroup("header")}
                  title={t("settings.interface.resetGroup")}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>{t("settings.interface.resetGroup")}</span>
                </button>
              )}
            </div>
          </div>
          <div className="studio-group">
            <span className="studio-group__label">{t("settings.interface.studioNavTabs")}</span>
            <OrderList
              label={t("settings.interface.studioNavTabs")}
              items={filteredNavTabs}
              onReorder={onReorderNavTabs}
              onToggle={onToggleGlobalItem}
              highlightedId={highlightedId}
              onHoverItem={onHoverItem}
            />
          </div>
          <div className="studio-group">
            <span className="studio-group__label">{t("settings.interface.studioNavButtons")}</span>
            <OrderList
              label={t("settings.interface.studioNavButtons")}
              items={filteredNavButtons}
              onReorder={onReorderNavButtons}
              onToggle={onToggleGlobalItem}
              highlightedId={highlightedId}
              onHoverItem={onHoverItem}
            />
          </div>
          <div className="studio-group">
            <StudioToggle
              id="now-playing"
              icon={Gamepad2}
              label={t("settings.appearance.navbarNowPlayingTitle")}
              desc={t("settings.appearance.navbarNowPlayingDesc")}
              checked={showNavbarNowPlaying}
              isModified={!showNavbarNowPlaying}
              isHighlighted={highlightedId === "now-playing"}
              onHover={(hover) => onHoverItem(hover ? "now-playing" : null)}
              onChange={onSetShowNavbarNowPlaying}
            />
          </div>

          {/* Group 3: Sidebar */}
          <div className="studio-section-head" id="studio-group-sidebar">
            <h3 className="studio-pane__title">{t("settings.interface.studioSidebar")}</h3>
            <div className="studio-section-head__actions">
              {onBatchToggleGroup && (
                <>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("sidebar", true)}
                    title={t("settings.interface.showAll")}
                  >
                    <CheckCheck size={12} aria-hidden="true" />
                    <span>{t("settings.interface.showAll")}</span>
                  </button>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("sidebar", false)}
                    title={t("settings.interface.hideAll")}
                  >
                    <EyeOff size={12} aria-hidden="true" />
                    <span>{t("settings.interface.hideAll")}</span>
                  </button>
                </>
              )}
              {onResetGroup && (
                <button
                  type="button"
                  className="studio-group-reset-btn"
                  onClick={() => onResetGroup("sidebar")}
                  title={t("settings.interface.resetGroup")}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>{t("settings.interface.resetGroup")}</span>
                </button>
              )}
            </div>
          </div>
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
                onClick={() => onSetSidebarPosition("left")}
              >
                {t("settings.interface.studioSidebarLeft")}
              </button>
              <button
                type="button"
                className={sidebarPosition === "right" ? "is-active" : ""}
                aria-pressed={sidebarPosition === "right"}
                onClick={() => onSetSidebarPosition("right")}
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
              items={filteredSidebar}
              visibilityOnly
              onToggle={onToggleSidebarSection}
              highlightedId={highlightedId}
              onHoverItem={onHoverItem}
            />
          </div>

          {/* Group 4: Card Badges */}
          <div className="studio-section-head" id="studio-group-badges">
            <h3 className="studio-pane__title">{t("settings.section.interfaceBadges")}</h3>
            <div className="studio-section-head__actions">
              {onBatchToggleGroup && (
                <>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("badges", true)}
                    title={t("settings.interface.showAll")}
                  >
                    <CheckCheck size={12} aria-hidden="true" />
                    <span>{t("settings.interface.showAll")}</span>
                  </button>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("badges", false)}
                    title={t("settings.interface.hideAll")}
                  >
                    <EyeOff size={12} aria-hidden="true" />
                    <span>{t("settings.interface.hideAll")}</span>
                  </button>
                </>
              )}
              {onResetGroup && (
                <button
                  type="button"
                  className="studio-group-reset-btn"
                  onClick={() => onResetGroup("badges")}
                  title={t("settings.interface.resetGroup")}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>{t("settings.interface.resetGroup")}</span>
                </button>
              )}
            </div>
          </div>
          <div className="studio-group">
            <StudioToggle
              id="badges-master"
              icon={BadgeCheck}
              label={t("settings.appearance.cardBadgesTitle")}
              desc={t("settings.appearance.cardBadgesDesc")}
              checked={showCardBadges}
              isModified={!showCardBadges}
              isHighlighted={highlightedId === "badges-master"}
              onHover={(hover) => onHoverItem(hover ? "badges-master" : null)}
              onChange={onSetShowCardBadges}
            />
            {filteredBadges.map((item) => (
              <StudioToggle
                key={item.key}
                id={item.key}
                icon={BadgeCheck}
                label={t(item.labelKey)}
                checked={interfaceVisibility[item.key]}
                disabled={MASTER_GATED_BADGES.has(item.key) && !showCardBadges}
                isModified={!interfaceVisibility[item.key]}
                isHighlighted={highlightedId === item.key}
                onHover={(hover) => onHoverItem(hover ? item.key : null)}
                onChange={(checked) => onToggleGlobalItem(item.key, !checked)}
              />
            ))}
          </div>

          {/* Group 5: Widgets */}
          <div className="studio-section-head" id="studio-group-widgets">
            <h3 className="studio-pane__title">{t("settings.interface.studioWidgetsAllPages")}</h3>
            <div className="studio-section-head__actions">
              {onBatchToggleGroup && (
                <>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("widgets", true)}
                    title={t("settings.interface.showAll")}
                  >
                    <CheckCheck size={12} aria-hidden="true" />
                    <span>{t("settings.interface.showAll")}</span>
                  </button>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("widgets", false)}
                    title={t("settings.interface.hideAll")}
                  >
                    <EyeOff size={12} aria-hidden="true" />
                    <span>{t("settings.interface.hideAll")}</span>
                  </button>
                </>
              )}
              {onResetGroup && (
                <button
                  type="button"
                  className="studio-group-reset-btn"
                  onClick={() => onResetGroup("widgets")}
                  title={t("settings.interface.resetGroup")}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>{t("settings.interface.resetGroup")}</span>
                </button>
              )}
            </div>
          </div>
          <p className="studio-pane__hint">
            {t("settings.interface.studioWidgetsAllPagesHint")}
          </p>
          <div className="studio-group">
            {filteredWidgets.map((item) => (
              <StudioToggle
                key={item.key}
                id={item.key}
                icon={WIDGET_ICON[WIDGET_KEY_BY_ITEM[item.key]]}
                label={t(item.labelKey)}
                checked={interfaceVisibility[item.key]}
                isModified={!interfaceVisibility[item.key]}
                isHighlighted={highlightedId === item.key}
                onHover={(hover) => onHoverItem(hover ? item.key : null)}
                onChange={(checked) => onToggleGlobalItem(item.key, !checked)}
              />
            ))}
          </div>

          {/* Group 6: Detail sections */}
          <div className="studio-section-head" id="studio-group-details">
            <h3 className="studio-pane__title">{t("settings.detailSections.title")}</h3>
            <div className="studio-section-head__actions">
              {onBatchToggleGroup && (
                <>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("details", true)}
                    title={t("settings.interface.showAll")}
                  >
                    <CheckCheck size={12} aria-hidden="true" />
                    <span>{t("settings.interface.showAll")}</span>
                  </button>
                  <button
                    type="button"
                    className="studio-batch-btn"
                    onClick={() => onBatchToggleGroup("details", false)}
                    title={t("settings.interface.hideAll")}
                  >
                    <EyeOff size={12} aria-hidden="true" />
                    <span>{t("settings.interface.hideAll")}</span>
                  </button>
                </>
              )}
              {onResetGroup && (
                <button
                  type="button"
                  className="studio-group-reset-btn"
                  onClick={() => onResetGroup("details")}
                  title={t("settings.interface.resetGroup")}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>{t("settings.interface.resetGroup")}</span>
                </button>
              )}
            </div>
          </div>
          <p className="studio-pane__hint">{t("settings.detailSections.desc")}</p>
          <OrderList
            label={t("settings.detailSections.title")}
            items={filteredDetails}
            visibilityOnly
            onToggle={onToggleDetailSection}
            highlightedId={highlightedId}
            onHoverItem={onHoverItem}
          />
        </>
      ) : (
        <>
          <div className="studio-pane__head">
            <div className="studio-pane__head-text">
              <h3 className="studio-pane__title">{t("settings.interface.studioPageItems")}</h3>
              {onSetLandingPage && activePage !== "game" && (
                <button
                  type="button"
                  className={`studio-landing-chip${isCurrentLanding ? " is-landing" : ""}`}
                  onClick={() => onSetLandingPage(activePage)}
                  title={
                    isCurrentLanding
                      ? t("settings.interface.currentLandingPage")
                      : t("settings.interface.setAsLandingPage")
                  }
                >
                  <Star size={11} fill={isCurrentLanding ? "currentColor" : "none"} />
                  <span>
                    {isCurrentLanding
                      ? t("settings.interface.isLandingPage")
                      : t("settings.interface.makeLandingPage")}
                  </span>
                </button>
              )}
            </div>

            <button
              type="button"
              className="studio-reset"
              onClick={() => onResetPage(activePage)}
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
            items={filteredPageItems}
            onReorder={onReorderPageItems}
            onToggle={onTogglePageItem}
            highlightedId={highlightedId}
            onHoverItem={onHoverItem}
          />
        </>
      )}
    </div>
  );
}
