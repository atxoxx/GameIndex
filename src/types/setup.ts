/** Mirror of the Rust `SetupState` (src-tauri/src/setup.rs). */
export interface SetupState {
  /** True once the user finished or skipped the wizard. */
  completed: boolean;
  /** True when the user dismissed the wizard with Skip. */
  skipped: boolean;
  /** Envelope version, for future migrations. */
  version: number;
  /** Unix epoch ms when the wizard was completed, if known. */
  completedAtMs: number | null;
}

export const DEFAULT_SETUP_STATE: SetupState = {
  completed: false,
  skipped: false,
  version: 1,
  completedAtMs: null,
};
