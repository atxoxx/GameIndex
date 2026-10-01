import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  installCrashReporter,
  recordBreadcrumb,
  recordFrontendCrash,
  resetCrashReporterForTests,
} from "./crashReporter";

interface TauriWindow {
  __TAURI__?: unknown;
}

function setTauri(present: boolean): void {
  if (present) {
    (window as TauriWindow).__TAURI__ = {};
  } else {
    delete (window as TauriWindow).__TAURI__;
  }
}

describe("crashReporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCrashReporterForTests();
    setTauri(false);
  });

  afterEach(() => {
    setTauri(false);
  });

  it("forwards an error to crashlog_record when Tauri is present", () => {
    setTauri(true);
    recordFrontendCrash({ kind: "test", message: "kaboom" });

    expect(invoke).toHaveBeenCalledWith(
      "crashlog_record",
      expect.objectContaining({ kind: "test", message: "kaboom" }),
    );
  });

  it("no-ops without a Tauri host", () => {
    recordBreadcrumb("route", "/library");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("installs each global handler exactly once", () => {
    setTauri(true);
    const addSpy = vi.spyOn(window, "addEventListener");
    installCrashReporter();
    installCrashReporter();

    const registered = addSpy.mock.calls.filter(
      ([type]) => type === "error" || type === "unhandledrejection",
    );
    expect(registered.length).toBe(2);
    addSpy.mockRestore();
  });
});
