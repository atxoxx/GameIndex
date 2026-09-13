import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  FileText,
  GalleryHorizontal,
  Gamepad2,
  Globe,
  HardDrive,
  Heart,
  Home,
  Laptop,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  List,
  type LucideIcon,
  MessageSquare,
  Monitor,
  MonitorPlay,
  Newspaper,
  PlayCircle,
  Puzzle,
  RotateCcw,
  Rss,
  Smartphone,
  Star,
  Store,
  Tag,
  Tags,
  Trophy,
  Tv,
  Type,
  UserCheck,
  Users,
  Wallpaper,
  Wrench,
} from "lucide-react";
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
  DEFAULT_DETAIL_TAB_ORDER,
  DEFAULT_PAGE_ITEM_ORDER,
  DETAIL_TAB_LABEL_KEY,
  HERO_ELEMENTS,
  HERO_ELEMENT_LABEL_KEY,
  INTERFACE_PAGES,
  SIDEBAR_SECTIONS,
  WIDGET_LABEL_KEY,
  interfacePageDef,
  resolveDetailTabOrder,
  resolveHeroElementOrder,
  type DetailTabKey,
  type DetailTabScope,
  type HeroElementKey,
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
import { StudioControls, WIDGET_ICON } from "./StudioControls";
import { StudioPresetsBar } from "./StudioPresetsBar";
import { StudioPreview } from "./StudioPreview";
import { getDefaultLayoutSnapshot, isItemModifiedFromDefault } from "./layoutPresets";
import type {
  LayoutPreset,
  LayoutSnapshot,
  OrderListItem,
  StudioGroupKey,
  ViewportPreset,
} from "./types";
import "../LayoutStudio.css";

const PAGE_ICONS: Record<InterfacePageKey, LucideIcon> = {
  global: LayoutTemplate,
  home: Home,
  library: Gamepad2,
  game: MonitorPlay,
  store: Store,
  wishlist: Heart,
  deals: Tag,
  news: Rss,
  activity: Activity,
  achievements: Trophy,
  downloads: Download,
  storage: HardDrive,
  community: Users,
  friends: UserCheck,
  emulators: Monitor,
  mods: Puzzle,
};

const DETAIL_SCOPES: DetailTabScope[] = ["game", "store"];

const DETAIL_TAB_ICON: Record<DetailTabKey, LucideIcon> = {
  overview: LayoutDashboard,
  reviews: MessageSquare,
  activity: Activity,
  notes: FileText,
  achievements: Trophy,
  mods: Wrench,
  weblinks: Globe,
  news: Newspaper,
};

const HERO_ELEMENT_ICON: Record<HeroElementKey, LucideIcon> = {
  background: Wallpaper,
  poster: GalleryHorizontal,
  title: Type,
  meta: List,
  genres: Tags,
  kpis: LayoutGrid,
  actions: PlayCircle,
};

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
    detailTabOrder,
    setDetailTabOrder,
    heroElementOrder,
    setHeroElementOrder,
    heroElementVisibility,
    setHeroElementVisible,
    showDeckVerified,
    landingPage,
    setLandingPage,
  } = useSettings();

  const [activePage, setActivePage] = useState<InterfacePageKey>("global");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportPreset>("desktop");
  const [inspectMode, setInspectMode] = useState(false);
  const pagesNavRef = useRef<HTMLElement>(null);
  const [canScrollPagesLeft, setCanScrollPagesLeft] = useState(false);
  const [canScrollPagesRight, setCanScrollPagesRight] = useState(false);

  const updatePagesScrollButtons = useCallback(() => {
    const el = pagesNavRef.current;
    if (!el) return;
    setCanScrollPagesLeft(el.scrollLeft > 4);
    setCanScrollPagesRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = pagesNavRef.current;
    if (!el) return;
    updatePagesScrollButtons();
    el.addEventListener("scroll", updatePagesScrollButtons, { passive: true });
    window.addEventListener("resize", updatePagesScrollButtons);
    return () => {
      el.removeEventListener("scroll", updatePagesScrollButtons);
      window.removeEventListener("resize", updatePagesScrollButtons);
    };
  }, [updatePagesScrollButtons]);

  useEffect(() => {
    const el = pagesNavRef.current;
    if (!el) return;
    const activeTab = el.querySelector<HTMLElement>(".studio-pages__tab.is-active");
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
    updatePagesScrollButtons();
  }, [activePage, updatePagesScrollButtons]);

  const handlePagesWheel = useCallback((e: React.WheelEvent<HTMLElement>) => {
    if (e.deltaY === 0) return;
    const el = pagesNavRef.current;
    if (!el) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, []);

  const scrollPages = useCallback((direction: "left" | "right") => {
    const el = pagesNavRef.current;
    if (!el) return;
    const amount = 240;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }, []);

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

  // ── Detail tabs & hero elements (game + store) ─────────────────────────────
  const activeDetailScope = useMemo<DetailTabScope | null>(
    () => (activePage === "game" ? "game" : activePage === "store" ? "store" : null),
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
        icon: DETAIL_TAB_ICON[key],
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
      icon: HERO_ELEMENT_ICON[key],
      hidden: hiddenMap[key] === false,
      isModified: hiddenMap[key] === false,
    }));
  }, [activeDetailScope, heroElementOrder, heroElementVisibility, t]);

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
      detailSectionVisible,
      detailTabOrder,
      heroElementOrder,
      heroElementVisibility,
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
      detailTabOrder,
      heroElementOrder,
      heroElementVisibility,
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

  const handleReorderDetailTabs = useCallback(
    (from: number, to: number) => {
      if (!activeDetailScope) return;
      setDetailTabOrder(
        activeDetailScope,
        moveKey(
          detailTabItems.map((item) => item.id) as DetailTabKey[],
          from,
          to,
        ),
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
        moveKey(
          heroElementItems.map((item) => item.id) as HeroElementKey[],
          from,
          to,
        ),
      );
      playSound();
    },
    [activeDetailScope, heroElementItems, setHeroElementOrder, playSound],
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
      if (snapshot.detailTabOrder) {
        for (const scope of DETAIL_SCOPES) {
          const next = snapshot.detailTabOrder[scope];
          if (next) setDetailTabOrder(scope, next);
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
      setDetailTabOrder,
      setHeroElementOrder,
      setHeroElementVisible,
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
      if (page === "game" || page === "store") {
        setDetailTabOrder(page, DEFAULT_DETAIL_TAB_ORDER[page]);
        setHeroElementOrder(page, HERO_ELEMENTS);
        for (const key of HERO_ELEMENTS) setHeroElementVisible(page, key, true);
      }
      if (page === "game") {
        for (const section of buildDetailSectionItems(true)) {
          setDetailSectionVisible(section.key, true);
        }
      }
      playSound();
    },
    [
      setPageItemVisible,
      setPageItemOrder,
      setDetailTabOrder,
      setHeroElementOrder,
      setHeroElementVisible,
      setDetailSectionVisible,
      playSound,
    ],
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
    for (const scope of DETAIL_SCOPES) {
      setDetailTabOrder(scope, DEFAULT_DETAIL_TAB_ORDER[scope]);
      setHeroElementOrder(scope, HERO_ELEMENTS);
      for (const key of HERO_ELEMENTS) setHeroElementVisible(scope, key, true);
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
    setDetailTabOrder,
    setHeroElementOrder,
    setHeroElementVisible,
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
          for (const scope of DETAIL_SCOPES) {
            setDetailTabOrder(scope, DEFAULT_DETAIL_TAB_ORDER[scope]);
            setHeroElementOrder(scope, HERO_ELEMENTS);
            for (const key of HERO_ELEMENTS) setHeroElementVisible(scope, key, true);
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
      setDetailTabOrder,
      setHeroElementOrder,
      setHeroElementVisible,
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
      return hiddenItems + hiddenSidebar;
    }
    const entry = pageItemVisible[page];
    const pageHidden = entry ? Object.values(entry).filter((visible) => visible === false).length : 0;
    if (page === "game") {
      const hiddenDetailSections = buildDetailSectionItems(showDeckVerified).filter(
        (section) => !detailSectionVisible[section.key],
      ).length;
      return pageHidden + hiddenDetailSections;
    }
    return pageHidden;
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
      <div className="studio-pages-bar">
        {canScrollPagesLeft && (
          <button
            type="button"
            className="studio-pages-scroll-btn studio-pages-scroll-btn--left"
            onClick={() => scrollPages("left")}
            aria-label={t("settings.interface.scrollPagesLeft")}
            title={t("settings.interface.scrollPagesLeft")}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
        )}
        <nav
          ref={pagesNavRef}
          className="studio-pages"
          role="tablist"
          aria-label={t("settings.interface.studioPages")}
          onWheel={handlePagesWheel}
        >
          {INTERFACE_PAGES.map((p) => {
            const hiddenCount = hiddenCountForPage(p.key);
            const isActive = p.key === activePage;
            const isLanding = landingPage === p.key;
            const PageIcon = PAGE_ICONS[p.key] ?? LayoutTemplate;
            return (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`studio-pages__tab${isActive ? " is-active" : ""}`}
                onClick={() => setActivePage(p.key)}
              >
                <PageIcon size={14} aria-hidden="true" className="studio-pages__tab-icon" />
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
        {canScrollPagesRight && (
          <button
            type="button"
            className="studio-pages-scroll-btn studio-pages-scroll-btn--right"
            onClick={() => scrollPages("right")}
            aria-label={t("settings.interface.scrollPagesRight")}
            title={t("settings.interface.scrollPagesRight")}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Studio Body: Preview (Left) + Controls (Right) */}
      <div className="studio-body">
        {/* Left Pane: Interactive Live Preview */}
        <section className="studio-pane studio-pane--preview">
          <div className="studio-preview-pane-head">
            <h3 className="studio-pane__title">
              {t("settings.interface.studioPreview")}
            </h3>

            {/* Viewport ratios & Inspect mode toggle outside of preview */}
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
            heroElementItems={heroElementItems}
            detailScope={activeDetailScope}
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
            onReorderDetailTabs={handleReorderDetailTabs}
            onToggleDetailTab={toggleDetailTab}
            onReorderHeroElements={handleReorderHeroElements}
            onToggleHeroElement={toggleHeroElement}
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
