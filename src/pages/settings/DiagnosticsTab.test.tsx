import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DiagnosticsTab from "./DiagnosticsTab";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.4.0"),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

// ConfirmModal pulls in the Big Screen focus registry; stub it out so the
// tab can be rendered without a GamepadProvider.
vi.mock("../../hooks/useFocusable", () => ({
  useFocusable: (fn: () => void) => ({
    ref: vi.fn(),
    tabIndex: 0,
    onClick: fn,
    onKeyDown: vi.fn(),
  }),
}));

// Stable `t` / `showToast` identities: the tab keys its load effect on them,
// and a fresh function each render (as the context-less fallback produces)
// would re-run the effect forever.
vi.mock("../../context/LanguageContext", async () => {
  const { translate } = await import("../../i18n");
  const t = (key: string, vars?: Record<string, unknown>) =>
    translate(key, "en", vars);
  return {
    useLanguage: () => ({
      language: "en",
      setLanguage: async () => {},
      languages: [],
      t,
    }),
  };
});

vi.mock("../../context/ToastContext", () => {
  const showToast = vi.fn();
  return { useToast: () => ({ showToast }) };
});

import { invoke } from "@tauri-apps/api/core";

const STATUS = {
  dir: "C:/Users/x/AppData/com.gameindex.app",
  logPath: "C:/Users/x/AppData/com.gameindex.app/crash.log",
  logSizeBytes: 2048,
  logModifiedAt: 1700000000,
  hasLog: true,
  reports: [
    {
      name: "crash-2026-10-01_14-30-00.txt",
      path: "C:/Users/x/AppData/com.gameindex.app/crash-2026-10-01_14-30-00.txt",
      sizeBytes: 1024,
      modifiedAt: 1700000000,
    },
  ],
};

describe("DiagnosticsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "crashlog_status") return STATUS;
      if (cmd === "crashlog_read") return "GameIndex crash report — panic (test)";
      if (cmd === "get_system_info") {
        return { cpuName: "Test CPU", ramGb: 32, gpus: [] };
      }
      return null;
    });
  });

  it("lists dated reports and previews the selected log", async () => {
    render(<DiagnosticsTab />);

    await waitFor(() =>
      expect(
        screen.getByText("crash-2026-10-01_14-30-00.txt"),
      ).toBeDefined(),
    );
    expect(screen.getAllByText(/GameIndex crash report/).length).toBeGreaterThan(
      0,
    );
    // System report shows the detected hardware.
    expect(screen.getByText(/Test CPU/)).toBeDefined();
  });

  it("degrades to an empty state when the status call fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("backend unavailable"));
    render(<DiagnosticsTab />);

    await waitFor(() =>
      expect(screen.getByText("No crashes have been recorded.")).toBeDefined(),
    );
  });
});
