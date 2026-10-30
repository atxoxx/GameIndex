import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StoreInstallBar from "./StoreInstallBar";
import type { StoreInstall } from "../../types/storeInstalls";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "storeInstall.starting": "Starting…",
        "storeInstall.downloading": "Downloading…",
        "storeInstall.downloadingPercent": "Downloading · {percent}%",
        "storeInstall.updating": "Updating…",
        "storeInstall.updatingPercent": "Updating · {percent}%",
        "storeInstall.installing": "Installing…",
        "storeInstall.installingPercent": "Installing · {percent}%",
      };
      const template = dict[key] ?? key;
      return template.replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ""));
    },
  }),
}));

function entry(overrides: Partial<StoreInstall> = {}): StoreInstall {
  return {
    key: "steam:440",
    gameId: "g1",
    source: "steam",
    appId: "440",
    title: "Team Fortress 2",
    state: "downloading",
    percent: 42,
    downloaded: 420,
    total: 1000,
    speed: 2_000_000,
    eta: 300,
    ...overrides,
  };
}

afterEach(cleanup);

describe("StoreInstallBar", () => {
  it("shows the percentage and the transfer rate for a running download", () => {
    render(<StoreInstallBar entry={entry()} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveTextContent("Downloading · 42%");
  });

  it("falls back to an indeterminate bar when the store reports no progress", () => {
    render(<StoreInstallBar entry={entry({ state: "pending", percent: null, speed: null, eta: null })} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveTextContent("Starting…");
  });

  it("calls an installed game's transfer an update", () => {
    render(<StoreInstallBar entry={entry()} updating />);
    expect(screen.getByRole("progressbar")).toHaveTextContent("Updating · 42%");
  });
});
