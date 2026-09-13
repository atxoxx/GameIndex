import { useCallback, useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Info,
  Layout,
  LayoutGrid,
  LayoutList,
  LayoutTemplate,
  List,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import {
  DEFAULT_NAVBAR_TAB_ORDER,
  useSettings,
  type DetailSectionKey,
  type InterfaceItemKey,
} from "../../context/SettingsContext";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { NAV_BUTTON_ITEMS, NAV_TAB_ITEMS, moveKey, sortByOrder } from "./interfaceItems";
import { useOrderDrag } from "./useOrderDrag";
import LayoutEditorModal from "./LayoutEditorModal";
import { playActionSound } from "../../utils/soundEffects";
import "./InterfaceTab.css";

/**
 * The Interface tab is a single view. Everything it configures — layout
 * preferences, navbar tabs/buttons, card badges, page widgets and detail
 * sections — is stacked under one "Layout" heading, so nothing hides behind
 * a sub-navigation layer. The catalog section ids below stay in place as
 * deep-link targets: SettingsPage's useSectionScroll flashes and scrolls to
 * `?section=<id>` on mount.
 */
const SUBTAB_LABEL_KEY = "settings.interface.subtabLayout";

interface ItemDef {
  key: InterfaceItemKey;
  labelKey: string;
  /** Optional leading glyph — used by the badge / widget toggle groups. */
  icon?: LucideIcon;
}

/** Granular card-badge toggles. The first four refine the master
 *  "Show Card Badges" switch; the last two are independent overlays. */
const BADGE_ITEMS: ItemDef[] = [
  { key: "badgePlatform", labelKey: "settings.interface.badgePlatform" },
  { key: "badgePlaytime", labelKey: "settings.interface.badgePlaytime" },
  { key: "badgeInstall", labelKey: "settings.interface.badgeInstall" },
  { key: "badgeRating", labelKey: "settings.interface.badgeRating" },
  { key: "badgeCrackwatch", labelKey: "settings.interface.badgeCrackwatch" },
  { key: "badgeCompare", labelKey: "settings.interface.badgeCompare" },
];

/** Library-card badge keys that respect the "Show Card Badges" master. */
const MASTER_GATED_BADGES = new Set<InterfaceItemKey>([
  "badgePlatform",
  "badgePlaytime",
  "badgeInstall",
  "badgeRating",
]);

/** Per-page widgets (KPI cards, filter bars, sub-tabs, hero, dashboards). */
const WIDGET_ITEMS: ItemDef[] = [
  { key: "widgetKpis", labelKey: "settings.interface.widgetKpis" },
  { key: "widgetFilters", labelKey: "settings.interface.widgetFilters" },
  { key: "widgetSubtabs", labelKey: "settings.interface.widgetSubtabs" },
  { key: "widgetHero", labelKey: "settings.interface.widgetHeroCollage" },
  { key: "widgetDashboard", labelKey: "settings.interface.widgetDashboard" },
];

function ItemToggleGroup({
  items,
  getDisabled,
}: {
  items: ItemDef[];
  getDisabled?: (key: InterfaceItemKey) => boolean;
}) {
  const { t } = useLanguage();
  const { interfaceVisibility, setInterfaceVisibility, uiSoundEnabled } =
    useSettings();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {items.map((item) => (
        <SettingsToggleCard
          key={item.key}
          title={t(item.labelKey)}
          checked={interfaceVisibility[item.key]}
          disabled={getDisabled?.(item.key) ?? false}
          onChange={(checked) => {
            setInterfaceVisibility(item.key, checked);
            if (uiSoundEnabled) playActionSound();
          }}
        />
      ))}
    </div>
  );
}

const columnGap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-md)",
};

function LayoutPanel() {
  const {
    uiScale,
    setUiScale,
    uiDensityMode,
    setUiDensityMode,
    navbarMode,
    setNavbarMode,
    commandPaletteMode,
    setCommandPaletteMode,
    showGameArtBackdrop,
    setShowGameArtBackdrop,
    uiSoundEnabled,
  } = useSettings();
  const { t } = useLanguage();

  return (
    <div className="interface-panel" role="region">
      <SettingsSection
        id="interface-layout"
        icon={<Layout className="settings-section-icon" />}
        title={t("settings.appearance.interfaceTitle")}
        desc={t("settings.appearance.interfaceDesc")}
      >
        <div style={columnGap}>
          {/* UI Scale Presets */}
          <div
            className="settings-row"
            style={{
              padding: "var(--space-md) var(--space-lg)",
              background: "var(--color-bg-secondary)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                gap: "var(--space-md)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontWeight: "var(--font-weight-semibold)",
                    color: "var(--color-text-primary)",
                    fontSize: "var(--font-size-md)",
                  }}
                >
                  {t("settings.appearance.uiScaleTitle")}
                </div>
                <div
                  style={{
                    fontSize: "var(--font-size-sm)",
                    color: "var(--color-text-secondary)",
                    marginTop: "2px",
                  }}
                >
                  {t("settings.appearance.uiScaleDesc")}
                </div>
              </div>
              <select
                value={uiScale}
                onChange={(e) => {
                  setUiScale(e.target.value as never);
                  if (uiSoundEnabled) playActionSound();
                }}
                style={{
                  minWidth: "160px",
                  background: "var(--color-bg-tertiary)",
                  color: "var(--color-text-primary)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "6px 12px",
                  fontSize: "var(--font-size-sm)",
                  fontWeight: "var(--font-weight-medium)",
                  cursor: "pointer",
                }}
              >
                <option value="auto">{t("settings.appearance.uiScaleAuto")}</option>
                <option value="85">{t("settings.appearance.uiScale85")}</option>
                <option value="100">{t("settings.appearance.uiScale100")}</option>
                <option value="110">{t("settings.appearance.uiScale110")}</option>
                <option value="125">{t("settings.appearance.uiScale125")}</option>
                <option value="150">{t("settings.appearance.uiScale150")}</option>
                <option value="175">{t("settings.appearance.uiScale175")}</option>
                <option value="200">{t("settings.appearance.uiScale200")}</option>
              </select>
            </div>
          </div>

          {/* Simple / Complete UI for all pages */}
          <SettingsToggleCard
            title={t("settings.appearance.simpleUiTitle")}
            desc={t("settings.appearance.simpleUiDesc")}
            checked={uiDensityMode === "simple"}
            onChange={(checked) => {
              setUiDensityMode(checked ? "simple" : "complete");
              if (uiSoundEnabled) playActionSound();
            }}
          />

          {/* Full or Compact Navbar */}
          <SettingsToggleCard
            title={t("settings.appearance.navbarCompactTitle")}
            desc={t("settings.appearance.navbarCompactDesc")}
            checked={navbarMode === "compact"}
            onChange={(checked) => {
              setNavbarMode(checked ? "compact" : "full");
              if (uiSoundEnabled) playActionSound();
            }}
          />

          {/* Simple / Full Command Palette */}
          <SettingsToggleCard
            title={t("settings.appearance.cmdPaletteSimpleTitle")}
            desc={t("settings.appearance.cmdPaletteSimpleDesc")}
            checked={commandPaletteMode === "simple"}
            onChange={(checked) => {
              setCommandPaletteMode(checked ? "simple" : "full");
              if (uiSoundEnabled) playActionSound();
            }}
          />

          {/* Dynamic Game Art Backdrops */}
          <SettingsToggleCard
            title={t("settings.appearance.artBackdropTitle")}
            desc={t("settings.appearance.artBackdropDesc")}
            checked={showGameArtBackdrop}
            onChange={(checked) => {
              setShowGameArtBackdrop(checked);
              if (uiSoundEnabled) playActionSound();
            }}
          />
        </div>
      </SettingsSection>
    </div>
  );
}

/**
 * Combined visibility + reordering list for the top navbar tabs. Each row
 * owns its checkbox, drag handle and arrow controls so show/hide and order
 * live in one place. The first visible rows stay pinned to the bar in
 * Compact mode, so the list doubles as the "which tabs get promoted"
 * control.
 */
function NavTabOrderList() {
  const { t } = useLanguage();
  const {
    navbarTabOrder,
    setNavbarTabOrder,
    interfaceVisibility,
    setInterfaceVisibility,
    uiSoundEnabled,
  } = useSettings();
  const orderedItems = useMemo(
    () => sortByOrder(NAV_TAB_ITEMS, navbarTabOrder),
    [navbarTabOrder],
  );

  const move = useCallback(
    (from: number, to: number) => {
      setNavbarTabOrder(moveKey(orderedItems.map((item) => item.key), from, to));
      if (uiSoundEnabled) playActionSound();
    },
    [orderedItems, setNavbarTabOrder, uiSoundEnabled],
  );

  // Pointer-driven reordering (see useOrderDrag for why not HTML5 DnD).
  const { containerRef, dragIndex, overIndex, startDrag } = useOrderDrag(move);

  return (
    <div style={columnGap}>
      <p className="nav-order-note">{t("settings.interface.tabOrderDesc")}</p>
      <div className="nav-order-list" role="list" ref={containerRef}>
        {orderedItems.map((item, index) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          const visible = interfaceVisibility[item.key];
          return (
            <div
              key={item.key}
              role="listitem"
              data-order-index={index}
              className={`nav-order-row${dragIndex === index ? " is-dragging" : ""}${
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? " is-drop-target"
                  : ""
              }${visible ? "" : " is-hidden-tab"}`}
            >
              <span
                className="nav-order-handle"
                title={t("settings.interface.tabOrderDragHandle")}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  startDrag(index);
                }}
              >
                <GripVertical size={15} aria-hidden="true" />
              </span>
              {Icon && (
                <Icon className="nav-order-icon" size={16} aria-hidden="true" />
              )}
              <span className="nav-order-label">{label}</span>
              {!visible && (
                <span className="nav-order-hidden">
                  {t("settings.interface.tabOrderHidden")}
                </span>
              )}
              <div className="nav-order-buttons">
                <button
                  type="button"
                  className="nav-order-btn"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={t("settings.interface.tabOrderMoveUp")}
                  title={t("settings.interface.tabOrderMoveUp")}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="nav-order-btn"
                  onClick={() => move(index, index + 1)}
                  disabled={index === orderedItems.length - 1}
                  aria-label={t("settings.interface.tabOrderMoveDown")}
                  title={t("settings.interface.tabOrderMoveDown")}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </div>
              <label className="settings-checkbox-label nav-order-toggle">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(e) => {
                    setInterfaceVisibility(item.key, e.target.checked);
                    if (uiSoundEnabled) playActionSound();
                  }}
                  aria-label={label}
                />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NavTabsPanel() {
  const { t } = useLanguage();
  const { setNavbarTabOrder, uiSoundEnabled } = useSettings();
  return (
    <div className="interface-panel" role="region">
      <SettingsSection
        id="interface-nav-tabs"
        icon={<LayoutList className="settings-section-icon" />}
        title={t("settings.section.interfaceNavTabs")}
        desc={t("settings.section.interfaceNavTabs.desc")}
        actions={
          <button
            type="button"
            className="nav-order-reset"
            onClick={() => {
              setNavbarTabOrder(DEFAULT_NAVBAR_TAB_ORDER);
              if (uiSoundEnabled) playActionSound();
            }}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {t("settings.interface.tabOrderReset")}
          </button>
        }
      >
        <NavTabOrderList />
      </SettingsSection>
    </div>
  );
}

function NavButtonsPanel() {
  const { t } = useLanguage();
  const { showNavbarNowPlaying, setShowNavbarNowPlaying, uiSoundEnabled } =
    useSettings();
  return (
    <div className="interface-panel" role="region">
      <SettingsSection
        id="interface-nav-buttons"
        icon={<SlidersHorizontal className="settings-section-icon" />}
        title={t("settings.section.interfaceNavButtons")}
        desc={t("settings.section.interfaceNavButtons.desc")}
      >
        <div style={columnGap}>
          <ItemToggleGroup items={NAV_BUTTON_ITEMS} />

          {/* Navbar Now Playing Indicator */}
          <SettingsToggleCard
            title={t("settings.appearance.navbarNowPlayingTitle")}
            desc={t("settings.appearance.navbarNowPlayingDesc")}
            checked={showNavbarNowPlaying}
            onChange={(checked) => {
              setShowNavbarNowPlaying(checked);
              if (uiSoundEnabled) playActionSound();
            }}
          />
        </div>
      </SettingsSection>
    </div>
  );
}

function BadgesPanel() {
  const { t } = useLanguage();
  const { showCardBadges, setShowCardBadges, uiSoundEnabled } = useSettings();
  return (
    <div className="interface-panel" role="region">
      <SettingsSection
        id="interface-badges"
        icon={<BadgeCheck className="settings-section-icon" />}
        title={t("settings.section.interfaceBadges")}
        desc={t("settings.section.interfaceBadges.desc")}
      >
        <div style={columnGap}>
          {/* Show Card Badges — master switch for the library-card badges */}
          <SettingsToggleCard
            title={t("settings.appearance.cardBadgesTitle")}
            desc={t("settings.appearance.cardBadgesDesc")}
            checked={showCardBadges}
            onChange={(checked) => {
              setShowCardBadges(checked);
              if (uiSoundEnabled) playActionSound();
            }}
          />

          <ItemToggleGroup
            items={BADGE_ITEMS}
            getDisabled={(key) => MASTER_GATED_BADGES.has(key) && !showCardBadges}
          />
        </div>
      </SettingsSection>
    </div>
  );
}

function WidgetsPanel() {
  const { t } = useLanguage();
  return (
    <div className="interface-panel" role="region">
      <SettingsSection
        id="interface-widgets"
        icon={<LayoutGrid className="settings-section-icon" />}
        title={t("settings.section.interfaceWidgets")}
        desc={t("settings.section.interfaceWidgets.desc")}
      >
        <ItemToggleGroup items={WIDGET_ITEMS} />
      </SettingsSection>
    </div>
  );
}

function DetailSectionsPanel() {
  const { t } = useLanguage();
  const { detailSectionVisible, setDetailSectionVisible, uiSoundEnabled, showDeckVerified } =
    useSettings();

  // Game & Store detail-page sections that can be individually hidden.
  const detailSections = useMemo(() => {
    const list: {
      key: DetailSectionKey;
      titleKey: string;
      descKey: string;
    }[] = [
      {
        key: "steamFeatures",
        titleKey: "settings.detailSections.steamFeatures.title",
        descKey: "settings.detailSections.steamFeatures.desc",
      },
      {
        key: "systemRequirements",
        titleKey: "settings.detailSections.systemRequirements.title",
        descKey: "settings.detailSections.systemRequirements.desc",
      },
      {
        key: "gameRelations",
        titleKey: "settings.detailSections.gameRelations.title",
        descKey: "settings.detailSections.gameRelations.desc",
      },
      {
        key: "timeToBeat",
        titleKey: "settings.detailSections.timeToBeat.title",
        descKey: "settings.detailSections.timeToBeat.desc",
      },
    ];

    if (showDeckVerified) {
      list.push({
        key: "protonDb",
        titleKey: "settings.detailSections.protonDb.title",
        descKey: "settings.detailSections.protonDb.desc",
      });
    }

    list.push(
      {
        key: "releases",
        titleKey: "settings.detailSections.releases.title",
        descKey: "settings.detailSections.releases.desc",
      },
      {
        key: "reviews",
        titleKey: "settings.detailSections.reviews.title",
        descKey: "settings.detailSections.reviews.desc",
      },
      {
        key: "activity",
        titleKey: "settings.detailSections.activity.title",
        descKey: "settings.detailSections.activity.desc",
      },
      {
        key: "notes",
        titleKey: "settings.detailSections.notes.title",
        descKey: "settings.detailSections.notes.desc",
      },
      {
        key: "achievements",
        titleKey: "settings.detailSections.achievements.title",
        descKey: "settings.detailSections.achievements.desc",
      },
      {
        key: "mods",
        titleKey: "settings.detailSections.mods.title",
        descKey: "settings.detailSections.mods.desc",
      },
      {
        key: "weblinks",
        titleKey: "settings.detailSections.weblinks.title",
        descKey: "settings.detailSections.weblinks.desc",
      },
      {
        key: "news",
        titleKey: "settings.detailSections.news.title",
        descKey: "settings.detailSections.news.desc",
      },
    );

    return list;
  }, [showDeckVerified]);

  return (
    <div className="interface-panel" role="region">
      <SettingsSection
        id="interface-detail-sections"
        icon={<List className="settings-section-icon" />}
        title={t("settings.detailSections.title")}
        desc={t("settings.detailSections.desc")}
      >
        <div style={columnGap}>
          {detailSections.map((section) => (
            <SettingsToggleCard
              key={section.key}
              title={t(section.titleKey)}
              desc={t(section.descKey)}
              checked={detailSectionVisible[section.key]}
              onChange={(checked) => {
                setDetailSectionVisible(section.key, checked);
                if (uiSoundEnabled) playActionSound();
              }}
            />
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

export default function InterfaceTab() {
  const { t } = useLanguage();
  const { isSimpleUi, uiSoundEnabled } = useSettings();

  const [studioOpen, setStudioOpen] = useState(false);

  return (
    <div className="interface-tab-shell">
      {/* Layout Studio entry point — the visual, drag-and-drop way to hide and
       *  rearrange the app chrome, with a live preview of the shell. */}
      <div className="interface-studio-bar">
        <LayoutTemplate className="interface-studio-bar__icon" size={20} aria-hidden="true" />
        <div className="interface-studio-bar__text">
          <span className="interface-studio-bar__title">
            {t("settings.interface.studioTitle")}
          </span>
          <span className="interface-studio-bar__desc">
            {t("settings.interface.studioOpenDesc")}
          </span>
        </div>
        <button
          type="button"
          className="interface-studio-launch"
          onClick={() => {
            if (uiSoundEnabled) playActionSound();
            setStudioOpen(true);
          }}
        >
          {t("settings.interface.studioOpen")}
        </button>
      </div>

      {/* Master note — Simple UI mode hides everything in this tab at once */}
      <div
        className="settings-behavior-card"
        style={{
          display: "flex",
          gap: "var(--space-md)",
          alignItems: "flex-start",
          padding: "var(--space-md) var(--space-lg)",
          borderLeft: "3px solid var(--color-accent)",
        }}
      >
        <Info size={16} className="settings-section-icon" style={{ marginTop: 2, flexShrink: 0 }} />
        <span className="settings-checkbox-desc" style={{ margin: 0 }}>
          {isSimpleUi
            ? t("settings.interface.masterNoteSimple")
            : t("settings.interface.masterNote")}
        </span>
      </div>

      {/* ── Single-section navigation bar ───────────────────────────────── */}
      <nav
        className="interface-subtab-bar"
        aria-label={t("settings.interface.subtabNav")}
      >
        <button
          type="button"
          className="interface-subtab-btn active"
          aria-current="page"
        >
          {t(SUBTAB_LABEL_KEY)}
        </button>
      </nav>

      <LayoutPanel />
      <NavTabsPanel />
      <NavButtonsPanel />
      <BadgesPanel />
      <WidgetsPanel />
      <DetailSectionsPanel />

      <LayoutEditorModal open={studioOpen} onClose={() => setStudioOpen(false)} />
    </div>
  );
}