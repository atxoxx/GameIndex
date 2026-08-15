import { Navigate, useParams } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { PageHeader } from "../components/ui";
import "../styles/page-settings.css";
import "../styles/settings-tabs-b.css";

import { useIntegrations } from "./settings/useIntegrations";
import { isSettingsTab, useSettingsCatalog } from "./settings/settingsCatalog";
import { useSectionScroll } from "./settings/useSectionScroll";
import SettingsSidebar from "./settings/SettingsSidebar";
import SettingsJumpBar from "./settings/SettingsJumpBar";
import GeneralTab from "./settings/GeneralTab";
import AppearanceTab from "./settings/AppearanceTab";
import HardwareTab from "./settings/HardwareTab";
import IntegrationsTab from "./settings/IntegrationsTab";
import DownloadsTab from "./settings/DownloadsTab";
import PluginsTab from "./settings/PluginsTab";
import LauncherTab from "./settings/LauncherTab";
import PrivacyTab from "./settings/PrivacyTab";
import { IntegrationsIcon, SettingsGearIcon } from "./settings/settingsIcons";
import type { SettingsTab } from "./settings/types";

/**
 * SettingsPage — the routed settings shell. Each tab lives at its own
 * URL (`/settings/general`, `/settings/appearance`, …) so tabs survive
 * refresh/back/forward and every section can be deep-linked via
 * `?section=<id>`. The sidebar lists every tab; the jump bar
 * below the header lists the sections of the active tab; search runs
 * across the whole catalog and navigates through the same URL.
 */
export default function SettingsPage() {
  const { t } = useLanguage();
  const { tab } = useParams<{ tab?: string }>();

  // All hooks run unconditionally — the redirect below must not change
  // the hook order between renders.
  const integrations = useIntegrations();
  const catalog = useSettingsCatalog(t);
  const validTab = isSettingsTab(tab);
  const activeTab: SettingsTab = validTab ? tab : "general";
  const meta = catalog.meta[activeTab];

  // Deep links / search / jump-bar: scroll the targeted section into
  // view with a brief flash on whatever tab is active.
  useSectionScroll(
    catalog.tabOrder.flatMap((tabId) =>
      catalog.meta[tabId].sections.map((s) => s.id),
    ),
  );

  // Unknown or missing tab → canonical General URL (covers `/settings`).
  if (!validTab) {
    return <Navigate to="/settings/general" replace />;
  }

  return (
    <div className="settings-shell">
      <SettingsSidebar
        groups={catalog.groups}
        searchIndex={catalog.searchIndex}
        connectedIntegrations={integrations.connectedIntegrations}
        t={t}
      />

      <main className="settings-content">
        <PageHeader
          eyebrow={t("settings.title")}
          title={t(meta.labelKey)}
          description={t(meta.descKey)}
          icon={meta.icon || <SettingsGearIcon />}
          actions={
            <span
              className="settings-header-summary"
              title={t("settingsPage.connected")}
            >
              <IntegrationsIcon />
              {integrations.connectedIntegrations > 0 && (
                <span className="settings-header-summary-dot" aria-hidden />
              )}
              {t("settings.connectedCount", {
                count: integrations.connectedIntegrations,
              })}
            </span>
          }
        />

        {meta.sections.length > 1 && (
          <SettingsJumpBar sections={meta.sections} t={t} />
        )}

        {activeTab === "general" && <GeneralTab />}
        {activeTab === "appearance" && <AppearanceTab />}
        {activeTab === "hardware" && <HardwareTab />}
        {activeTab === "integrations" && (
          <IntegrationsTab
            integrations={integrations}
            sectionIds={meta.sections.map((s) => s.id)}
          />
        )}
        {activeTab === "downloads" && <DownloadsTab />}
        {activeTab === "plugins" && <PluginsTab />}
        {activeTab === "launcher" && <LauncherTab />}
        {activeTab === "privacy" && <PrivacyTab />}
      </main>
    </div>
  );
}
