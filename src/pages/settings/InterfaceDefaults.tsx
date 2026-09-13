import { List, SlidersHorizontal } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings, type DetailSectionKey, type UiScale } from "../../context/SettingsContext";
import { buildDetailSectionItems } from "./interfaceItems";
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
 * The app-wide controls that sit outside the Layout Studio's live preview:
 * the interface scale, the display modes that reshape the whole shell (Simple
 * UI, compact navbar, simple command palette, art backdrop) and the overview
 * detail sections.
 *
 * Everything the preview *can* edit — navbar items, per-page widgets, sidebar
 * side and sections, card badges, hero and detail tabs — lives there now, so
 * each setting has exactly one home.
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
    detailSectionVisible,
    setDetailSectionVisible,
    showDeckVerified,
  } = useSettings();

  const detailSections = buildDetailSectionItems(showDeckVerified).filter(
    (item) => !TAB_DETAIL_KEYS.has(item.key),
  );

  return (
    <>
      {/* ── Global appearance ───────────────────────────────────── */}
      <SettingsSection
        id="interface-defaults-layout"
        icon={<SlidersHorizontal size={18} />}
        title={t("settings.interface.globalAppearance")}
        desc={t("settings.interface.globalAppearanceDesc")}
      >
        <div className="interface-defaults-layout">
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
    </>
  );
}
