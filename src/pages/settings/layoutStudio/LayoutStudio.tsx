import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleHelp,
  Crosshair,
  Laptop,
  LayoutTemplate,
  Monitor,
  RotateCcw,
  Smartphone,
  Tv,
  Undo2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useShelves } from "../../../context/ShelfContext";
import { useToast } from "../../../context/ToastContext";
import { usePersistedState } from "../../../hooks/usePersistedState";
import {
  useLayoutSettings,
  useSettings,
  type DetailSectionKey,
  type InterfaceItemKey,
} from "../../../context/SettingsContext";
import {
  DEFAULT_DETAIL_TAB_ORDER,
  DEFAULT_PAGE_ITEM_ORDER,
  DETAIL_TAB_LABEL_KEY,
  DETAIL_TOP_BAR,
  DETAIL_TOP_BAR_LABEL_KEY,
  DEFAULT_DETAIL_TOP_BAR_ORDER,
  HERO_ELEMENTS,
  HERO_ELEMENT_LABEL_KEY,
  INTERFACE_PAGES,
  SIDEBAR_SECTIONS,
  WIDGET_LABEL_KEY,
  interfacePageDef,
  isDetailSectionKeyAvailable,
  isDetailTopBarKeyAvailable,
  resolveDetailTabOrder,
  resolveDetailTopBarHidden,
  resolveDetailTopBarOrder,
  resolveHeroElementOrder,
  type DetailTabKey,
  type DetailTabScope,
  type DetailTopBarKey,
  type HeroElementKey,
  type InterfacePageKey,
  type PageWidgetKey,
  type SidebarSectionKey,
} from "../../../context/interfaceLayout";
import {
  BADGE_ITEMS,
  DETAIL_TOP_BAR_ICONS,
  NAV_BUTTON_ITEMS,
  NAV_TAB_ITEMS,
  WIDGET_ITEMS,
  buildDetailSectionItems,
  moveKey,
  sortByOrder,
} from "../interfaceItems";
import { playActionSound } from "../../../utils/soundEffects";
import { StudioPresetsBar } from "./StudioPresetsBar";
import { StudioRail } from "./StudioRail";
import { StudioInspector } from "./StudioInspector";
import { StudioGuide } from "./StudioGuide";
import { STUDIO_DETAIL_TAB_ICON, STUDIO_HERO_ELEMENT_ICON } from "./studioIcons";
import { WIDGET_ICON } from "./widgetIcons";
import { StudioPreview } from "./StudioPreview";
import { getDefaultLayoutSnapshot, isItemModifiedFromDefault } from "./layoutPresets";
import { countLayoutChanges } from "./layoutDiff";
import { useLayoutHistory } from "./useLayoutHistory";
import {
  buildStudioSearchIndex,
  studioScopeLabel,
  type StudioSearchEntry,
} from "./studioScopes";
import type {
  LayoutPreset,
  LayoutSnapshot,
  OrderListItem,
  ViewportPreset,
} from "./types";
import "../LayoutStudio.css";
import "./StudioWorkspace.css";

const GUIDE_DISMISSED_KEY = "gamelib.settings.layout_studio.guide_dismissed_v1";

const DETAIL_SCOPES: DetailTabScope[] = ["game", "store"];

/**
 * The interface page key → the detail scope it edits. The two detail pages
 * (`game` = library game, `storeGame` = store game) share the detail-tab /
 * hero-element / top-bar lanes keyed by scope; every other page has none.
 */
function detailScopeForPage(page: InterfacePageKey): DetailTabScope | null {
  if (page === "game") return "game";
  if (page === "storeGame") return "store";
  return null;
}

function readGuideDismissed(): boolean {
  try {
    return localStorage.getItem(GUIDE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function LayoutStudio() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const {
    navbarTabOrder,
    setNavbarTabOrder,
    navbarButtonOrder,
    setNavbarButtonOrder,
    interfaceVisibility,
    setInterfaceVisibility,
    sidebarSectionVisible,
    setSidebarSectionVisible,
    pageItemVisible,
    setPageItemVisible,
    pageItemOrder,
    setPageItemOrder,
    detailSectionVisible,
    setDetailSectionVisible,
    detailTabOrder,
    setDetailTabOrder,
    detailTopBarOrder,
    setDetailTopBarOrder,
    detailTopBarVisibility,
    setDetailTopBarVisible,
    heroElementOrder,
    setHeroElementOrder,
    heroElementVisibility,
    setHeroElementVisible,
    heroGridLayout,
    setHeroGridLayout,
    resetHeroGridLayout,
  } = useLayoutSettings();
  const {
    uiSoundEnabled,
    sidebarPosition,
    setSidebarPosition,
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
    showHeroTilt,
    setShowHeroTilt,
    showHeroBackdropControls,
    setShowHeroBackdropControls,
    showHeroInteractiveControls,
    setShowHeroInteractiveControls,
    showFullLinuxUi,
    showDeckVerified,
    landingPage,
  } = useSettings();
  const { enabled: shelvesEnabled, setEnabled: setShelvesEnabled } = useShelves();

  const [activePage, setActivePage] = usePersistedState<InterfacePageKey>(
    "gamelib.settings.layout_studio.page_v1",
    "global",
    INTERFACE_PAGES.map((page) => page.key),
  );
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** The element a search hit or an inspect click sent the user to. Unlike the
   *  transient flash, it keeps the inspector row lit and its group open until
   *  the user moves to another place. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(
    null,
  );
  const [guideDismissed, setGuideDismissed] = useState(readGuideDismissed);
  const [viewport, setViewport] = usePersistedState<ViewportPreset>(
    "gamelib.settings.layout_studio.viewport_v1",
    "desktop",
    ["desktop", "handheld", "ultrawide", "compact"],
  );
  const [inspectMode, setInspectMode] = useState(false);
  const highlightTimer = useRef<number | null>(null);

  const playSound = useCallback(() => {
    if (uiSoundEnabled) playActionSound();
  }, [uiSoundEnabled]);

  /** Flash one element in both the list and the preview. */
  const flashHighlight = useCallback((id: string) => {
    setHighlightedId(id);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedId(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    },
    [],
  );

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

  // ── Detail tabs & hero elements (game + store) ─────────────────────────────
  const activeDetailScope = useMemo<DetailTabScope | null>(
    () => detailScopeForPage(activePage),
    [activePage],
  );

  const detailTabItems = useMemo<OrderListItem[]>(() => {
    if (!activeDetailScope) return [];
    return resolveDetailTabOrder(detailTabOrder, activeDetailScope).map((key) => {
      const hidden =
        key !== "overview" && detailSectionVisible[key as DetailSectionKey] === false;
      return {
        id: key,
        label: t(DETAIL_TAB_LABEL_KEY[key]),
        icon: STUDIO_DETAIL_TAB_ICON[key],
        hidden,
        isModified: hidden,
      };
    });
  }, [activeDetailScope, detailTabOrder, detailSectionVisible, t]);

  const heroElementItems = useMemo<OrderListItem[]>(() => {
    if (!activeDetailScope) return [];
    const hiddenMap = heroElementVisibility[activeDetailScope] ?? {};
    return resolveHeroElementOrder(heroElementOrder, activeDetailScope).map((key) => ({
      id: key,
      label: t(HERO_ELEMENT_LABEL_KEY[key]),
      icon: STUDIO_HERO_ELEMENT_ICON[key],
      hidden: hiddenMap[key] === false,
      isModified: hiddenMap[key] === false,
    }));
  }, [activeDetailScope, heroElementOrder, heroElementVisibility, t]);

  const detailTopBarItems = useMemo<OrderListItem[]>(() => {
    if (!activeDetailScope) return [];
    const labels = DETAIL_TOP_BAR_LABEL_KEY[activeDetailScope];
    const hiddenMap = resolveDetailTopBarHidden(detailTopBarVisibility, activeDetailScope);
    return resolveDetailTopBarOrder(detailTopBarOrder, activeDetailScope)
      // Linux-only buttons (Wine Logs, Compatibility) are not offered on hosts
      // that can't render them, so the studio never advertises a no-op chip.
      .filter((key) => isDetailTopBarKeyAvailable(key, { showFullLinuxUi }))
      .map((key) => ({
        id: key,
        // Every shipped key has a label for its scope; the fallback just keeps
        // a future key from rendering blank.
        label: t(labels[key] ?? key),
        icon: DETAIL_TOP_BAR_ICONS[key],
        hidden: hiddenMap[key] === false,
        isModified: hiddenMap[key] === false,
      }));
  }, [activeDetailScope, detailTopBarOrder, detailTopBarVisibility, showFullLinuxUi, t]);

  /** Every detail section this host can actually render. Deck-only sections
   *  (ProtonDB) drop out unless the Deck-verified capability is on, so the
   *  hidden count and the reset loops can't act on something invisible. */
  const availableDetailSectionKeys = useMemo<DetailSectionKey[]>(
    () =>
      buildDetailSectionItems(true)
        .map((section) => section.key)
        .filter((key) => isDetailSectionKeyAvailable(key, { showDeckVerified })),
    [showDeckVerified],
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
      icon: WIDGET_ICON[key] ?? LayoutTemplate,
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
      showHeroTilt,
      showHeroBackdropControls,
      showHeroInteractiveControls,
      detailSectionVisible,
      detailTabOrder,
      detailTopBarOrder,
      detailTopBarVisibility,
      heroElementOrder,
      heroElementVisibility,
      heroGridLayout,
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
      showHeroTilt,
      showHeroBackdropControls,
      showHeroInteractiveControls,
      detailSectionVisible,
      detailTabOrder,
      detailTopBarOrder,
      detailTopBarVisibility,
      heroElementOrder,
      heroElementVisibility,
      heroGridLayout,
      uiScale,
    ],
  );

  const changeCount = useMemo(
    () => countLayoutChanges(currentSnapshot, defaultSnapshot),
    [currentSnapshot, defaultSnapshot],
  );

  const searchIndex = useMemo(
    () => buildStudioSearchIndex({ t, showDeckVerified, showFullLinuxUi }),
    [t, showDeckVerified, showFullLinuxUi],
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
        moveKey(pageItems.map((item) => item.id) as PageWidgetKey[], from, to),
      );
      playSound();
    },
    [activePage, pageItems, setPageItemOrder, playSound],
  );

  const handleReorderDetailTabs = useCallback(
    (from: number, to: number) => {
      if (!activeDetailScope) return;
      setDetailTabOrder(
        activeDetailScope,
        moveKey(detailTabItems.map((item) => item.id) as DetailTabKey[], from, to),
      );
      playSound();
    },
    [activeDetailScope, detailTabItems, setDetailTabOrder, playSound],
  );

  const handleReorderHeroElements = useCallback(
    (from: number, to: number) => {
      if (!activeDetailScope) return;
      setHeroElementOrder(
        activeDetailScope,
        moveKey(heroElementItems.map((item) => item.id) as HeroElementKey[], from, to),
      );
      playSound();
    },
    [activeDetailScope, heroElementItems, setHeroElementOrder, playSound],
  );

  const handleReorderDetailTopBar = useCallback(
    (from: number, to: number) => {
      if (!activeDetailScope) return;
      // The list only renders available keys, so translate its indices back
      // into the *full* order before moving. That keeps a gated key (Wine Logs
      // on Windows) exactly where the user left it instead of letting the
      // append-only normalizer shuffle it to the end.
      const fullOrder = resolveDetailTopBarOrder(detailTopBarOrder, activeDetailScope);
      const fromKey = detailTopBarItems[from]?.id as DetailTopBarKey | undefined;
      const toKey = detailTopBarItems[to]?.id as DetailTopBarKey | undefined;
      if (!fromKey || !toKey) return;
      setDetailTopBarOrder(
        activeDetailScope,
        moveKey(fullOrder, fullOrder.indexOf(fromKey), fullOrder.indexOf(toKey)),
      );
      playSound();
    },
    [activeDetailScope, detailTopBarItems, detailTopBarOrder, setDetailTopBarOrder, playSound],
  );

  // ── Toggle Handlers ───────────────────────────────────────────────────────
  const toggleDetailTab = useCallback(
    (id: string, hidden: boolean) => {
      if (!activeDetailScope) return;
      const key = id as DetailTabKey;
      // `overview` has no detail-section key and is always visible.
      if (key === "overview") return;
      setDetailSectionVisible(key as DetailSectionKey, !hidden);
      playSound();
    },
    [activeDetailScope, setDetailSectionVisible, playSound],
  );

  const toggleHeroElement = useCallback(
    (id: string, hidden: boolean) => {
      if (!activeDetailScope) return;
      setHeroElementVisible(activeDetailScope, id as HeroElementKey, !hidden);
      playSound();
    },
    [activeDetailScope, setHeroElementVisible, playSound],
  );

  const toggleDetailTopBar = useCallback(
    (id: string, hidden: boolean) => {
      if (!activeDetailScope) return;
      setDetailTopBarVisible(activeDetailScope, id as DetailTopBarKey, !hidden);
      playSound();
    },
    [activeDetailScope, setDetailTopBarVisible, playSound],
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

  // Cards, header and sidebar are edited directly in the preview and in the
  // inspector, so the studio owns these three masters as well.
  const handleToggleCardBadgesMaster = useCallback(() => {
    setShowCardBadges(!showCardBadges);
    playSound();
  }, [showCardBadges, setShowCardBadges, playSound]);

  const handleToggleNowPlaying = useCallback(() => {
    setShowNavbarNowPlaying(!showNavbarNowPlaying);
    playSound();
  }, [showNavbarNowPlaying, setShowNavbarNowPlaying, playSound]);

  const handleToggleSmartShelves = useCallback(() => {
    setShelvesEnabled(!shelvesEnabled);
    playSound();
  }, [shelvesEnabled, setShelvesEnabled, playSound]);

  const handleSetSidebarPosition = useCallback(
    (side: "left" | "right") => {
      setSidebarPosition(side);
      playSound();
    },
    [setSidebarPosition, playSound],
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
      if (typeof snapshot.showHeroTilt === "boolean") {
        setShowHeroTilt(snapshot.showHeroTilt);
      }
      if (typeof snapshot.showHeroBackdropControls === "boolean") {
        setShowHeroBackdropControls(snapshot.showHeroBackdropControls);
      }
      if (typeof snapshot.showHeroInteractiveControls === "boolean") {
        setShowHeroInteractiveControls(snapshot.showHeroInteractiveControls);
      }
      if (snapshot.detailSectionVisible) {
        for (const [k, v] of Object.entries(snapshot.detailSectionVisible)) {
          setDetailSectionVisible(k as DetailSectionKey, v);
        }
      }
      if (snapshot.detailTabOrder) {
        for (const scope of DETAIL_SCOPES) {
          const next = snapshot.detailTabOrder[scope];
          if (next) setDetailTabOrder(scope, next);
        }
      }
      for (const scope of DETAIL_SCOPES) {
        const next = snapshot.detailTopBarOrder?.[scope];
        // A scope with no entry (or a snapshot without the field at all) falls
        // back to the shipped order and nothing hidden.
        if (next) setDetailTopBarOrder(scope, next);
        else setDetailTopBarOrder(scope, DEFAULT_DETAIL_TOP_BAR_ORDER[scope]);

        const hidden = snapshot.detailTopBarVisibility?.[scope] ?? {};
        for (const key of DETAIL_TOP_BAR[scope]) {
          setDetailTopBarVisible(scope, key, hidden[key] !== false);
        }
      }
      if (snapshot.heroElementOrder) {
        for (const scope of DETAIL_SCOPES) {
          const next = snapshot.heroElementOrder[scope];
          if (next) setHeroElementOrder(scope, next);
        }
      }
      if (snapshot.heroElementVisibility) {
        for (const scope of DETAIL_SCOPES) {
          const hidden = snapshot.heroElementVisibility[scope] ?? {};
          for (const key of HERO_ELEMENTS) {
            setHeroElementVisible(scope, key, hidden[key] !== false);
          }
        }
      }
      if (snapshot.heroGridLayout) {
        for (const scope of DETAIL_SCOPES) {
          const next = snapshot.heroGridLayout[scope];
          if (next) setHeroGridLayout(scope, next);
          else resetHeroGridLayout(scope);
        }
      }
      // Per-page order is part of the layout, so presets, imports and undo must
      // restore it too - but only when the snapshot actually names it, so a
      // partial preset never wipes a hand-ordered page. A page absent from the
      // field falls back to the shipped order (the app treats "no entry" and
      // "shipped order" alike).
      if (snapshot.pageItemOrder) {
        for (const page of INTERFACE_PAGES) {
          if (page.key === "global") continue;
          const next = snapshot.pageItemOrder[page.key] ?? DEFAULT_PAGE_ITEM_ORDER[page.key] ?? [];
          const current = pageItemOrder[page.key] ?? DEFAULT_PAGE_ITEM_ORDER[page.key] ?? [];
          if (JSON.stringify(next) !== JSON.stringify(current)) {
            setPageItemOrder(page.key, next);
          }
        }
      }
      // Page visibility is stored OFF-only, so a snapshot without an entry
      // means "visible". Walk the union of current and target entries: a plain
      // loop over the snapshot alone could never switch a hidden block back on.
      // Only an explicit field is treated as authoritative, so a partial preset
      // keeps whatever the user hid by hand.
      if (snapshot.pageItemVisible) {
        const pages = new Set<string>([
          ...Object.keys(pageItemVisible),
          ...Object.keys(snapshot.pageItemVisible),
        ]);
        for (const page of pages) {
          const target = snapshot.pageItemVisible[page as InterfacePageKey] ?? {};
          const current = pageItemVisible[page as InterfacePageKey] ?? {};
          const keys = new Set<string>([...Object.keys(current), ...Object.keys(target)]);
          for (const key of keys) {
            const shouldShow = target[key as PageWidgetKey] !== false;
            const isHidden = current[key as PageWidgetKey] === false;
            if (isHidden !== !shouldShow) {
              setPageItemVisible(page as InterfacePageKey, key as PageWidgetKey, shouldShow);
            }
          }
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
      setShowHeroTilt,
      setShowHeroBackdropControls,
      setShowHeroInteractiveControls,
      setDetailSectionVisible,
      setDetailTabOrder,
      setDetailTopBarOrder,
      setDetailTopBarVisible,
      setHeroElementOrder,
      setHeroElementVisible,
      setHeroGridLayout,
      resetHeroGridLayout,
      pageItemVisible,
      setPageItemVisible,
      pageItemOrder,
      setPageItemOrder,
      setUiScale,
      playSound,
    ],
  );

  const history = useLayoutHistory(currentSnapshot, applySnapshot);

  const dismissGuide = useCallback(() => {
    setGuideDismissed(true);
    try {
      localStorage.setItem(GUIDE_DISMISSED_KEY, "1");
    } catch {
      // A blocked storage write only costs the dismissal across restarts.
    }
  }, []);

  const handleApplyPreset = useCallback(
    (preset: LayoutPreset) => {
      applySnapshot(preset.snapshot);
      const name = preset.customName || t(preset.nameKey);
      showToast(t("settings.studio.presetAppliedToast", { name }), "success");
      dismissGuide();
    },
    [applySnapshot, dismissGuide, showToast, t],
  );

  const handleUndo = useCallback(() => {
    if (!history.undo()) {
      showToast(t("settings.studio.undoEmpty"), "info");
      return;
    }
    playSound();
    showToast(t("settings.studio.undoToast"), "info");
  }, [history, playSound, showToast, t]);

  // ── Resets ────────────────────────────────────────────────────────────────
  const resetPage = useCallback(
    (page: InterfacePageKey) => {
      if (page === "global") return;
      const def = interfacePageDef(page);
      for (const key of def?.items ?? []) setPageItemVisible(page, key, true);
      setPageItemOrder(page, DEFAULT_PAGE_ITEM_ORDER[page] ?? []);
      const detailScope = detailScopeForPage(page);
      if (detailScope) {
        setDetailTabOrder(detailScope, DEFAULT_DETAIL_TAB_ORDER[detailScope]);
        setDetailTopBarOrder(detailScope, DEFAULT_DETAIL_TOP_BAR_ORDER[detailScope]);
        for (const key of DETAIL_TOP_BAR[detailScope]) {
          setDetailTopBarVisible(detailScope, key, true);
        }
        setHeroElementOrder(detailScope, HERO_ELEMENTS);
        for (const key of HERO_ELEMENTS) setHeroElementVisible(detailScope, key, true);
        resetHeroGridLayout(detailScope);
        for (const key of availableDetailSectionKeys) {
          setDetailSectionVisible(key, true);
        }
        setShowHeroTilt(true);
        setShowHeroBackdropControls(true);
        setShowHeroInteractiveControls(true);
      }
      playSound();
      showToast(t("settings.studio.pageResetToast"), "info");
    },
    [
      setPageItemVisible,
      setPageItemOrder,
      setDetailTabOrder,
      setDetailTopBarOrder,
      setDetailTopBarVisible,
      setHeroElementOrder,
      setHeroElementVisible,
      resetHeroGridLayout,
      setDetailSectionVisible,
      setShowHeroTilt,
      setShowHeroBackdropControls,
      setShowHeroInteractiveControls,
      availableDetailSectionKeys,
      playSound,
      showToast,
      t,
    ],
  );

  const resetEverything = useCallback(() => {
    // The shipped snapshot carries every key, including the OFF-only maps, so
    // one apply restores the whole layout — and now honours the real default
    // for nav items (the Downloads tab is hidden out of the box) instead of
    // switching everything on.
    applySnapshot(defaultSnapshot);
    setShelvesEnabled(true);
    showToast(t("settings.studio.allResetToast"), "info");
  }, [applySnapshot, defaultSnapshot, setShelvesEnabled, showToast, t]);

  // ── Navigation & inspection ───────────────────────────────────────────────
  const handleSelectPage = useCallback((page: InterfacePageKey) => {
    setActivePage(page);
    setHoveredId(null);
    setFocusId(null);
    setSearchQuery("");
  }, []);

  const handleSelectSearchResult = useCallback((entry: StudioSearchEntry) => {
    setActivePage(entry.scope);
    setSearchQuery("");
    setFocusId(entry.id);
    setFocusRequest({ id: entry.id, nonce: Date.now() });
    setHoveredId(null);
  }, []);

  // Scroll the matching inspector row into view after the page has switched.
  // The row can live in a collapsed group that opens in response to the same
  // highlight, so the lookup waits one frame for that render.
  useEffect(() => {
    if (!focusRequest) return;
    flashHighlight(focusRequest.id);
    const timer = window.setTimeout(() => {
      document
        .getElementById(`studio-row-${focusRequest.id}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusRequest, flashHighlight]);

  /** Preview → list: click an element to reveal its row. */
  const handleInspectElement = useCallback(
    (id: string) => {
      setFocusId(id);
      flashHighlight(id);
      window.setTimeout(() => {
        document
          .getElementById(`studio-row-${id}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 80);
    },
    [flashHighlight],
  );

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
      return hiddenItems + hiddenSidebar;
    }
    const entry = pageItemVisible[page];
    const pageHidden = entry
      ? Object.values(entry).filter((visible) => visible === false).length
      : 0;
    if (detailScopeForPage(page)) {
      // Both detail pages share the global section-visibility map, so each
      // page tab reports the same hidden sections its preview shows.
      const hiddenDetailSections = availableDetailSectionKeys.filter(
        (key) => !detailSectionVisible[key],
      ).length;
      return pageHidden + hiddenDetailSections;
    }
    return pageHidden;
  };

  const scopeLabel = studioScopeLabel(activePage, t);
  const effectiveHighlight = highlightedId ?? hoveredId;

  return (
    <section
      className={`studio${!guideDismissed ? " studio--guided" : ""}`}
      id="interface-studio"
      aria-labelledby="layout-studio-title"
    >
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

        <div className="studio-header__meta">
          <span
            className={`studio-changes${changeCount > 0 ? " is-dirty" : ""}`}
            title={t("settings.studio.changesTooltip")}
          >
            {changeCount === 0
              ? t("settings.studio.changesDefault")
              : t("settings.studio.changesCount", { count: changeCount })}
          </span>
        </div>

        <div className="studio-header__actions">
          <button
            type="button"
            className="studio-tool-btn"
            onClick={handleUndo}
            disabled={!history.canUndo}
            title={history.canUndo ? t("settings.studio.undo") : t("settings.studio.undoEmpty")}
          >
            <Undo2 size={13} aria-hidden="true" />
            {t("settings.studio.undo")}
          </button>
          <button
            type="button"
            className="studio-tool-btn studio-tool-btn--icon"
            onClick={() => setGuideDismissed(false)}
            title={t("settings.studio.guideReopen")}
            aria-label={t("settings.studio.guideReopen")}
          >
            <CircleHelp size={15} aria-hidden="true" />
          </button>
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
      </div>

      {/* Presets, save, export & import */}
      <StudioPresetsBar
        currentSnapshot={currentSnapshot}
        onApplyPreset={handleApplyPreset}
        onImportSnapshot={applySnapshot}
      />

      {/* First-run guide: what the three panes do, and the built-in presets */}
      {!guideDismissed && (
        <StudioGuide onApplyPreset={handleApplyPreset} onDismiss={dismissGuide} />
      )}

      <div className="studio-workspace">
        {/* Left: where to edit */}
        <StudioRail
          activePage={activePage}
          hiddenCountForPage={hiddenCountForPage}
          landingPage={landingPage}
          searchIndex={searchIndex}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSelectPage={handleSelectPage}
          onSelectSearchResult={handleSelectSearchResult}
        />

        {/* Centre: live preview */}
        <section className="studio-pane studio-pane--preview">
          <div className="studio-preview-pane-head">
            <h3 className="studio-pane__title">
              {t("settings.interface.studioPreview")}
            </h3>

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

              {activePage !== "global" && (
                <button
                  type="button"
                  className="studio-reset"
                  onClick={() => resetPage(activePage)}
                  title={t("settings.interface.studioResetPage")}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  {t("settings.interface.studioResetPage")}
                </button>
              )}
            </div>
          </div>

          <StudioPreview
            viewport={viewport}
            inspectMode={inspectMode}
            navTabs={navTabItems}
            navButtons={navButtonItems}
            sidebarPosition={sidebarPosition}
            sidebarVisible={sidebarSectionVisible}
            page={activePage}
            pageItems={pageItems}
            detailTabItems={detailTabItems}
            detailTopBarItems={detailTopBarItems}
            heroElementItems={heroElementItems}
            detailScope={activeDetailScope}
            globalVisibility={interfaceVisibility}
            showNowPlaying={showNavbarNowPlaying}
            showCardBadgesMaster={showCardBadges}
            highlightedId={effectiveHighlight}
            onReorderNavTabs={handleReorderNavTabs}
            onReorderNavButtons={handleReorderNavButtons}
            onReorderPageItems={handleReorderPageItems}
            onToggleNavTab={toggleInterfaceItemById}
            onToggleNavButton={toggleInterfaceItemById}
            onTogglePageItem={togglePageItemById}
            onToggleSidebarSection={toggleSidebarSectionById}
            onInspectElement={handleInspectElement}
            onReorderDetailTabs={handleReorderDetailTabs}
            onToggleDetailTab={toggleDetailTab}
            onReorderDetailTopBar={handleReorderDetailTopBar}
            onToggleDetailTopBar={toggleDetailTopBar}
            onReorderHeroElements={handleReorderHeroElements}
            onToggleHeroElement={toggleHeroElement}
            onToggleGlobalItem={toggleInterfaceItemById}
            onToggleCardBadgesMaster={handleToggleCardBadgesMaster}
            onToggleNowPlaying={handleToggleNowPlaying}
            onSetSidebarPosition={handleSetSidebarPosition}
            showHeroTilt={showHeroTilt}
            onToggleHeroTilt={() => {
              setShowHeroTilt(!showHeroTilt);
              playSound();
            }}
            showHeroBackdropControls={showHeroBackdropControls}
            onToggleHeroBackdropControls={() => {
              setShowHeroBackdropControls(!showHeroBackdropControls);
              playSound();
            }}
            showHeroInteractiveControls={showHeroInteractiveControls}
            onToggleHeroInteractiveControls={() => {
              setShowHeroInteractiveControls(!showHeroInteractiveControls);
              playSound();
            }}
            showSmartShelves={shelvesEnabled}
            onToggleSmartShelves={handleToggleSmartShelves}
          />

          <p className="studio-pane__hint">
            {t("settings.studio.previewToolbarHint")} {t("settings.interface.studioPreviewHint")}
          </p>
        </section>

        {/* Right: every element as a labelled switch */}
        <aside className="studio-side">
          <StudioInspector
            key={activePage}
            page={activePage}
            scopeLabel={scopeLabel}
            highlightedId={effectiveHighlight ?? focusId}
            onHoverElement={setHoveredId}
            navTabItems={navTabItems}
            navButtonItems={navButtonItems}
            showNowPlaying={showNavbarNowPlaying}
            onToggleNowPlaying={handleToggleNowPlaying}
            sidebarPosition={sidebarPosition}
            onSetSidebarPosition={handleSetSidebarPosition}
            sidebarSectionVisible={sidebarSectionVisible}
            onToggleSidebarSection={toggleSidebarSectionById}
            showSmartShelves={shelvesEnabled}
            onToggleSmartShelves={handleToggleSmartShelves}
            globalVisibility={interfaceVisibility}
            showCardBadges={showCardBadges}
            onToggleCardBadgesMaster={handleToggleCardBadgesMaster}
            onToggleGlobalItem={toggleInterfaceItemById}
            showHeroTilt={showHeroTilt}
            onToggleHeroTilt={() => {
              setShowHeroTilt(!showHeroTilt);
              playSound();
            }}
            showHeroBackdropControls={showHeroBackdropControls}
            onToggleHeroBackdropControls={() => {
              setShowHeroBackdropControls(!showHeroBackdropControls);
              playSound();
            }}
            showHeroInteractiveControls={showHeroInteractiveControls}
            onToggleHeroInteractiveControls={() => {
              setShowHeroInteractiveControls(!showHeroInteractiveControls);
              playSound();
            }}
            pageItems={pageItems}
            onTogglePageItem={togglePageItemById}
            onMovePageItem={handleReorderPageItems}
            detailTabItems={detailTabItems}
            onToggleDetailTab={toggleDetailTab}
            onMoveDetailTab={handleReorderDetailTabs}
            heroElementItems={heroElementItems}
            onToggleHeroElement={toggleHeroElement}
            onMoveHeroElement={handleReorderHeroElements}
            detailTopBarItems={detailTopBarItems}
            onToggleDetailTopBar={toggleDetailTopBar}
            onMoveDetailTopBar={handleReorderDetailTopBar}
          />
        </aside>
      </div>
    </section>
  );
}
