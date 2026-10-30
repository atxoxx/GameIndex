import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { StoreInstall } from "../../types/storeInstalls";

const state = vi.hoisted(() => ({ transfers: [] as StoreInstall[] }));

vi.mock("../../hooks/useStoreInstalls", () => ({
  useStoreInstalls: () => state.transfers,
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "storeInstall.sectionTitle": "Store installs",
        "storeInstall.sectionHint": "Handled by Steam or Epic.",
        "storeInstall.openStore": "Open {store}",
        "storeInstall.starting": "Starting…",
        "storeInstall.downloading": "Downloading…",
        "storeInstall.downloadingPercent": "Downloading · {percent}%",
        "storeInstall.installing": "Installing…",
        "storeInstall.installingPercent": "Installing · {percent}%",
      };
      return (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ""));
    },
  }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

import StoreInstallsSection from "./StoreInstallsSection";

function entry(overrides: Partial<StoreInstall> = {}): StoreInstall {
  return {
    key: "steam:440",
    gameId: "g1",
    source: "steam",
    appId: "440",
    title: "Hades",
    state: "downloading",
    percent: 42,
    downloaded: 420,
    total: 1000,
    speed: 2_000_000,
    eta: 300,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  state.transfers = [];
});

describe("StoreInstallsSection", () => {
  it("lists each transfer with one action per store", () => {
    state.transfers = [entry(), entry({ key: "steam:570", gameId: "g2", title: "Dota 2" })];
    render(<StoreInstallsSection />);

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Dota 2")).toBeInTheDocument();
    expect(screen.getByText("Hades")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Open Steam/ })).toHaveLength(1);
    expect(screen.getAllByText("Downloading · 42%")).toHaveLength(2);
  });

  it("renders nothing while no store is transferring", () => {
    state.transfers = [];
    const { container } = render(<StoreInstallsSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
