import { lazy, Suspense, useEffect } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { Button, PageHeader } from "../components/ui";
import "../styles/page-settings.css";
import "../styles/settings-ui.css";
import "../styles/settings-tabs-b.css";

import { useSettings } from "../context/SettingsContext";
import { useAppVersion } from "../hooks/useAppVersion";
import { useIntegrations } from "./settings/useIntegrations";
import { isSettingsTab, useSettingsCatalog } from "./settings/settingsCatalog";
import { useSectionScroll } from "./settings/useSectionScroll";
import { SettingsUiProvider, useSettingsUi } from "./settings/SettingsUiContext";
import SettingsSidebar from "./settings/SettingsSidebar";
import SettingsOverviewTab from "./settings/SettingsOverviewTab";
import { IntegrationsIcon, SettingsGearIcon } from "./settings/settingsIcons";
import type { SettingsTab } from "./settings/types";
import { Skeleton } from "../components/ui/Skeleton";

// Every non-default tab is its own chunk: the settings surface is the
// largest page in the app (Compatibility alone is 144 KB of Linux tooling,
// Layout Studio previews another 170 KB) and only one tab is ever on
// screen. Opening Settings now parses just the catalog + the active tab,
// and each other tab loads on first click.
const GeneralTab = lazy(() => import("./settings/GeneralTab"));
const AppearanceTab = lazy(() => import("./settings/AppearanceTab"));
const InterfaceTab = lazy(() => import("./settings/InterfaceTab"));
const HardwareTab = lazy(() => import("./settings/HardwareTab"));
const IntegrationsTab = lazy(() => import("./settings/IntegrationsTab"));
const DiscordTab = lazy(() => import("./settings/DiscordTab"));
const DownloadsTab = lazy(() => import("./settings/DownloadsTab"));
const PluginsTab = lazy(() => import("./settings/PluginsTab"));
const LauncherTab = lazy(() => import("./settings/LauncherTab"));
const PrivacyTab = lazy(() => import("./settings/PrivacyTab"));
const BackupTab = lazy(() => import("./settings/BackupTab"));
const SavesTab = lazy(() => import("./settings/SavesTab"));
const DiagnosticsTab = lazy(() => import("./settings/DiagnosticsTab"));
const OverlayTab = lazy(() => import("./settings/OverlayTab"));
const CompatibilityTab = lazy(() => import("./settings/CompatibilityTab"));

/** Shimmer shown for the few frames a tab chunk is being parsed. */
function TabFallback() {
  return (
    <div className="settings-tab-fallback" aria-busy="true" role="status">
      <Skeleton width="220px" height="1.6em" />
      <Skeleton shape="rect" width="100%" height="96px" />
      <Skeleton shape="rect" width="100%" height="160px" />
    </div>
  );
}

/**
 * SettingsPage — the routed settings shell. Each tab lives at its own URL
 * (`/settings/general`, `/settings/appearance`, …) so tabs survive
 * refresh/back/forward and every section can be deep-linked via
 * `?section=<id>`.
 *
 * Navigation is a single rail: six intent groups, every tab visible, no
 * second tab strip to discover. The rail also owns search, which resolves
 * individual controls (not just page names) and the Essentials filter that
 * hides expert-only sections until asked for.
 */
export default function SettingsPage() {
  return (
    <SettingsUiProvider>
      <SettingsShell />
    </SettingsUiProvider>
  );
}

function SettingsShell() {
  const { t } = useLanguage();
  const { tab } = useParams<{ tab?: string }>();
  const { showFullLinuxUi } = useSettings();
  const { showAdvanced, setShowAdvanced } = useSettingsUi();
  const [searchParams] = useSearchParams();
  const version = useAppVersion();

  const integrations = useIntegrations();
  const catalog = useSettingsCatalog(t, { showFullLinuxUi });
  const validTab = isSettingsTab(tab, { showFullLinuxUi });
  const activeTab: SettingsTab = validTab ? tab : "overview";
  const meta = catalog.meta[activeTab];

  // Deep links / search: scroll the targeted section into view with a
  // brief flash on whatever tab is active.
  useSectionScroll(
    catalog.tabOrder.flatMap((tabId) =>
      catalog.meta[tabId].sections.map((s) => s.id),
    ),
  );

  // A deep link to an expert section must not land on nothing: reveal the
  // advanced layers once per navigated target, then let the user switch the
  // filter back off without this effect force-enabling it again.
  const targetSection = searchParams.get("section");
  useEffect(() => {
    if (!targetSection) return;
    const section = meta.sections.find((s) => s.id === targetSection);
    if (section && section.essential === false) setShowAdvanced(true);
  }, [targetSection, setShowAdvanced, meta]);

  // Unknown or missing tab → canonical URL (covers `/settings`).
  if (!validTab) {
    return <Navigate to="/settings/overview" replace />;
  }

  const activeCategory = catalog.groups.find((group) =>
    group.items.some((item) => item.tab === activeTab),
  );

  // Backup and Compatibility are subtab surfaces and Integrations is a
  // collapsed accordion hub: their expert areas are handled inside the tab.
  const isSubtabSurface =
    activeTab === "backup" ||
    activeTab === "compatibility" ||
    activeTab === "integrations";
  const hiddenCount = isSubtabSurface
    ? 0
    : meta.sections.filter((section) => section.essential === false).length;

  return (
    <div className="settings-shell settings-shell--rail">
      <SettingsSidebar
        groups={catalog.groups}
        activeTab={activeTab}
        searchIndex={catalog.searchIndex}
        connectedIntegrations={integrations.connectedIntegrations}
        version={version}
        t={t}
      />

      <main className="settings-content">
        <PageHeader
          eyebrow={activeCategory?.label ?? t("settings.title")}
          title={t(meta.labelKey)}
          description={t(meta.descKey)}
          icon={meta.icon || <SettingsGearIcon />}
          actions={
            activeTab === "overview" ? (
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
            ) : hiddenCount > 0 && !showAdvanced ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvanced(true)}
              >
                {t("settings.showAdvancedCount", { count: hiddenCount })}
              </Button>
            ) : null
          }
        />

        <div className="settings-body">
          <div className="settings-body-main">
            <Suspense fallback={<TabFallback />}>
              {activeTab === "overview" && (
                <SettingsOverviewTab integrations={integrations} />
              )}
              {activeTab === "general" && <GeneralTab />}
              {activeTab === "appearance" && <AppearanceTab />}
              {activeTab === "interface" && <InterfaceTab />}
              {activeTab === "hardware" && <HardwareTab />}
              {activeTab === "integrations" && (
                <IntegrationsTab
                  integrations={integrations}
                  sectionIds={meta.sections.map((s) => s.id)}
                />
              )}
              {activeTab === "discord" && <DiscordTab />}
              {activeTab === "downloads" && <DownloadsTab />}
              {activeTab === "plugins" && <PluginsTab />}
              {activeTab === "launcher" && <LauncherTab />}
              {activeTab === "privacy" && <PrivacyTab />}
              {activeTab === "backup" && <BackupTab />}
              {activeTab === "saves" && <SavesTab />}
              {activeTab === "diagnostics" && <DiagnosticsTab />}
              {activeTab === "overlay" && <OverlayTab />}
              {activeTab === "compatibility" && showFullLinuxUi && (
                <CompatibilityTab />
              )}
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
