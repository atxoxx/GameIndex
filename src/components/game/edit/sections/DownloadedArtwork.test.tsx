import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

import { EditGameProvider, type EditGameController } from "../EditGameContext";
import { DownloadedArtwork } from "./DownloadedArtwork";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
  convertFileSrc: (path: string) => path,
}));
vi.mock("../../../../hooks/useFocusable", () => ({
  useFocusable: (handler?: () => void) => ({
    ref: () => undefined,
    tabIndex: 0,
    onClick: handler,
    onKeyDown: () => undefined,
  }),
}));
vi.mock("../../../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const invokeMock = vi.mocked(invoke);

const file = {
  fileKey: "artwork/g/cover.jpg",
  fileName: "cover.jpg",
  slot: "cover" as const,
  thumbnail: false,
  sizeBytes: 2048,
  modifiedAt: 1_700_000_000,
  url: "file:///tmp/artwork/g/cover.jpg",
  referenced: true,
  location: "current" as const,
};

function controller(overrides: Partial<EditGameController> = {}): EditGameController {
  return {
    t: (key: string) => key,
    game: { id: "g", name: "Game" },
    sizeUnit: "gb",
    artworkFilesVersion: 0,
    clearArtworkSlots: vi.fn(),
    ...overrides,
  } as unknown as EditGameController;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "list_game_artwork") return Promise.resolve([file]);
    if (cmd === "delete_game_artwork") {
      return Promise.resolve({ deleted: true, freedBytes: 2048, clearedSlots: ["cover"] });
    }
    return Promise.resolve([]);
  });
});

describe("DownloadedArtwork", () => {
  it("lists stored files and deletes the file plus its referenced slot", async () => {
    const clearArtworkSlots = vi.fn();
    render(
      <EditGameProvider controller={controller({ clearArtworkSlots })}>
        <DownloadedArtwork />
      </EditGameProvider>
    );

    expect(await screen.findByText("cover.jpg")).toBeInTheDocument();
    expect(screen.getByText("edit.artwork.inUse")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "edit.artwork.deleteFileAria" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("delete_game_artwork", {
        gameId: "g",
        fileKey: "artwork/g/cover.jpg",
      })
    );
    expect(clearArtworkSlots).toHaveBeenCalledWith(["cover"]);
    await waitFor(() => expect(screen.queryByText("cover.jpg")).not.toBeInTheDocument());
  });
});
