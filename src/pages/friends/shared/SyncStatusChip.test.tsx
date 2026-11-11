import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render } from "@testing-library/react";
import type { FriendsSyncPhase } from "../../../sync/friends/engine";
import { SyncStatusChip } from "./SyncStatusChip";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));

const noop = () => {};

function chip(overrides: Partial<ComponentProps<typeof SyncStatusChip>> = {}) {
  return (
    <SyncStatusChip
      phase="online"
      lastSyncedTime="14:02"
      onSyncNow={noop}
      onOpenDiagnostics={noop}
      {...overrides}
    />
  );
}

function renderChip(overrides: Partial<ComponentProps<typeof SyncStatusChip>> = {}) {
  return render(chip(overrides));
}

const PHASE_LABEL: Record<FriendsSyncPhase, string> = {
  idle: "friendsPage.syncPhaseIdle",
  connecting: "friendsPage.syncPhaseConnecting",
  online: "friendsPage.syncPhaseOnline",
  degraded: "friendsPage.syncPhaseDegraded",
  offline: "friendsPage.syncPhaseOffline",
};

describe("SyncStatusChip", () => {
  beforeEach(() => {
    localStorage.clear();
    showToast.mockClear();
  });

  it.each(Object.entries(PHASE_LABEL) as [FriendsSyncPhase, string][])(
    "reports the %s phase from the engine status",
    (phase, label) => {
      const { container } = renderChip({ phase });

      expect(container.querySelector(".friends-sync__label")?.textContent).toBe(label);
      expect(container.querySelector(".friends-sync__dot")?.className).toContain(`is-${phase}`);
    },
  );

  it("reads as still working while changes are queued", () => {
    const { container } = renderChip({ phase: "online", pendingPublish: 3 });

    // An online relay with local work left is not "up to date" yet.
    expect(container.querySelector(".friends-sync__label")?.textContent).toBe(
      "friendsPage.syncPhaseConnecting",
    );
    expect(container.querySelector(".friends-sync__pending")?.textContent).toBe("3");
  });

  it("opens the popover with the share scope and the manual sync action", () => {
    const onSyncNow = vi.fn();
    const onOpenDiagnostics = vi.fn();
    const { container, getByTitle } = renderChip({ onSyncNow, onOpenDiagnostics });

    fireEvent.click(getByTitle("friendsPage.syncAndSharing"));

    const popover = container.querySelector(".friends-sync__popover");
    expect(popover).not.toBeNull();
    // The engine always publishes, so only the two real scopes are offered.
    const scopes = Array.from(popover!.querySelectorAll('[role="radio"]')).map((el) => el.textContent);
    expect(scopes).toEqual(["friendsPage.nostrScopeCore", "friendsPage.nostrScopeFull"]);

    fireEvent.click(popover!.querySelector(".friends-sync__action.is-primary") as HTMLElement);
    expect(onSyncNow).toHaveBeenCalledTimes(1);

    fireEvent.click(popover!.querySelector(".friends-sync__action.is-secondary") as HTMLElement);
    expect(onOpenDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("shows the meaning in the header and only the phase plus time in the meta row", () => {
    const { container, getByTitle } = renderChip({
      phase: "degraded",
      lastMessage: "friendsPage.syncStateRelaysUnanswered",
    });

    fireEvent.click(getByTitle("friendsPage.syncAndSharing"));

    const subtitle = container.querySelector(".friends-sync__subtitle");
    expect(subtitle?.textContent).toBe("friendsPage.syncStateRelaysUnanswered");

    const meta = container.querySelector(".friends-sync__meta");
    expect(meta?.textContent).toContain("friendsPage.syncPhaseDegraded");
    expect(meta?.textContent).toContain("friendsPage.lastSynced");
    expect(meta?.textContent).toContain("14:02");
  });

  it("falls back to what the phase means when no message is supplied", () => {
    const { container, getByTitle } = renderChip({ phase: "offline" });

    fireEvent.click(getByTitle("friendsPage.syncAndSharing"));

    expect(container.querySelector(".friends-sync__subtitle")?.textContent).toBe(
      "friendsPage.syncStateOffline",
    );
  });

  it("disables the sync button and spins while a manual pass runs", () => {
    const { container, getByTitle } = renderChip({ manualSync: "running" });

    fireEvent.click(getByTitle("friendsPage.syncAndSharing"));

    const primary = container.querySelector(".friends-sync__action.is-primary") as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.querySelector(".friends-spin")).not.toBeNull();
    expect(container.querySelector(".friends-sync__subtitle")?.textContent).toBe(
      "friendsPage.syncStateRunning",
    );
  });

  it.each([
    ["ok", "friendsPage.syncNowToastOk", "success"],
    ["partial", "friendsPage.syncNowToastPartial", "info"],
    ["failed", "friendsPage.syncNowToastFailed", "error"],
  ] as const)("toasts when a pass finishes as %s", (outcome, key, type) => {
    const { rerender } = renderChip({ manualSync: "running" });

    rerender(chip({ manualSync: outcome }));

    expect(showToast).toHaveBeenCalledWith(key, type);
  });

  it("stays quiet when it mounts on an already finished pass", () => {
    renderChip({ manualSync: "ok" });

    expect(showToast).not.toHaveBeenCalled();
  });
});
