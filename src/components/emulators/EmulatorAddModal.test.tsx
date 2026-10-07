import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import EmulatorAddModal from "./EmulatorAddModal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ hostPlatform: "windows", isLinuxHost: false }),
}));

const invokeMock = vi.mocked(invoke);

function renderModal(emulators: Parameters<typeof EmulatorAddModal>[0]["emulators"]) {
  return render(
    <EmulatorAddModal
      emulators={emulators}
      onClose={() => {}}
      onAddDiscovered={() => {}}
      onConfigureKnown={() => {}}
      onCustom={() => {}}
      onOpenDownload={() => {}}
    />,
  );
}

describe("EmulatorAddModal discovery", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("auto-scans once and re-scans when Find emulators is clicked", async () => {
    invokeMock.mockResolvedValue([]);
    renderModal([]);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("discover_emulators"));
    expect(invokeMock).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "emulators.discovery.scan" }),
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  });

  it("lists discovered emulators", async () => {
    invokeMock.mockResolvedValue([
      {
        key: "dolphin",
        name: "Dolphin",
        platform: "GameCube",
        executablePath: "C:/emu/Dolphin.exe",
        executableName: "Dolphin.exe",
      },
    ]);
    renderModal([]);

    await waitFor(() => expect(screen.getByText("Dolphin")).toBeInTheDocument());
  });

  it("shows an error when discovery fails", async () => {
    invokeMock.mockRejectedValue(new Error("scan failed"));
    renderModal([]);

    await waitFor(() => expect(screen.getByText(/scan failed/)).toBeInTheDocument());
  });
});
