import type { ReactNode } from "react";

import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import IntegrationTile from "./IntegrationTile";
import { BetaToggle } from "./IntegrationToggles";
import type { useBetaIntegration } from "./useBetaIntegration";

type Integration = ReturnType<typeof useBetaIntegration>;

interface BetaIntegrationTileProps {
  /** Anchor id (`integration-battlenet`, …). */
  id: string;
  /** Brand class for the tile accent (`battlenet`, `ea`, `xbox`, `itch`). */
  brand: string;
  icon: ReactNode;
  /** Human-readable store name used as the `{store}` i18n placeholder. */
  storeName: string;
  integration: Integration;
  open: boolean;
  onToggle: () => void;
  /** Open the confirm modal that wipes this store's imported games. */
  onRemoveGames: () => void;
  /** Open the confirm modal that disconnects the account. */
  onConfirmDisconnect: () => void;
}

/**
 * BetaIntegrationTile — one experimental store rendered through the
 * shared `IntegrationTile` shell. The distinguishing features are the
 * always-visible "Beta" badge and the permanent warning note; everything
 * else (connect / sync / disconnect / import toggles) mirrors the
 * first-party integrations.
 */
export default function BetaIntegrationTile({
  id,
  brand,
  icon,
  storeName,
  integration,
  open,
  onToggle,
  onRemoveGames,
  onConfirmDisconnect,
}: BetaIntegrationTileProps) {
  const { t } = useLanguage();
  const {
    auth,
    settings,
    syncResult,
    isLoggingIn,
    isSyncing,
    handleLogin,
    handleSync,
    updateSetting,
  } = integration;

  return (
    <IntegrationTile
      brand={brand}
      id={id}
      icon={icon}
      name={
        <>
          <span>{storeName}</span>
          <span className="integration-badge beta">{t("settings.beta.badge")}</span>
        </>
      }
      description={t("settings.beta.integrationDesc", { store: storeName })}
      connected={auth.isAuthenticated}
      badgeLabel={t("settingsPage.connected")}
      status={
        auth.isAuthenticated ? (
          <div className="auth-status">
            {t("settings.beta.connected", {
              store: storeName,
              display: auth.username ? ` ${auth.username}` : "",
            })}
          </div>
        ) : (
          <p className="connect-prompt">
            {t("settings.beta.connectPrompt", { store: storeName })}
          </p>
        )
      }
      note={t("settings.beta.warning")}
      actions={
        <>
          {auth.isAuthenticated ? (
            <Button variant="primary" onClick={() => void handleSync()} isLoading={isSyncing}>
              {t("settings.integrations.syncLibrary")}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void handleLogin()}
              isLoading={isLoggingIn}
            >
              {t("settings.beta.connect", { store: storeName })}
            </Button>
          )}
          <Button variant="danger" onClick={onRemoveGames}>
            {t("settings.integrations.removeGames")}
          </Button>
        </>
      }
      result={
        syncResult && (
          <div className={`sync-result ${syncResult.success ? "success" : "error"}`}>
            {syncResult.success
              ? `✓ ${t("settings.beta.syncedAll", {
                  store: storeName,
                  games: syncResult.gamesImported,
                })}`
              : `✗ ${syncResult.errors?.[0] || t("settings.sync.failed")}`}
            {syncResult.success && syncResult.note && (
              <p className="sync-result-note">{syncResult.note}</p>
            )}
          </div>
        )
      }
      lastSync={
        auth.lastSync ? (
          <p className="sync-result-time">
            {t("settingsPage.lastSync", {
              time: new Date(auth.lastSync * 1000).toLocaleString(),
            })}
          </p>
        ) : undefined
      }
      dangerZone={
        auth.isAuthenticated && (
          <div className="danger-zone">
            <p className="danger-zone-text">
              {t("settings.beta.disconnectNote", { store: storeName })}
            </p>
            <Button variant="danger" size="sm" onClick={onConfirmDisconnect}>
              {t("settings.disconnect")}
            </Button>
          </div>
        )
      }
      open={open}
      onToggle={onToggle}
      expandLabel={t("settings.aria.expand", { name: storeName })}
      collapseLabel={t("settings.aria.collapse", { name: storeName })}
    >
      <div className="humble-settings-grid">
        <BetaToggle
          label={t("settings.beta.toggleConnect")}
          hint={t("settings.beta.toggleConnectHint", { store: storeName })}
          checked={settings.connectAccount}
          disabled={!auth.isAuthenticated}
          onChange={(v) => void updateSetting("connectAccount", v)}
        />
        <BetaToggle
          label={t("settings.beta.toggleImportInstalled")}
          hint={t("settings.beta.toggleImportInstalledHint")}
          checked={settings.importInstalledGames}
          disabled={!auth.isAuthenticated}
          onChange={(v) => void updateSetting("importInstalledGames", v)}
        />
        <BetaToggle
          label={t("settings.beta.toggleImportUninstalled")}
          hint={t("settings.beta.toggleImportUninstalledHint")}
          checked={settings.importUninstalledGames}
          disabled={!auth.isAuthenticated}
          onChange={(v) => void updateSetting("importUninstalledGames", v)}
        />
      </div>
    </IntegrationTile>
  );
}
