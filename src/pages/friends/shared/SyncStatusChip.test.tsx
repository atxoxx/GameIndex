import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render } from "@testing-library/react";
import type { FriendsSyncPhase } from "../../../sync/friends/engine";
import { SyncStatusChip } from "./SyncStatusChip";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const noop = () => {};

function renderChip(overrides: Partial<ComponentProps<typeof SyncStatusChip>> = {}) {
  return render(
    <SyncStatusChip
      phase="online"
      lastSyncedTime="14:02"
      onSyncNow={noop}
      onOpenDiagnostics={noop}
      {...overrides}
    />,
  );
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

    fireEvent.click(popover!.querySelectorAll(".friends-sync__action")[1] as HTMLElement);
    expect(onOpenDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("shows the last sync time and the engine's own message", () => {
    const { container, getByTitle } = renderChip({
      phase: "degraded",
      lastMessage: "friendsPage.upToDatePublished",
    });

    fireEvent.click(getByTitle("friendsPage.syncAndSharing"));

    expect(container.textContent).toContain("14:02");
    expect(container.textContent).toContain("friendsPage.upToDatePublished");
  });
});
