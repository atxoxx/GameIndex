import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("./tauri-core", () => ({
  isTauri: () => true,
  invoke: invokeMock,
}));

vi.mock("./tauri-event", () => ({
  listen: listenMock,
}));

import { check } from "./tauri-plugin-updater";

const sha = "a".repeat(64);

describe("electron updater shim", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("returns null when the main process reports no update", async () => {
    invokeMock.mockResolvedValue({ available: false });
    await expect(check()).resolves.toBeNull();
  });

  it("exposes a portable artifact through the platforms manifest", async () => {
    invokeMock.mockResolvedValue({
      available: true,
      version: "2.5.0",
      body: "notes",
      date: "2026-01-01T00:00:00Z",
      target: "windows-x86_64",
      portable: {
        url: "https://example.test/GameIndex_electron_2.5.0_x64_portable.exe",
        sha256: sha,
        sizeBytes: 1234,
        fileName: "GameIndex_electron_2.5.0_x64_portable.exe",
      },
    });

    const update = await check();
    expect(update?.version).toBe("2.5.0");
    const artifact = (
      update?.rawJson as {
        platforms: Record<string, { url: string; sha256: string; size: number }>;
      }
    ).platforms["windows-x86_64"];
    expect(artifact.url).toContain("_portable.exe");
    expect(artifact.sha256).toBe(sha);
    expect(artifact.size).toBe(1234);
  });

  it("downloads and installs through the main process, forwarding progress", async () => {
    let progressHandler: ((event: { payload: unknown }) => void) | null = null;
    listenMock.mockImplementation(
      async (_name: string, handler: (event: { payload: unknown }) => void) => {
        progressHandler = handler;
        return () => {};
      },
    );
    invokeMock.mockResolvedValueOnce({
      available: true,
      version: "2.5.0",
      target: "windows-x86_64-nsis",
    });
    invokeMock.mockResolvedValue(null);

    const update = await check();
    const events: unknown[] = [];
    await update?.downloadAndInstall((event) => events.push(event));

    const handler = progressHandler as unknown as
      | ((event: { payload: unknown }) => void)
      | null;
    handler?.({
      payload: { event: "Progress", data: { downloaded: 5, total: 10 } },
    });

    expect(invokeMock).toHaveBeenCalledWith("updater_download");
    expect(invokeMock).toHaveBeenCalledWith("updater_install");
    expect(events).toEqual([
      { event: "Progress", data: { downloaded: 5, total: 10 } },
    ]);
  });
});
