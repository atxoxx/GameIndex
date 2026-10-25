import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NotificationsWidget from "./NotificationsWidget";
import { useLanguage } from "../../../context/LanguageContext";

const { notificationState } = vi.hoisted(() => ({
  notificationState: {
    items: [
      {
        id: "achievement:game:a",
        kind: "achievement" as const,
        name: "First Steps",
        timestamp: 2_000,
      },
      {
        id: "download:dl1",
        kind: "download" as const,
        name: "Patch 1.2",
        timestamp: 1_000,
      },
    ],
    unread: [] as Array<{ id: string }>,
    markAllSeen: vi.fn(),
  },
}));

vi.mock("../overlayNotifications", () => ({
  useOverlayNotifications: () => ({
    items: notificationState.items,
    unread: notificationState.unread,
    unreadCount: notificationState.unread.length,
    markAllSeen: notificationState.markAllSeen,
  }),
}));
vi.mock("../../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));

const mockLanguage = vi.mocked(useLanguage);

describe("NotificationsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationState.unread = [];
    mockLanguage.mockReturnValue({
      t: (key: string) => key,
    } as unknown as ReturnType<typeof useLanguage>);
  });

  it("lists the feed in both chrome modes", () => {
    const { rerender } = render(<NotificationsWidget />);
    expect(screen.getByText("overlay.widget.notifications")).toBeInTheDocument();
    expect(screen.getByText("overlay.notifications.unlocked")).toBeInTheDocument();
    expect(
      screen.getByText("overlay.notifications.downloadDone"),
    ).toBeInTheDocument();

    rerender(<NotificationsWidget bare />);
    expect(
      screen.queryByText("overlay.widget.notifications"),
    ).toBeNull();
  });

  it("shows the unread toolbar and marks everything read", () => {
    notificationState.unread = [{ id: "achievement:game:a" }];
    render(<NotificationsWidget bare />);

    expect(screen.getByText("overlay.notifications.unread")).toBeInTheDocument();
    fireEvent.click(screen.getByText("overlay.notifications.markAllRead"));
    expect(notificationState.markAllSeen).toHaveBeenCalledTimes(1);
  });

  it("falls back to the empty state", () => {
    notificationState.items = [];
    render(<NotificationsWidget bare />);
    expect(screen.getByText("overlay.notifications.empty")).toBeInTheDocument();
    notificationState.items = [
      {
        id: "achievement:game:a",
        kind: "achievement",
        name: "First Steps",
        timestamp: 2_000,
      },
      {
        id: "download:dl1",
        kind: "download",
        name: "Patch 1.2",
        timestamp: 1_000,
      },
    ];
  });
});
