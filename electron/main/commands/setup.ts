/**
 * First-run setup wizard state.
 *
 * Mirrors `src-tauri/src/setup.rs`: the completion flag lives in the shared
 * main-process settings document so it survives a renderer localStorage wipe.
 * Stored under the `setup_wizard_v1` key of `app-settings.json`.
 */
import type { CommandHandler } from "../ipc";
import { getAppSetting, setAppSetting } from "../state/appSettings";

interface SetupState {
  completed: boolean;
  skipped: boolean;
  version: number;
  completedAtMs: number | null;
}

const DEFAULT_STATE: SetupState = {
  completed: false,
  skipped: false,
  version: 1,
  completedAtMs: null,
};

function normalize(raw: unknown): SetupState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_STATE };
  const value = raw as Partial<SetupState>;
  return {
    completed: typeof value.completed === "boolean" ? value.completed : false,
    skipped: typeof value.skipped === "boolean" ? value.skipped : false,
    version:
      typeof value.version === "number" && Number.isFinite(value.version)
        ? value.version
        : DEFAULT_STATE.version,
    completedAtMs:
      typeof value.completedAtMs === "number" && Number.isFinite(value.completedAtMs)
        ? value.completedAtMs
        : null,
  };
}

export const setupCommands: Record<string, CommandHandler> = {
  setup_get_state: () => normalize(getAppSetting("setup_wizard_v1")),

  setup_set_state: (args) => {
    setAppSetting("setup_wizard_v1", normalize(args.state));
    return null;
  },
};
