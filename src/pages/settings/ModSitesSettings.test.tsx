import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

import { invoke } from "@tauri-apps/api/core";
import ModSitesSettings from "./ModSitesSettings";

const SOURCES = [
  {
    id: "nexus",
    name: "Nexus Mods",
    homepage: "https://www.nexusmods.com",
    requiresCredential: true,
    hasCredential: true,
    available: false,
    directDownload: true,
    supportsSearch: false,
  },
  {
    id: "curseforge",
    name: "CurseForge",
    homepage: "https://www.curseforge.com",
    requiresCredential: true,
    hasCredential: false,
    available: false,
    directDownload: true,
    supportsSearch: true,
  },
  {
    id: "modio",
    name: "mod.io",
    homepage: "https://mod.io",
    requiresCredential: true,
    hasCredential: false,
    available: false,
    directDownload: true,
    supportsSearch: true,
  },
  {
    id: "workshop",
    name: "Steam Workshop",
    homepage: "https://steamcommunity.com/workshop",
    requiresCredential: true,
    hasCredential: false,
    available: false,
    directDownload: false,
    supportsSearch: true,
  },
  {
    id: "thunderstore",
    name: "Thunderstore",
    homepage: "https://thunderstore.io",
    requiresCredential: false,
    hasCredential: false,
    available: false,
    directDownload: true,
    supportsSearch: true,
  },
];

describe("ModSitesSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "mods_source_status") return SOURCES;
      return null;
    });
  });

  it("lists key-based sites and saves a pasted key", async () => {
    render(<ModSitesSettings />);

    await waitFor(() => expect(screen.getByText("CurseForge")).toBeDefined());
    // A configured source is masked, so only the two unset keys show the prompt.
    expect(screen.getByText("Steam Workshop")).toBeDefined();
    expect(screen.queryByText("Thunderstore")).toBeNull();

    fireEvent.change(screen.getByLabelText("CurseForge mods.source.apiKey"), {
      target: { value: "cf-key" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "mods.source.save CurseForge" }),
    );

    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "mods_source_set_credential",
        { source: "curseforge", key: "cf-key" },
      ),
    );
    expect(showToastMock).toHaveBeenCalledWith("mods.source.keySaved", "success");
  });

  it("reports an error when saving a key fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "mods_source_status") return SOURCES;
      if (cmd === "mods_source_set_credential") throw new Error("keychain locked");
      return null;
    });

    render(<ModSitesSettings />);
    await screen.findByLabelText("mod.io mods.source.apiKey");

    fireEvent.change(screen.getByLabelText("mod.io mods.source.apiKey"), {
      target: { value: "bad-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "mods.source.save mod.io" }));

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        expect.stringContaining("keychain locked"),
        "error",
      ),
    );
  });
});
