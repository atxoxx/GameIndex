import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RemoteModDetailModal from "./RemoteModDetailModal";
import type { RemoteModDetail, RemoteModFile, RemoteModSummary } from "../../../types/mods";

const { invokeMock, openUrlMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

function summary(overrides: Partial<RemoteModSummary> = {}): RemoteModSummary {
  return {
    source: "workshop",
    id: "426629791",
    name: "Test Workshop Mod",
    url: "https://steamcommunity.com/sharedfiles/filedetails/?id=426629791",
    ...overrides,
  };
}

function file(overrides: Partial<RemoteModFile> = {}): RemoteModFile {
  return {
    id: "426629791",
    name: "mod.pak",
    isPrimary: true,
    downloadKind: "steam",
    ...overrides,
  };
}

function detail(overrides: Partial<RemoteModDetail> = {}): RemoteModDetail {
  return {
    summary: summary(),
    gallery: [],
    files: [file()],
    ...overrides,
  };
}

function renderModal(source: string, s: RemoteModSummary) {
  return render(
    <RemoteModDetailModal
      open
      gameId="game-1"
      source={source}
      externalId="730"
      summary={s}
      onClose={() => {}}
      onInstalled={() => {}}
    />,
  );
}

describe("RemoteModDetailModal Steam action", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a workshop item in the Steam client", async () => {
    invokeMock.mockResolvedValue(detail());
    renderModal("workshop", summary());

    const button = await screen.findByLabelText("mods.discover.openInSteam");
    fireEvent.click(button);

    await waitFor(() =>
      expect(openUrlMock).toHaveBeenCalledWith(
        "steam://url/CommunityFilePage/426629791",
      ),
    );
  });

  it("hides the Steam action for non-workshop sources", async () => {
    invokeMock.mockResolvedValue(
      detail({ summary: summary({ source: "nexus" }), files: [file({ downloadKind: "direct" })] }),
    );
    renderModal("nexus", summary({ source: "nexus" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(screen.queryByLabelText("mods.discover.openInSteam")).toBeNull();
  });

  it("shows the Premium hint to a free Nexus account", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "nexus_premium_status") return Promise.resolve(false);
      return Promise.resolve(
        detail({ summary: summary({ source: "nexus" }), files: [file({ downloadKind: "external" })] }),
      );
    });
    renderModal("nexus", summary({ source: "nexus" }));

    fireEvent.click(await screen.findByText("mods.discover.tabFiles"));
    expect(await screen.findByText("mods.discover.premiumNotice")).toBeTruthy();
  });

  it("hides the Premium hint from a Premium account", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "nexus_premium_status") return Promise.resolve(true);
      return Promise.resolve(
        detail({ summary: summary({ source: "nexus" }), files: [file({ downloadKind: "direct" })] }),
      );
    });
    renderModal("nexus", summary({ source: "nexus" }));

    fireEvent.click(await screen.findByText("mods.discover.tabFiles"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("nexus_premium_status"),
    );
    expect(screen.queryByText("mods.discover.premiumNotice")).toBeNull();
  });
});
