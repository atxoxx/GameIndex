import {
  BadgeCheck,
  Home,
  LayoutGrid,
  LayoutList,
  List,
  PanelLeft,
  SlidersHorizontal,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import {
  useSettings,
  type DetailSectionKey,
  type LandingPage,
  type UiScale,
} from "../../context/SettingsContext";
import { INTERFACE_PAGES } from "../../context/interfaceLayout";
import {
  BADGE_ITEMS,
  MASTER_GATED_BADGES,
  WIDGET_ITEMS,
  buildDetailSectionItems,
} from "./interfaceItems";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import "./InterfaceDefaults.css";

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

/** Detail-page tabs are edited per page inside the Layout Studio's page
 *  editor. Keep only the overview sections here so every toggle has a single
 *  owner and the two surfaces never fight over the same setting. */
const TAB_DETAIL_KEYS: ReadonlySet<DetailSectionKey> = new Set([
  "reviews",
  "activity",
  "notes",
  "achievements",
  "mods",
  "weblinks",
  "news",
]);

/**
 * InterfaceDefaults
 * ─────────────────
 * The global shell controls that used to live in the Layout Studio's
 * right-hand pane, re-homed as ordinary settings sections below the studio.
 *
 * These are the settings the live preview cannot change by itself: the
 * interface scale, the layout modes, the sidebar side, the card-badge and
 * widget masters, the overview detail sections and the startup landing page.
 * Everything stateful comes straight from `useSettings()`.
 */
export default function InterfaceDefaults() {
  const { t } = useLanguage();
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
    showNavbarNowPlaying,
    setShowNavbarNowPlaying,
    sidebarPosition,
    setSidebarPosition,
    showCardBadges,
    setShowCardBadges,
    interfaceVisibility,
    setInterfaceVisibility,
    detailSectionVisible,
    setDetailSectionVisible,
    landingPage,
    setLandingPage,
    showDeckVerified,
  } = useSettings();

  const detailSections = buildDetailSectionItems(showDeckVerified).filter(
    (item) => !TAB_DETAIL_KEYS.has(item.key),
  );

  const landingPages = INTERFACE_PAGES.filter((page) => page.key !== "global");

  return (
    <>
      {/* ── Layout ─────────────────────────────────────────────── */}
      <SettingsSection
        id="interface-defaults-layout"
        icon={<SlidersHorizontal size={18} />}
        title={t("settings.appearance.interfaceTitle")}
        desc={t("settings.appearance.interfaceDesc")}
      >
        <div className="settings-row">
          <div className="settings-control interface-defaults-control">
            <label className="settings-label" htmlFor="interface-ui-scale">
              {t("settings.appearance.uiScaleTitle")}
            </label>
            <p className="settings-helper-lead">
              {t("settings.appearance.uiScaleDesc")}
            </p>
            <select
              id="interface-ui-scale"
              className="settings-select"
              value={uiScale}
              onChange={(e) => setUiScale(e.target.value as UiScale)}
            >
              {UI_SCALE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="interface-defaults-grid">
            <SettingsToggleCard
              title={t("settings.appearance.simpleUiTitle")}
              desc={t("settings.appearance.simpleUiDesc")}
              checked={uiDensityMode === "simple"}
              onChange={(checked) => setUiDensityMode(checked ? "simple" : "complete")}
            />
            <SettingsToggleCard
              title={t("settings.appearance.navbarCompactTitle")}
              desc={t("settings.appearance.navbarCompactDesc")}
              checked={navbarMode === "compact"}
              onChange={(checked) => setNavbarMode(checked ? "compact" : "full")}
            />
            <SettingsToggleCard
              title={t("settings.appearance.cmdPaletteSimpleTitle")}
              desc={t("settings.appearance.cmdPaletteSimpleDesc")}
              checked={commandPaletteMode === "simple"}
              onChange={(checked) =>
                setCommandPaletteMode(checked ? "simple" : "full")
              }
            />
            <SettingsToggleCard
              title={t("settings.appearance.artBackdropTitle")}
              desc={t("settings.appearance.artBackdropDesc")}
              checked={showGameArtBackdrop}
              onChange={setShowGameArtBackdrop}
            />
          </div>
        </div>
      </SettingsSection>

      {/* ── Header ─────────────────────────────────────────────── */}
      <SettingsSection
        id="interface-defaults-header"
        icon={<LayoutList size={18} />}
        title={t("settings.interface.studioHeader")}
      >
        <div className="interface-defaults-grid">
          <SettingsToggleCard
            title={t("settings.appearance.navbarNowPlayingTitle")}
            desc={t("settings.appearance.navbarNowPlayingDesc")}
            checked={showNavbarNowPlaying}
            onChange={setShowNavbarNowPlaying}
          />
        </div>
      </SettingsSection>

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <SettingsSection
        id="interface-defaults-sidebar"
        icon={<PanelLeft size={18} />}
        title={t("settings.interface.studioSidebar")}
      >
        <div className="settings-control interface-defaults-control">
          <span className="settings-label">
            {t("settings.interface.studioSidebarPosition")}
          </span>
          <div
            className="settings-segmented"
            role="group"
            aria-label={t("settings.interface.studioSidebarPosition")}
          >
            <button
              type="button"
              className={sidebarPosition === "left" ? "active" : ""}
              aria-pressed={sidebarPosition === "left"}
              onClick={() => setSidebarPosition("left")}
            >
              {t("settings.interface.studioSidebarLeft")}
            </button>
            <button
              type="button"
              className={sidebarPosition === "right" ? "active" : ""}
              aria-pressed={sidebarPosition === "right"}
              onClick={() => setSidebarPosition("right")}
            >
              {t("settings.interface.studioSidebarRight")}
            </button>
          </div>
        </div>
      </SettingsSection>

      {/* ── Card badges ────────────────────────────────────────── */}
      <SettingsSection
        id="interface-defaults-badges"
        icon={<BadgeCheck size={18} />}
        title={t("settings.section.interfaceBadges")}
        desc={t("settings.section.interfaceBadges.desc")}
      >
        <div className="interface-defaults-grid">
          <SettingsToggleCard
            title={t("settings.appearance.cardBadgesTitle")}
            desc={t("settings.appearance.cardBadgesDesc")}
            checked={showCardBadges}
            onChange={setShowCardBadges}
          />
          {BADGE_ITEMS.map((item) => (
            <SettingsToggleCard
              key={item.key}
              title={t(item.labelKey)}
              checked={interfaceVisibility[item.key]}
              disabled={MASTER_GATED_BADGES.has(item.key) && !showCardBadges}
              onChange={(checked) => setInterfaceVisibility(item.key, checked)}
            />
          ))}
        </div>
      </SettingsSection>

      {/* ── Widgets ────────────────────────────────────────────── */}
      <SettingsSection
        id="interface-defaults-widgets"
        icon={<LayoutGrid size={18} />}
        title={t("settings.interface.studioWidgetsAllPages")}
        desc={t("settings.interface.studioWidgetsAllPagesHint")}
      >
        <div className="interface-defaults-grid">
          {WIDGET_ITEMS.map((item) => (
            <SettingsToggleCard
              key={item.key}
              title={t(item.labelKey)}
              checked={interfaceVisibility[item.key]}
              onChange={(checked) => setInterfaceVisibility(item.key, checked)}
            />
          ))}
        </div>
      </SettingsSection>

      {/* ── Game & store detail sections (overview only) ───────── */}
      <SettingsSection
        id="interface-defaults-detail-sections"
        icon={<List size={18} />}
        title={t("settings.detailSections.title")}
        desc={t("settings.detailSections.desc")}
      >
        <div className="interface-defaults-grid">
          {detailSections.map((item) => (
            <SettingsToggleCard
              key={item.key}
              title={t(item.titleKey)}
              desc={t(item.descKey)}
              checked={detailSectionVisible[item.key]}
              onChange={(checked) => setDetailSectionVisible(item.key, checked)}
            />
          ))}
        </div>
      </SettingsSection>

      {/* ── Landing page ───────────────────────────────────────── */}
      <SettingsSection
        id="interface-defaults-landing"
        icon={<Home size={18} />}
        title={t("settings.launcher.landingTitle")}
        desc={t("settings.launcher.landingDesc")}
      >
        <div className="settings-control interface-defaults-control">
          <select
            className="settings-select"
            value={landingPage}
            aria-label={t("settings.launcher.landingTitle")}
            onChange={(e) => setLandingPage(e.target.value as LandingPage)}
          >
            {landingPages.map((page) => (
              <option key={page.key} value={page.key}>
                {t(page.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </SettingsSection>
    </>
  );
}
