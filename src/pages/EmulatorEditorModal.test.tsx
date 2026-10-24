import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EmulatorEditorModal from "./EmulatorEditorModal";
import type { Emulator } from "../types/emulator";

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));
vi.mock("../context/SettingsContext", () => ({
  useSettings: () => ({ hostPlatform: "windows", isLinuxHost: false }),
}));
vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const emulator: Emulator = {
  id: "pcsx2",
  name: "PCSX2",
  platform: "PlayStation 2",
  executablePath: "C:/emu/pcsx2.exe",
  argumentsTemplate: '"%ROM%"',
  romFolder: "D:/Roms/PS2",
  createdAt: 0,
  updatedAt: 0,
};

function renderModal(overrides: Partial<Emulator> = {}) {
  const onSaved = vi.fn();
  render(
    <EmulatorEditorModal
      emulator={{ ...emulator, ...overrides }}
      onClose={vi.fn()}
      onSaved={onSaved}
    />
  );
  return { onSaved };
}

afterEach(() => {
  cleanup();
  invoke.mockClear();
});

describe("EmulatorEditorModal", () => {
  it("groups the form into sections and previews the launch command", () => {
    renderModal();
    expect(screen.getByText("emulators.editor.section.identity")).toBeTruthy();
    expect(screen.getByText("emulators.editor.section.application")).toBeTruthy();
    expect(screen.getByText("emulators.editor.section.library")).toBeTruthy();
    expect(screen.getByText("emulators.editor.section.firmware")).toBeTruthy();
    expect(screen.getByTitle(/pcsx2\.exe/)).toBeTruthy();
  });

  it("saves a complete emulator", async () => {
    const { onSaved } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /emulators.editor.save/ }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
  });

  it("blocks saving and names the missing field when the ROM folder is empty", () => {
    renderModal({ romFolder: "" });
    expect(screen.getByText(/emulators.editor.missingList/)).toBeTruthy();
    const save = screen.getByRole("button", { name: /emulators.editor.save/ });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.click(save);
    expect(invoke).not.toHaveBeenCalled();
  });
});
