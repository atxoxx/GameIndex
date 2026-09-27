import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { ToastProvider, useToast } from "./ToastContext";

const { playNotificationSoundMock } = vi.hoisted(() => ({
  playNotificationSoundMock: vi.fn(),
}));

vi.mock("../utils/soundEffects", () => ({
  playNotificationSound: playNotificationSoundMock,
}));

vi.mock("./LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

let showToast: (message: string, type: "success" | "error" | "info" | "warning") => void;

function Harness() {
  ({ showToast } = useToast());
  return null;
}

function messages(): string[] {
  return screen.queryAllByText(/./).map((el) => el.textContent ?? "");
}

function toastMessages(): string[] {
  return screen
    .queryAllByText(/./)
    .filter((el) => el.classList.contains("toast-message"))
    .map((el) => el.textContent ?? "");
}

beforeEach(() => {
  playNotificationSoundMock.mockClear();
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("shows distinct toasts and dismisses them after the timeout", () => {
    vi.useFakeTimers();
    act(() => showToast("Imported 4 games", "success"));
    expect(toastMessages()).toEqual(["Imported 4 games"]);

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("Imported 4 games")).toBeNull();
  });

  it("collapses duplicate message+type pairs into a single toast", () => {
    act(() => showToast("Steam sync finished", "info"));
    act(() => showToast("Steam sync finished", "info"));
    act(() => showToast("Steam sync finished", "info"));

    expect(toastMessages()).toEqual(["Steam sync finished"]);
    expect(playNotificationSoundMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the same message as separate toasts when the type differs", () => {
    act(() => showToast("Launch failed", "error"));
    act(() => showToast("Launch failed", "warning"));

    expect(toastMessages()).toEqual(["Launch failed", "Launch failed"]);
  });

  it("restarts the countdown when a duplicate arrives", () => {
    vi.useFakeTimers();
    act(() => showToast("Download complete", "success"));

    act(() => vi.advanceTimersByTime(3000));
    act(() => showToast("Download complete", "success"));
    // Still visible past the original expiry — the re-arm pushed it out.
    act(() => vi.advanceTimersByTime(3000));
    expect(toastMessages()).toEqual(["Download complete"]);

    act(() => vi.advanceTimersByTime(1000));
    expect(toastMessages()).toEqual([]);
  });

  it("never shows more than three toasts, dropping the oldest first", () => {
    act(() => showToast("one", "info"));
    act(() => showToast("two", "info"));
    act(() => showToast("three", "info"));
    act(() => showToast("four", "info"));

    expect(toastMessages()).toEqual(["two", "three", "four"]);

    act(() => showToast("five", "info"));
    expect(toastMessages()).toEqual(["three", "four", "five"]);
  });

  it("keeps a duplicate within the cap from pushing a toast out", () => {
    act(() => showToast("one", "info"));
    act(() => showToast("two", "info"));
    act(() => showToast("one", "info"));

    expect(toastMessages()).toEqual(["one", "two"]);
  });

  it("dismisses a toast from its close button", () => {
    act(() => showToast("dismiss me", "error"));
    const [closeButton] = screen.getAllByLabelText("toast.dismiss");
    act(() => {
      closeButton.click();
    });

    expect(toastMessages()).toEqual([]);
    expect(messages().some((m) => m.includes("dismiss me"))).toBe(false);
  });
});
