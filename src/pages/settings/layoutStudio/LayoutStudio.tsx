import { useCallback, useMemo, useState } from "react";
import { LayoutTemplate, List, RotateCcw, Star } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import {
  DEFAULT_NAVBAR_BUTTON_ORDER,
  DEFAULT_NAVBAR_TAB_ORDER,
  useSettings,
  type DetailSectionKey,
  type InterfaceItemKey,
  type LandingPage,
} from "../../../context/SettingsContext";
import {
  DEFAULT_PAGE_ITEM_ORDER,
  INTERFACE_PAGES,
  SIDEBAR_SECTIONS,
  WIDGET_LABEL_KEY,
  interfacePageDef,
  type InterfacePageKey,
  type PageWidgetKey,
  type SidebarSectionKey,
} from "../../../context/interfaceLayout";
import {
  BADGE_ITEMS,
  NAV_BUTTON_ITEMS,
  NAV_TAB_ITEMS,
  WIDGET_ITEMS,
  buildDetailSectionItems,
  moveKey,
  sortByOrder,
} from "../interfaceItems";
import { playActionSound } from "../../../utils/soundEffects";
import { StudioControls } from "./StudioControls";
import { StudioPresetsBar } from "./StudioPresetsBar";
import { StudioPreview } from "./StudioPreview";
import { getDefaultLayoutSnapshot, isItemModifiedFromDefault } from "./layoutPresets";
import type {
  LayoutPreset,
  LayoutSnapshot,
  OrderListItem,
  StudioGroupKey,
} from "./types";
import "../LayoutStudio.css";

export default function LayoutStudio() {
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
    uiScale,
    setUiScale,
    commandPaletteMode,
    setCommandPaletteMode,
    showGameArtBackdrop,
    setShowGameArtBackdrop,
    showCardBadges,
    setShowCardBadges,
    showNavbarNowPlaying,
    setShowNavbarNowPlaying,
    detailSectionVisible,
    setDetailSectionVisible,
    showDeckVerified,
    landingPage,
    setLandingPage,
  } = useSettings();

  const [activePage, setActivePage] = useState<InterfacePageKey>("global");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const playSound = useCallback(() => {
    if (uiSoundEnabled) playActionSound();
  }, [uiSoundEnabled]);

  const defaultSnapshot = useMemo(() => getDefaultLayoutSnapshot(), []);

  const pageDef = interfacePageDef(activePage);

  // ── Global lists ──────────────────────────────────────────────────────────
  const navTabItems = useMemo<OrderListItem[]>(
    () =>
      sortByOrder(NAV_TAB_ITEMS, navbarTabOrder).map((item) => ({
        id: item.key,
        label: t(item.labelKey),
        icon: item.icon,
        hidden: !interfaceVisibility[item.key],
        isModified: isItemModifiedFromDefault(
          item.key,
          interfaceVisibility[item.key],
          defaultSnapshot,
        ),
      })),
    [navbarTabOrder, interfaceVisibility, defaultSnapshot, t],
  );

  const navButtonItems = useMemo<OrderListItem[]>(
    () =>
      sortByOrder(NAV_BUTTON_ITEMS, navbarButtonOrder).map((item) => ({
        id: item.key,
        label: t(item.labelKey),
        icon: item.icon,
        hidden: !interfaceVisibility[item.key],
        isModified: isItemModifiedFromDefault(
          item.key,
          interfaceVisibility[item.key],
          defaultSnapshot,
        ),
      })),
    [navbarButtonOrder, interfaceVisibility, defaultSnapshot, t],
  );

  const sidebarItems = useMemo<OrderListItem[]>(
    () =>
      SIDEBAR_SECTIONS.map((section) => ({
        id: section.key,
        label: t(section.labelKey),
        icon: LayoutTemplate,
        hidden: !sidebarSectionVisible[section.key],
        isModified: isItemModifiedFromDefault(
          section.key,
          sidebarSectionVisible[section.key],
          defaultSnapshot,
        ),
      })),
    [sidebarSectionVisible, defaultSnapshot, t],
  );

  const detailSectionItems = useMemo<OrderListItem[]>(
    () =>
      buildDetailSectionItems(showDeckVerified).map((section) => ({
        id: section.key,
        label: t(section.titleKey),
        hint: t(section.descKey),
        icon: List,
        hidden: !detailSectionVisible[section.key],
        isModified: isItemModifiedFromDefault(
          section.key,
          detailSectionVisible[section.key],
          defaultSnapshot,
        ),
      })),
    [showDeckVerified, detailSectionVisible, defaultSnapshot, t],
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
      icon: LayoutTemplate,
      hidden: hidden[key] === false,
      isModified: hidden[key] === false,
    }));
  }, [activePage, pageDef, pageItemOrder, pageItemVisible, t]);

  // Current Layout Snapshot
  const currentSnapshot = useMemo<LayoutSnapshot>(
    () => ({
      navbarTabOrder,
      navbarButtonOrder,
      interfaceVisibility,
      sidebarPosition,
      sidebarSectionVisible,
      pageItemVisible,
      pageItemOrder,
      uiDensityMode,
      navbarMode,
      commandPaletteMode,
      showGameArtBackdrop,
      showCardBadges,
      showNavbarNowPlaying,
      detailSectionVisible,
      uiScale,
    }),
    [
      navbarTabOrder,
      navbarButtonOrder,
      interfaceVisibility,
      sidebarPosition,
      sidebarSectionVisible,
      pageItemVisible,
      pageItemOrder,
      uiDensityMode,
      navbarMode,
      commandPaletteMode,
      showGameArtBackdrop,
      showCardBadges,
      showNavbarNowPlaying,
      detailSectionVisible,
      uiScale,
    ],
  );

  // ── Reorder Handlers ──────────────────────────────────────────────────────
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

  // ── Toggle Handlers ───────────────────────────────────────────────────────
  const toggleGlobalItem = useCallback(
    (id: string, hidden: boolean) => {
      setInterfaceVisibility(id as InterfaceItemKey, !hidden);
      playSound();
    },
    [setInterfaceVisibility, playSound],
  );

  const toggleSidebarSection = useCallback(
    (id: string, hidden: boolean) => {
      setSidebarSectionVisible(id as SidebarSectionKey, !hidden);
      playSound();
    },
    [setSidebarSectionVisible, playSound],
  );

  const toggleDetailSection = useCallback(
    (id: string, hidden: boolean) => {
      setDetailSectionVisible(id as DetailSectionKey, !hidden);
      playSound();
    },
    [setDetailSectionVisible, playSound],
  );

  const togglePageItem = useCallback(
    (id: string, hidden: boolean) => {
      if (activePage === "global") return;
      setPageItemVisible(activePage, id as PageWidgetKey, !hidden);
      playSound();
    },
    [activePage, setPageItemVisible, playSound],
  );

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

  // ── Preset & Snapshot Application ─────────────────────────────────────────
  const applySnapshot = useCallback(
    (snapshot: Partial<LayoutSnapshot>) => {
      if (snapshot.navbarTabOrder) setNavbarTabOrder(snapshot.navbarTabOrder);
      if (snapshot.navbarButtonOrder) setNavbarButtonOrder(snapshot.navbarButtonOrder);
      if (snapshot.interfaceVisibility) {
        for (const [k, v] of Object.entries(snapshot.interfaceVisibility)) {
          setInterfaceVisibility(k as InterfaceItemKey, v);
        }
      }
      if (snapshot.sidebarPosition) setSidebarPosition(snapshot.sidebarPosition);
      if (snapshot.sidebarSectionVisible) {
        for (const [k, v] of Object.entries(snapshot.sidebarSectionVisible)) {
          setSidebarSectionVisible(k as SidebarSectionKey, v);
        }
      }
      if (snapshot.uiDensityMode) setUiDensityMode(snapshot.uiDensityMode);
      if (snapshot.navbarMode) setNavbarMode(snapshot.navbarMode);
      if (snapshot.commandPaletteMode) setCommandPaletteMode(snapshot.commandPaletteMode);
      if (typeof snapshot.showGameArtBackdrop === "boolean") {
        setShowGameArtBackdrop(snapshot.showGameArtBackdrop);
      }
      if (typeof snapshot.showCardBadges === "boolean") {
        setShowCardBadges(snapshot.showCardBadges);
      }
      if (typeof snapshot.showNavbarNowPlaying === "boolean") {
        setShowNavbarNowPlaying(snapshot.showNavbarNowPlaying);
      }
      if (snapshot.detailSectionVisible) {
        for (const [k, v] of Object.entries(snapshot.detailSectionVisible)) {
          setDetailSectionVisible(k as DetailSectionKey, v);
        }
      }
      if (snapshot.uiScale) setUiScale(snapshot.uiScale);
      playSound();
    },
    [
      setNavbarTabOrder,
      setNavbarButtonOrder,
      setInterfaceVisibility,
      setSidebarPosition,
      setSidebarSectionVisible,
      setUiDensityMode,
      setNavbarMode,
      setCommandPaletteMode,
      setShowGameArtBackdrop,
      setShowCardBadges,
      setShowNavbarNowPlaying,
      setDetailSectionVisible,
      setUiScale,
      playSound,
    ],
  );

  const handleApplyPreset = useCallback(
    (preset: LayoutPreset) => {
      applySnapshot(preset.snapshot);
    },
    [applySnapshot],
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
    for (const item of [
      ...NAV_TAB_ITEMS,
      ...NAV_BUTTON_ITEMS,
      ...BADGE_ITEMS,
      ...WIDGET_ITEMS,
    ]) {
      setInterfaceVisibility(item.key, true);
    }
    setShowCardBadges(true);
    setShowNavbarNowPlaying(true);
    for (const section of buildDetailSectionItems(true)) {
      setDetailSectionVisible(section.key, true);
    }
    setUiDensityMode("complete");
    setNavbarMode("full");
    setCommandPaletteMode("full");
    setShowGameArtBackdrop(true);
    setUiScale("auto");
    playSound();
  }, [
    resetGlobal,
    resetPage,
    setInterfaceVisibility,
    setShowCardBadges,
    setShowNavbarNowPlaying,
    setDetailSectionVisible,
    setUiDensityMode,
    setNavbarMode,
    setCommandPaletteMode,
    setShowGameArtBackdrop,
    setUiScale,
    playSound,
  ]);

  const resetGroup = useCallback(
    (group: StudioGroupKey) => {
      switch (group) {
        case "layout":
          setUiDensityMode("complete");
          setNavbarMode("full");
          setCommandPaletteMode("full");
          setShowGameArtBackdrop(true);
          setUiScale("auto");
          break;
        case "header":
          setNavbarTabOrder(DEFAULT_NAVBAR_TAB_ORDER);
          setNavbarButtonOrder(DEFAULT_NAVBAR_BUTTON_ORDER);
          for (const item of [...NAV_TAB_ITEMS, ...NAV_BUTTON_ITEMS]) {
            setInterfaceVisibility(item.key, true);
          }
          setShowNavbarNowPlaying(true);
          break;
        case "sidebar":
          setSidebarPosition("left");
          for (const s of SIDEBAR_SECTIONS) setSidebarSectionVisible(s.key, true);
          break;
        case "badges":
          setShowCardBadges(true);
          for (const b of BADGE_ITEMS) setInterfaceVisibility(b.key, true);
          break;
        case "widgets":
          for (const w of WIDGET_ITEMS) setInterfaceVisibility(w.key, true);
          break;
        case "details":
          for (const d of buildDetailSectionItems(true)) {
            setDetailSectionVisible(d.key, true);
          }
          break;
      }
      playSound();
    },
    [
      setUiDensityMode,
      setNavbarMode,
      setCommandPaletteMode,
      setShowGameArtBackdrop,
      setUiScale,
      setNavbarTabOrder,
      setNavbarButtonOrder,
      setInterfaceVisibility,
      setShowNavbarNowPlaying,
      setSidebarPosition,
      setSidebarSectionVisible,
      setShowCardBadges,
      setDetailSectionVisible,
      playSound,
    ],
  );

  const batchToggleGroup = useCallback(
    (group: StudioGroupKey, visible: boolean) => {
      switch (group) {
        case "header":
          for (const item of [...NAV_TAB_ITEMS, ...NAV_BUTTON_ITEMS]) {
            setInterfaceVisibility(item.key, visible);
          }
          setShowNavbarNowPlaying(visible);
          break;
        case "sidebar":
          for (const s of SIDEBAR_SECTIONS) setSidebarSectionVisible(s.key, visible);
          break;
        case "badges":
          setShowCardBadges(visible);
          for (const b of BADGE_ITEMS) setInterfaceVisibility(b.key, visible);
          break;
        case "widgets":
          for (const w of WIDGET_ITEMS) setInterfaceVisibility(w.key, visible);
          break;
        case "details":
          for (const d of buildDetailSectionItems(true)) {
            setDetailSectionVisible(d.key, visible);
          }
          break;
      }
      playSound();
    },
    [
      setInterfaceVisibility,
      setShowNavbarNowPlaying,
      setSidebarSectionVisible,
      setShowCardBadges,
      setDetailSectionVisible,
      playSound,
    ],
  );

  // ── Inspection scroll helper ──────────────────────────────────────────────
  const handleInspectElement = useCallback((id: string) => {
    setHighlightedId(id);
    const target = document.getElementById(`studio-item-${id}`);
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    setTimeout(() => {
      setHighlightedId(null);
    }, 2500);
  }, []);

  const hiddenCountForPage = (page: InterfacePageKey) => {
    if (page === "global") {
      const itemGroups = [NAV_TAB_ITEMS, NAV_BUTTON_ITEMS, BADGE_ITEMS, WIDGET_ITEMS];
      const hiddenItems = itemGroups.reduce(
        (count, group) =>
          count + group.filter((item) => interfaceVisibility[item.key] === false).length,
        0,
      );
      const hiddenSidebar = SIDEBAR_SECTIONS.filter(
        (section) => !sidebarSectionVisible[section.key],
      ).length;
      const hiddenDetailSections = buildDetailSectionItems(showDeckVerified).filter(
        (section) => !detailSectionVisible[section.key],
      ).length;
      return hiddenItems + hiddenSidebar + hiddenDetailSections;
    }
    const entry = pageItemVisible[page];
    if (!entry) return 0;
    return Object.values(entry).filter((visible) => visible === false).length;
  };

  return (
    <section className="studio" aria-labelledby="layout-studio-title">
      {/* Studio Header */}
      <div className="studio-header">
        <span className="studio-header__icon">
          <LayoutTemplate size={20} aria-hidden="true" />
        </span>
        <div className="studio-header__text">
          <h2 className="studio-header__title" id="layout-studio-title">
            {t("settings.interface.studioTitle")}
          </h2>
          <p className="studio-header__subtitle">
            {t("settings.interface.studioSubtitle")}
          </p>
        </div>
        <button
          type="button"
          className="studio-reset"
          onClick={resetEverything}
          title={t("settings.interface.studioResetAll")}
        >
          <RotateCcw size={13} aria-hidden="true" />
          {t("settings.interface.studioResetAll")}
        </button>
      </div>

      {/* Presets & Profile Management Bar */}
      <StudioPresetsBar
        currentSnapshot={currentSnapshot}
        onApplyPreset={handleApplyPreset}
        onImportSnapshot={applySnapshot}
      />

      {/* Page Tabs */}
      <nav
        className="studio-pages"
        role="tablist"
        aria-label={t("settings.interface.studioPages")}
      >
        {INTERFACE_PAGES.map((p) => {
          const hiddenCount = hiddenCountForPage(p.key);
          const isActive = p.key === activePage;
          const isLanding = landingPage === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`studio-pages__tab${isActive ? " is-active" : ""}`}
              onClick={() => setActivePage(p.key)}
            >
              {p.key === "global" ? (
                <LayoutTemplate size={14} aria-hidden="true" />
              ) : (
                <span className="studio-pages__dot" aria-hidden="true" />
              )}
              <span>{t(p.labelKey)}</span>
              {isLanding && (
                <span title={t("settings.interface.isLandingPage")}>
                  <Star
                    size={10}
                    className="studio-pages__landing-star"
                    fill="currentColor"
                    aria-hidden="true"
                  />
                </span>
              )}
              {hiddenCount > 0 && (
                <span className="studio-pages__count">{hiddenCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Studio Body: Preview (Left) + Controls (Right) */}
      <div className="studio-body">
        {/* Left Pane: Interactive Live Preview */}
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
            badgesVisible={interfaceVisibility}
            showNowPlaying={showNavbarNowPlaying}
            showCardBadgesMaster={showCardBadges}
            highlightedId={highlightedId}
            onReorderNavTabs={handleReorderNavTabs}
            onReorderNavButtons={handleReorderNavButtons}
            onReorderPageItems={handleReorderPageItems}
            onToggleNavTab={toggleInterfaceItemById}
            onToggleNavButton={toggleInterfaceItemById}
            onTogglePageItem={togglePageItemById}
            onToggleSidebarSection={toggleSidebarSectionById}
            onInspectElement={handleInspectElement}
          />

          <p className="studio-pane__hint">
            {t("settings.interface.studioPreviewHint")}
          </p>
        </section>

        {/* Right Pane: Controls */}
        <section className="studio-pane studio-pane--controls">
          <StudioControls
            activePage={activePage}
            uiScale={uiScale}
            uiDensityMode={uiDensityMode}
            navbarMode={navbarMode}
            commandPaletteMode={commandPaletteMode}
            showGameArtBackdrop={showGameArtBackdrop}
            showCardBadges={showCardBadges}
            showNavbarNowPlaying={showNavbarNowPlaying}
            sidebarPosition={sidebarPosition}
            interfaceVisibility={interfaceVisibility}
            landingPage={landingPage}
            navTabItems={navTabItems}
            navButtonItems={navButtonItems}
            sidebarItems={sidebarItems}
            detailSectionItems={detailSectionItems}
            pageItems={pageItems}
            highlightedId={highlightedId}
            onHoverItem={setHighlightedId}
            onSetUiScale={setUiScale}
            onSetUiDensityMode={setUiDensityMode}
            onSetNavbarMode={setNavbarMode}
            onSetCommandPaletteMode={setCommandPaletteMode}
            onSetShowGameArtBackdrop={setShowGameArtBackdrop}
            onSetShowCardBadges={setShowCardBadges}
            onSetShowNavbarNowPlaying={setShowNavbarNowPlaying}
            onSetSidebarPosition={setSidebarPosition}
            onToggleGlobalItem={toggleGlobalItem}
            onToggleSidebarSection={toggleSidebarSection}
            onToggleDetailSection={toggleDetailSection}
            onTogglePageItem={togglePageItem}
            onReorderNavTabs={handleReorderNavTabs}
            onReorderNavButtons={handleReorderNavButtons}
            onReorderPageItems={handleReorderPageItems}
            onResetPage={resetPage}
            onResetGroup={resetGroup}
            onBatchToggleGroup={batchToggleGroup}
            onSetLandingPage={(pageKey) => setLandingPage(pageKey as LandingPage)}
          />
        </section>
      </div>
    </section>
  );
}
