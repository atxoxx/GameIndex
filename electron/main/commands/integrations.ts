/**
 * Beta store integration commands (24 names: 4 stores × 6 verbs).
 *
 * The renderer builds these names dynamically (`betaCommand(key, verb)`), so
 * they are also listed in `commands/commandCatalog.ts` to keep the stub audit
 * honest.
 */
import { registerCommands, type CommandHandler } from "../ipc";
import {
  BETA_KEYS,
  getBetaSettings,
  isBetaAuthenticated,
  logoutBeta,
  saveBetaSettings,
  startBetaLogin,
  syncBetaLibrary,
} from "../features/integrations/betaStores";

export const integrationCommands: Record<string, CommandHandler> = {};

for (const key of BETA_KEYS) {
  integrationCommands[`${key}_is_authenticated`] = () => isBetaAuthenticated(key);
  integrationCommands[`${key}_get_settings`] = () => getBetaSettings(key);
  integrationCommands[`${key}_save_settings`] = (args) =>
    saveBetaSettings(key, args.settings);
  integrationCommands[`${key}_start_login`] = () => startBetaLogin(key);
  integrationCommands[`${key}_sync_library`] = () => syncBetaLibrary(key);
  integrationCommands[`${key}_logout`] = () => {
    logoutBeta(key);
    return null;
  };
}

export function registerIntegrationCommands(): void {
  registerCommands(integrationCommands, { override: true });
}
