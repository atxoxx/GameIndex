import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  hydrated: false,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("./GameContext", () => ({
  useGames: () => ({ gamesHydrated: h.hydrated }),
}));

import { SetupWizardProvider, useSetupWizard } from "./SetupWizardContext";

const wrapper = ({ children }: { children: ReactNode }) => (
  <SetupWizardProvider>{children}</SetupWizardProvider>
);

describe("SetupWizardContext", () => {
  beforeEach(() => {
    h.hydrated = false;
    h.invoke.mockReset();
  });

  afterEach(() => {
    h.hydrated = false;
  });

  it("auto-opens on first launch once the library has hydrated (happy path)", async () => {
    h.invoke.mockResolvedValue({
      completed: false,
      skipped: false,
      version: 1,
      completedAtMs: null,
    });

    const { result, rerender } = renderHook(() => useSetupWizard(), { wrapper });
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("setup_get_state"));
    expect(result.current.isOpen).toBe(false);

    act(() => {
      h.hydrated = true;
    });
    rerender();

    await waitFor(() => expect(result.current.isOpen).toBe(true));
  });

  it("does not auto-open when the wizard was already completed", async () => {
    h.invoke.mockResolvedValue({
      completed: true,
      skipped: true,
      version: 1,
      completedAtMs: 1,
    });

    const { result, rerender } = renderHook(() => useSetupWizard(), { wrapper });
    await waitFor(() => expect(result.current.completed).toBe(true));

    act(() => {
      h.hydrated = true;
    });
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isOpen).toBe(false);
  });

  it("never auto-opens when loading the state fails (error path)", async () => {
    h.invoke.mockRejectedValue(new Error("no backend"));

    const { result, rerender } = renderHook(() => useSetupWizard(), { wrapper });
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("setup_get_state"));

    act(() => {
      h.hydrated = true;
    });
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.completed).toBe(false);
  });

  it("finishWizard persists completion and closes", async () => {
    h.invoke.mockResolvedValue({
      completed: false,
      skipped: false,
      version: 1,
      completedAtMs: null,
    });
    h.hydrated = true;

    const { result } = renderHook(() => useSetupWizard(), { wrapper });
    await waitFor(() => expect(result.current.isOpen).toBe(true));

    h.invoke.mockResolvedValue(undefined);
    act(() => {
      result.current.finishWizard();
    });

    expect(result.current.isOpen).toBe(false);
    expect(h.invoke).toHaveBeenCalledWith(
      "setup_set_state",
      expect.objectContaining({
        state: expect.objectContaining({ completed: true, skipped: false }),
      }),
    );
  });
});
