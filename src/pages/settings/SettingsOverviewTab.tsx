import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, FolderOpen, LayoutGrid, Library, RefreshCw } from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useDownloads } from "../../context/DownloadContext";
import { useSetupWizard } from "../../context/SetupWizardContext";
import { useUpdate } from "../../context/UpdateContext";
import { useAppVersion } from "../../hooks/useAppVersion";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import type { useIntegrations } from "./useIntegrations";
import {
  BackupIcon,
  BattleNetIcon,
  DiagnosticsIcon,
  EAIcon,
  EpicIcon,
  GlobeIcon,
  GogIcon,
  HumbleIcon,
  IntegrationsIcon,
  ItchIcon,
  SteamIcon,
  XboxIcon,
} from "./settingsIcons";

type Integrations = ReturnType<typeof useIntegrations>;

interface SettingsOverviewTabProps {
  integrations: Integrations;
}

interface SetupStep {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  optional?: boolean;
  actionLabel: string;
  onAction: () => void;
}

/**
 * SettingsOverviewTab — the landing page of Settings.
 *
 * A first-time user should never have to guess where to start. This tab
 * answers three questions in order: what still needs doing, which stores are
 * connected, and what the app currently looks like (version, library size,
 * download folder). Everything is a live summary with a jump to the real
 * control, so it doubles as a health check for returning users.
 */
export default function SettingsOverviewTab({ integrations }: SettingsOverviewTabProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { games } = useGames();
  const { defaultDownloadPath, alwaysAskPath } = useDownloads();
  const { completed: setupCompleted, openWizard } = useSetupWizard();
  const { status: updateStatus, updateInfo, checkForUpdates } = useUpdate();
  const version = useAppVersion();

  const downloadFolderReady = Boolean(defaultDownloadPath) && !alwaysAskPath;

  const steps: SetupStep[] = [
    {
      id: "wizard",
      title: t("settings.overview.stepWizardTitle"),
      desc: t("settings.overview.stepWizardDesc"),
      done: setupCompleted,
      actionLabel: t("settings.overview.stepWizardAction"),
      onAction: openWizard,
    },
    {
      id: "store",
      title: t("settings.overview.stepStoreTitle"),
      desc: t("settings.overview.stepStoreDesc"),
      done: integrations.connectedIntegrations > 0,
      actionLabel: t("settings.overview.stepStoreAction"),
      onAction: () => navigate("/settings/integrations"),
    },
    {
      id: "library",
      title: t("settings.overview.stepLibraryTitle"),
      desc: t("settings.overview.stepLibraryDesc"),
      done: games.length > 0,
      actionLabel: t("settings.overview.stepLibraryAction"),
      onAction: () => navigate("/library"),
    },
    {
      id: "downloads",
      title: t("settings.overview.stepDownloadsTitle"),
      desc: t("settings.overview.stepDownloadsDesc"),
      done: downloadFolderReady,
      actionLabel: t("settings.overview.stepDownloadsAction"),
      onAction: () => navigate("/settings/downloads?section=downloads-location"),
    },
    {
      id: "overlay",
      title: t("settings.overview.stepOverlayTitle"),
      desc: t("settings.overview.stepOverlayDesc"),
      done: false,
      optional: true,
      actionLabel: t("settings.overview.stepOverlayAction"),
      onAction: () => navigate("/settings/overlay"),
    },
  ];

  const requiredSteps = steps.filter((step) => !step.optional);
  const completedSteps = requiredSteps.filter((step) => step.done).length;
  const progress = Math.round((completedSteps / requiredSteps.length) * 100);

  const stores = [
    {
      id: "integration-steam",
      label: t("settings.integration.steam"),
      icon: <SteamIcon />,
      connected: integrations.steam.steamAuth.isAuthenticated,
    },
    {
      id: "integration-epic",
      label: t("settings.integration.epicGames"),
      icon: <EpicIcon />,
      connected: integrations.epic.epicAuth.isAuthenticated,
    },
    {
      id: "integration-gog",
      label: t("settings.integration.gogGalaxy"),
      icon: <GogIcon />,
      connected: integrations.gog.gogAuth.isAuthenticated,
    },
    {
      id: "integration-humble",
      label: t("settings.integration.humbleBundle"),
      icon: <HumbleIcon />,
      connected: integrations.humble.humbleAuth.isAuthenticated,
    },
    {
      id: "integration-battlenet",
      label: t("settings.integration.battleNet"),
      icon: <BattleNetIcon />,
      connected: integrations.battlenet.auth.isAuthenticated,
    },
    {
      id: "integration-ea",
      label: t("settings.integration.ea"),
      icon: <EAIcon />,
      connected: integrations.ea.auth.isAuthenticated,
    },
    {
      id: "integration-xbox",
      label: t("settings.integration.xbox"),
      icon: <XboxIcon />,
      connected: integrations.xbox.auth.isAuthenticated,
    },
    {
      id: "integration-itch",
      label: t("settings.integration.itch"),
      icon: <ItchIcon />,
      connected: integrations.itch.auth.isAuthenticated,
    },
  ];

  const updateLabel =
    updateStatus === "available" && updateInfo?.version
      ? t("settings.overview.updateAvailable", { version: updateInfo.version })
      : updateStatus === "checking"
        ? t("settings.overview.updateChecking")
        : t("settings.overview.updateUpToDate");

  return (
    <>
      <SettingsSection
        id="overview-setup"
        icon={<Check />}
        title={t("settings.overview.setupTitle")}
        desc={t("settings.overview.setupDesc")}
        actions={
          <span className="settings-overview-progress-label">
            {t("settings.overview.progress", {
              done: completedSteps,
              total: requiredSteps.length,
            })}
          </span>
        }
      >
        <div
          className="settings-overview-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t("settings.overview.progressAria")}
        >
          <span style={{ width: `${progress}%` }} />
        </div>

        <ol className="settings-setup-list">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={`settings-setup-step${step.done ? " is-done" : ""}`}
            >
              <span className="settings-setup-step-marker" aria-hidden>
                {step.done ? <Check size={13} /> : index + 1}
              </span>
              <span className="settings-setup-step-text">
                <span className="settings-setup-step-title">
                  {step.title}
                  {step.optional && (
                    <span className="settings-setup-step-optional">
                      {t("settings.overview.optional")}
                    </span>
                  )}
                </span>
                <span className="settings-setup-step-desc">{step.desc}</span>
              </span>
              <Button
                variant={step.done ? "ghost" : "secondary"}
                size="sm"
                onClick={step.onAction}
              >
                {step.done ? t("settings.overview.review") : step.actionLabel}
              </Button>
            </li>
          ))}
        </ol>
      </SettingsSection>

      <SettingsSection
        id="overview-stores"
        icon={<IntegrationsIcon />}
        title={t("settings.overview.storesTitle")}
        desc={t("settings.overview.storesDesc")}
        actions={
          <Button
            variant="ghost"
            size="sm"
            rightIcon={<ChevronRight size={14} />}
            onClick={() => navigate("/settings/integrations")}
          >
            {t("settings.overview.manageStores")}
          </Button>
        }
      >
        <div className="settings-store-grid">
          {stores.map((store) => (
            <button
              key={store.id}
              type="button"
              className={`settings-store-tile${store.connected ? " is-connected" : ""}`}
              onClick={() =>
                navigate(`/settings/integrations?section=${store.id}`)
              }
            >
              <span className="settings-store-tile-icon" aria-hidden>
                {store.icon}
              </span>
              <span className="settings-store-tile-text">
                <span className="settings-store-tile-name">{store.label}</span>
                <span className="settings-store-tile-state">
                  {store.connected
                    ? t("settings.overview.connected")
                    : t("settings.overview.notConnected")}
                </span>
              </span>
              {store.connected && (
                <span className="settings-store-tile-dot" aria-hidden />
              )}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        id="overview-status"
        icon={<LayoutGrid />}
        title={t("settings.overview.statusTitle")}
        desc={t("settings.overview.statusDesc")}
      >
        <div className="settings-status-grid">
          <div className="settings-status-cell">
            <span className="settings-status-cell-label">
              {t("settings.overview.versionLabel")}
            </span>
            <span className="settings-status-cell-value">
              {version ? `v${version}` : "—"}
            </span>
            <span className="settings-status-cell-sub">{updateLabel}</span>
          </div>
          <div className="settings-status-cell">
            <span className="settings-status-cell-label">
              {t("settings.overview.libraryLabel")}
            </span>
            <span className="settings-status-cell-value">{games.length}</span>
            <span className="settings-status-cell-sub">
              {t("settings.overview.librarySub")}
            </span>
          </div>
          <div className="settings-status-cell">
            <span className="settings-status-cell-label">
              {t("settings.overview.storesLabel")}
            </span>
            <span className="settings-status-cell-value">
              {integrations.connectedIntegrations}
            </span>
            <span className="settings-status-cell-sub">
              {t("settings.overview.storesSub")}
            </span>
          </div>
          <div className="settings-status-cell">
            <span className="settings-status-cell-label">
              {t("settings.overview.folderLabel")}
            </span>
            <span
              className="settings-status-cell-value settings-status-cell-value--path"
              title={defaultDownloadPath || undefined}
            >
              {defaultDownloadPath
                ? defaultDownloadPath
                : t("settings.overview.folderUnset")}
            </span>
            <button
              type="button"
              className="settings-status-cell-link"
              onClick={() =>
                navigate("/settings/downloads?section=downloads-location")
              }
            >
              <FolderOpen size={12} aria-hidden />
              {t("settings.overview.folderAction")}
            </button>
          </div>
        </div>

        {updateStatus === "available" && (
          <div className="settings-overview-banner">
            <RefreshCw size={15} aria-hidden />
            <span>{t("settings.overview.updateBanner")}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate("/settings/general?section=general-updates")}
            >
              {t("settings.overview.updateBannerAction")}
            </Button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="overview-help"
        icon={<GlobeIcon />}
        title={t("settings.overview.helpTitle")}
        desc={t("settings.overview.helpDesc")}
      >
        <div className="settings-overview-links">
          <Button
            variant="secondary"
            leftIcon={<Library size={15} />}
            onClick={openWizard}
          >
            {t("settings.overview.helpWizard")}
          </Button>
          <Button
            variant="secondary"
            leftIcon={<GlobeIcon />}
            onClick={() => navigate("/docs")}
          >
            {t("settings.overview.helpDocs")}
          </Button>
          <Button
            variant="secondary"
            leftIcon={<BackupIcon />}
            onClick={() => navigate("/settings/backup")}
          >
            {t("settings.overview.helpBackup")}
          </Button>
          <Button
            variant="secondary"
            leftIcon={<DiagnosticsIcon />}
            onClick={() => navigate("/settings/diagnostics")}
          >
            {t("settings.overview.helpDiagnostics")}
          </Button>
          <Button
            variant="ghost"
            leftIcon={<RefreshCw size={15} />}
            isLoading={updateStatus === "checking"}
            onClick={() => void checkForUpdates(true)}
          >
            {t("updater.checkForUpdates")}
          </Button>
        </div>
      </SettingsSection>
    </>
  );
}
