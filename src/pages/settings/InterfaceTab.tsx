import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BadgeCheck,
  Info,
  Layout,
  LayoutGrid,
  LayoutList,
  List,
  SlidersHorizontal,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import {
  useSettings,
  type DetailSectionKey,
  type InterfaceItemKey,
} from "../../context/SettingsContext";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { playActionSound } from "../../utils/soundEffects";
import "./InterfaceTab.css";

type InterfaceSubtab =
  | "layout"
  | "navTabs"
  | "navButtons"
  | "badges"
  | "widgets"
  | "detailSections";

const SUBTABS: { key: InterfaceSubtab; labelKey: string }[] = [
  { key: "layout", labelKey: "settings.interface.subtabLayout" },
  { key: "navTabs", labelKey: "settings.interface.subtabNavTabs" },
  { key: "navButtons", labelKey: "settings.interface.subtabNavButtons" },
  { key: "badges", labelKey: "settings.interface.subtabBadges" },
  { key: "widgets", labelKey: "settings.interface.subtabWidgets" },
  { key: "detailSections", labelKey: "settings.interface.subtabDetails" },
];

/** Catalog section id → subtab, so jump-bar / search deep links land on
 *  the right panel (same pattern as the Compatibility tab). */
const SECTION_TO_SUBTAB: Record<string, InterfaceSubtab> = {
  "interface-layout": "layout",
  "interface-nav-tabs": "navTabs",
  "interface-nav-buttons": "navButtons",
  "interface-badges": "badges",
  "interface-widgets": "widgets",
  "interface-detail-sections": "detailSections",
};

interface ItemDef {
  key: InterfaceItemKey;
  labelKey: string;
}

/** Top navbar tabs — labels reuse the existing `nav.*` keys. */
const NAV_TAB_ITEMS: ItemDef[] = [
  { key: "navHome", labelKey: "nav.home" },
  { key: "navStore", labelKey: "nav.store" },
  { key: "navLibrary", labelKey: "nav.library" },
  { key: "navWishlist", labelKey: "nav.wishlist" },
  { key: "navDeals", labelKey: "nav.deals" },
  { key: "navNews", labelKey: "nav.news" },
  { key: "navEmulators", labelKey: "nav.emulators" },
  { key: "navMods", labelKey: "nav.mods" },
  { key: "navActivity", labelKey: "nav.activity" },
  { key: "navAchievements", labelKey: "nav.achievements" },
  { key: "navStorage", labelKey: "nav.storage" },
  { key: "navCommunity", labelKey: "nav.community" },
  { key: "navFriends", labelKey: "nav.friends" },
];

/** Right-cluster buttons in the top bar. */
const NAV_BUTTON_ITEMS: ItemDef[] = [
  { key: "btnDownloads", labelKey: "settings.interface.btnDownloads" },
  { key: "btnSettings", labelKey: "settings.interface.btnSettings" },
  { key: "btnDocs", labelKey: "settings.interface.btnDocs" },
  { key: "btnBigScreen", labelKey: "settings.interface.btnBigScreen" },
];

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
    <div className="interface-panel" role="tabpanel">
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

function NavTabsPanel() {
  const { t } = useLanguage();
  return (
    <div className="interface-panel" role="tabpanel">
      <SettingsSection
        id="interface-nav-tabs"
        icon={<LayoutList className="settings-section-icon" />}
        title={t("settings.section.interfaceNavTabs")}
        desc={t("settings.section.interfaceNavTabs.desc")}
      >
        <ItemToggleGroup items={NAV_TAB_ITEMS} />
      </SettingsSection>
    </div>
  );
}

function NavButtonsPanel() {
  const { t } = useLanguage();
  const { showNavbarNowPlaying, setShowNavbarNowPlaying, uiSoundEnabled } =
    useSettings();
  return (
    <div className="interface-panel" role="tabpanel">
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
    <div className="interface-panel" role="tabpanel">
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
    <div className="interface-panel" role="tabpanel">
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
    <div className="interface-panel" role="tabpanel">
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
  const { isSimpleUi } = useSettings();
  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");

  const [activeSubtab, setActiveSubtab] = useState<InterfaceSubtab>("layout");

  // Sync active subtab when deep-linked or searched from the command palette.
  useEffect(() => {
    if (sectionParam && SECTION_TO_SUBTAB[sectionParam]) {
      setActiveSubtab(SECTION_TO_SUBTAB[sectionParam]);
    }
  }, [sectionParam]);

  return (
    <div className="interface-tab-shell">
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

      {/* ── Subtab Pill Navigation (scrollable) ─────────────────────────── */}
      <nav className="interface-subtab-bar" aria-label={t("settings.interface.subtabNav")}>
        {SUBTABS.map((sub) => {
          const isActive = activeSubtab === sub.key;
          return (
            <button
              key={sub.key}
              type="button"
              className={`interface-subtab-btn ${isActive ? "active" : ""}`}
              onClick={() => setActiveSubtab(sub.key)}
              aria-selected={isActive}
              role="tab"
            >
              {t(sub.labelKey)}
            </button>
          );
        })}
      </nav>

      {activeSubtab === "layout" && <LayoutPanel />}
      {activeSubtab === "navTabs" && <NavTabsPanel />}
      {activeSubtab === "navButtons" && <NavButtonsPanel />}
      {activeSubtab === "badges" && <BadgesPanel />}
      {activeSubtab === "widgets" && <WidgetsPanel />}
      {activeSubtab === "detailSections" && <DetailSectionsPanel />}
    </div>
  );
}