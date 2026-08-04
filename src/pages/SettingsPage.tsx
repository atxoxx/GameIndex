import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useBigScreen } from "../context/BigScreenContext";
import { PageHeader } from "../components/ui";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";
import "../styles/page-settings.css";

import { useIntegrations } from "./settings/useIntegrations";
import SettingsSidebar from "./settings/SettingsSidebar";
import GeneralTab from "./settings/GeneralTab";
import AppearanceTab from "./settings/AppearanceTab";
import HardwareTab from "./settings/HardwareTab";
import IntegrationsTab from "./settings/IntegrationsTab";
import DownloadsTab from "./settings/DownloadsTab";
import LauncherTab from "./settings/LauncherTab";
import PrivacyTab from "./settings/PrivacyTab";
import {
  GlobeIcon,
  HardwareIcon,
  IntegrationsIcon,
  PaletteIcon,
  RocketIcon,
  SettingsGearIcon,
  TrashIcon,
  SteamIcon,
  EpicIcon,
  GogIcon,
  HumbleIcon,
  RockstarIcon,
  UplayIcon,
} from "./settings/settingsIcons";
import type { SettingsNavGroup, SettingsTab } from "./settings/types";

/**
 * SettingsPage — the settings shell. A searchable grouped sidebar lists
 * every destination (tab + in-tab anchor); the content column renders
 * the active tab. All state lives in the tab components or the
 * useIntegrations hook, so this file stays a thin orchestrator.
 */
export default function SettingsPage() {
  // All hooks are called unconditionally (before the big-screen early
  // return) so the hook order stays stable when `isBigScreen` flips.
  const { isBigScreen } = useBigScreen();
  const { t } = useLanguage();
  const integrations = useIntegrations();

  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("appearance");
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [navQuery, setNavQuery] = useState("");
  const pendingAnchor = useRef<string | null>(null);

  if (isBigScreen) {
    return <BigScreenSystem />;
  }

  // Sidebar navigation: jump to a top-level tab, optionally scrolling
  // to a sub-section anchor (an integration tile or a downloads card).
  const navigate = (tab: SettingsTab, anchor?: string) => {
    setActiveSettingsTab(tab);
    setActiveAnchor(anchor ?? null);
    pendingAnchor.current = anchor ?? null;
  };

  // After a tab switch, scroll the pending sub-section into view.
  useEffect(() => {
    if (!pendingAnchor.current) return;
    const id = pendingAnchor.current;
    pendingAnchor.current = null;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [activeSettingsTab]);

  // Flat list of every navigable destination, grouped in the sidebar.
  const NAV_GROUPS: SettingsNavGroup[] = [
    {
      id: "personalize",
      label: t("settings.group.personalize"),
      items: [
        { tab: "general", label: t("settings.general"), keywords: "language locale interface display", icon: <GlobeIcon /> },
        { tab: "appearance", label: t("settings.appearance"), keywords: "theme accent color display", icon: <PaletteIcon /> },
        { tab: "hardware", label: t("settings.tab.hardware"), keywords: "gpu cpu ram monitor telemetry temperature", icon: <HardwareIcon /> },
      ],
    },
    {
      id: "connections",
      label: t("settings.group.connections"),
      items: [
        { tab: "integrations", anchor: "integration-steam", label: t("settings.integration.steam"), keywords: "steam connect sync", icon: <SteamIcon /> },
        { tab: "integrations", anchor: "integration-epic", label: t("settings.integration.epicGames"), keywords: "epic connect sync", icon: <EpicIcon /> },
        { tab: "integrations", anchor: "integration-gog", label: t("settings.integration.gogGalaxy"), keywords: "gog connect sync", icon: <GogIcon /> },
        { tab: "integrations", anchor: "integration-humble", label: t("settings.integration.humbleBundle"), keywords: "humble connect sync", icon: <HumbleIcon /> },
        { tab: "integrations", anchor: "integration-rockstar", label: t("settings.integration.rockstarGamesLauncher"), keywords: "rockstar scan launcher", icon: <RockstarIcon /> },
        { tab: "integrations", anchor: "integration-uplay", label: t("settings.integration.ubisoftConnect"), keywords: "ubisoft uplay scan", icon: <UplayIcon /> },
        { tab: "integrations", anchor: "section-datasync", label: t("settings.section.dataSync"), keywords: "sync interval retention discord achievements", icon: <IntegrationsIcon /> },
      ],
    },
    {
      id: "downloads",
      label: t("settings.group.downloads"),
      items: [
        { tab: "downloads", anchor: "downloads-location", label: t("settings.section.downloadLocation"), keywords: "save path folder default" },
        { tab: "downloads", anchor: "downloads-notifications", label: t("settings.section.notifications"), keywords: "notify complete toast desktop" },
        { tab: "downloads", anchor: "downloads-bandwidth", label: t("settings.section.bandwidth"), keywords: "speed limit download upload" },
        { tab: "downloads", anchor: "downloads-blocked", label: t("settings.section.blockedDomains"), keywords: "block domain filter sources" },
        { tab: "downloads", anchor: "downloads-sources", label: t("settings.section.downloadSources"), keywords: "sources hydra json mirrors" },
        { tab: "downloads", anchor: "downloads-debrid", label: t("settings.section.debrid"), keywords: "debrid alldebrid torbox api key" },
      ],
    },
    {
      id: "system",
      label: t("settings.group.system"),
      items: [
        { tab: "launcher", label: t("settings.tab.launcher"), keywords: "startup launch tray autostart uac", icon: <RocketIcon /> },
        { tab: "privacy", label: t("settings.tab.privacy"), keywords: "wipe clear local storage cache data reset privacy", icon: <TrashIcon /> },
      ],
    },
  ];

  // Keep the latest nav groups reachable from the scrollspy effect
  // without re-running it on every render (t() changes identity).
  const navGroupsRef = useRef<SettingsNavGroup[]>(NAV_GROUPS);
  navGroupsRef.current = NAV_GROUPS;

  // Scrollspy: inside multi-section tabs (integrations, downloads)
  // highlight the sidebar row for whichever section is currently in
  // view, so the page always indicates where you are.
  useEffect(() => {
    const groups = navGroupsRef.current;
    const anchors = groups
      .flatMap((g) => g.items)
      .filter((i) => i.tab === activeSettingsTab && i.anchor)
      .map((i) => i.anchor as string);
    if (anchors.length < 2) return;

    // Unless the user just deep-linked to a specific section, start with
    // the first section highlighted before any scroll happens.
    if (!anchors.includes(activeAnchor ?? "")) {
      setActiveAnchor(anchors[0]);
    }

    const els = anchors
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActiveAnchor(topmost.target.id);
      },
      { rootMargin: "-15% 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [activeSettingsTab]);

  return (
    <div className="settings-shell">
      <SettingsSidebar
        groups={NAV_GROUPS}
        activeTab={activeSettingsTab}
        activeAnchor={activeAnchor}
        navQuery={navQuery}
        onQueryChange={setNavQuery}
        onNavigate={navigate}
        connectedIntegrations={integrations.connectedIntegrations}
        connectionStatus={integrations.connectionStatus}
        t={t}
      />

      <main className="settings-content">
        <PageHeader
          eyebrow={t("settings.title")}
          title={t("settings.title")}
          description={t("settings.desc")}
          icon={<SettingsGearIcon />}
          actions={
            <span className="settings-header-summary" title={t("settingsPage.connected")}>
              <IntegrationsIcon />
              {integrations.connectedIntegrations > 0 && (
                <span className="settings-header-summary-dot" aria-hidden />
              )}
              {t("settings.connectedCount", { count: integrations.connectedIntegrations })}
            </span>
          }
        />

        {activeSettingsTab === "general" && <GeneralTab />}
        {activeSettingsTab === "appearance" && <AppearanceTab />}
        {activeSettingsTab === "hardware" && <HardwareTab />}
        {activeSettingsTab === "integrations" && (
          <IntegrationsTab integrations={integrations} />
        )}
        {activeSettingsTab === "downloads" && <DownloadsTab />}
        {activeSettingsTab === "launcher" && <LauncherTab />}
        {activeSettingsTab === "privacy" && <PrivacyTab />}
      </main>
    </div>
  );
}
