import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EmulatorsPage from "./EmulatorsPage";
import type { Emulator } from "../types/emulator";
import type { Game } from "../types/game";

const emulators: Emulator[] = [
  {
    id: "pcsx2",
    name: "PCSX2",
    platform: "PlayStation 2",
    executablePath: "C:/emu/pcsx2.exe",
    argumentsTemplate: '"%ROM%"',
    romFolder: "D:/Roms/PS2",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "dolphin",
    name: "Dolphin",
    platform: "GameCube",
    executablePath: "C:/emu/dolphin.exe",
    argumentsTemplate: '"%ROM%"',
    romFolder: "D:/Roms/GC",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "emu/#special",
    name: "Special System",
    platform: "Arcade",
    executablePath: "C:/emu/special.exe",
    argumentsTemplate: '"%ROM%"',
    romFolder: "D:/Roms/Arcade",
    createdAt: 0,
    updatedAt: 0,
  },
];

const roms: Game[] = [
  {
    id: "rom-1",
    name: "Final Fantasy X",
    path: "C:/emu/pcsx2.exe",
    platform: "PlayStation 2",
    installed: true,
    playTime: "12h",
    addedAt: 0,
    emulatorId: "pcsx2",
    romPath: "D:/Roms/PS2/FFX.iso",
    romGroup: "Final Fantasy X",
    romDisc: 1,
    sizeBytes: 1024,
  },
  {
    id: "rom-2",
    name: "Final Fantasy X Disc 2",
    path: "C:/emu/pcsx2.exe",
    platform: "PlayStation 2",
    installed: true,
    playTime: "0h",
    addedAt: 0,
    emulatorId: "pcsx2",
    romPath: "D:/Roms/PS2/FFX Disc 2.iso",
    romGroup: "Final Fantasy X",
    romDisc: 2,
    sizeBytes: 1024,
  },
];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "list_emulators") return Promise.resolve(emulators);
    return Promise.resolve(null);
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));

vi.mock("../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../context/SettingsContext", () => ({
  useSettings: () => ({ hostPlatform: "windows" }),
}));
vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("../context/GameContext", () => ({
  useGames: () => ({
    games: roms,
    addGame: vi.fn(),
    updateGame: vi.fn(),
    removeGames: vi.fn(),
    launchGame: vi.fn(),
    runningGameIds: [],
  }),
}));
vi.mock("../components/PageWidget", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../hooks/useFocusable", () => ({
  useFocusable: (onActivate: () => void) => ({
    ref: () => {},
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: () => {},
  }),
}));

function renderPage(initial = "/emulators/pcsx2") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/emulators" element={<EmulatorsPage />} />
        <Route path="/emulators/:emulatorId" element={<EmulatorsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe("EmulatorsPage workbench", () => {
  it("shows the selected system, workspace tabs and one card per disc set", async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText("PCSX2").length).toBeGreaterThan(0));
    expect(screen.getByRole("tab", { name: /emulators.tab.library/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /emulators.tab.firmware/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /emulators.tab.health/ })).toBeTruthy();

    // Two disc files, one card: the representative title appears, disc 2 does not.
    await waitFor(() =>
      expect(screen.getAllByText("Final Fantasy X").length).toBeGreaterThan(0)
    );
    expect(screen.queryByText("Final Fantasy X Disc 2")).toBeNull();
  });

  it("switches to another system when its rail row is clicked", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText("PCSX2").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("option", { name: /Dolphin/ }));

    await waitFor(() =>
      expect(document.querySelector(".emu-wb-title")?.textContent).toBe("Dolphin")
    );
  });

  it("switches when the page was opened without an :id in the URL", async () => {
    localStorage.clear();
    renderPage("/emulators");
    await waitFor(() => expect(document.querySelector(".emu-wb-title")).toBeTruthy());

    fireEvent.click(screen.getByRole("option", { name: /PCSX2/ }));

    await waitFor(() =>
      expect(document.querySelector(".emu-wb-title")?.textContent).toBe("PCSX2")
    );
  });

  it("switches to a system whose id needs URL encoding", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText("PCSX2").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("option", { name: /Special System/ }));

    await waitFor(() =>
      expect(document.querySelector(".emu-wb-title")?.textContent).toBe("Special System")
    );
  });
});
