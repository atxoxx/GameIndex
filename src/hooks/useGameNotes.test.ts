import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGameNotes } from "./useGameNotes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

function enableTauriRuntime() {
  Object.defineProperty(window, "__TAURI__", {
    value: {},
    configurable: true,
  });
}

function disableTauriRuntime() {
  delete (window as { __TAURI__?: unknown }).__TAURI__;
}

describe("useGameNotes (localStorage fallback)", () => {
  beforeEach(() => {
    localStorage.clear();
    disableTauriRuntime();
    mockedInvoke.mockReset();
  });

  it("creates, updates and deletes notes without the Tauri bridge", async () => {
    const { result } = renderHook(() => useGameNotes("game-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let createdId = "";
    await act(async () => {
      const created = await result.current.createNote({
        title: "Boss route",
        content: "Phase 1",
        tags: ["guide"],
      });
      createdId = created?.id ?? "";
    });
    expect(createdId).not.toBe("");
    expect(result.current.notes).toHaveLength(1);

    await act(async () => {
      await result.current.updateNote({
        ...result.current.notes[0],
        content: "Phase 2",
        pinned: true,
      });
    });
    expect(result.current.notes[0].content).toBe("Phase 2");
    expect(result.current.notes[0].pinned).toBe(true);

    const stored = JSON.parse(localStorage.getItem("gamelib-game-notes") ?? "{}");
    expect(stored["game-1"]).toHaveLength(1);
    expect(stored["game-1"][0].content).toBe("Phase 2");

    await act(async () => {
      await result.current.deleteNote(createdId);
    });
    expect(result.current.notes).toHaveLength(0);
  });

  it("migrates the legacy games.notes string exactly once", async () => {
    const onMigrated = vi.fn();
    const { result } = renderHook(() =>
      useGameNotes("game-2", "## Old journal\nFound the sword.", onMigrated),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].content).toBe("## Old journal\nFound the sword.");
    expect(result.current.notes[0].title).toBe("Old journal");
    expect(onMigrated).toHaveBeenCalledTimes(1);
  });

  it("does not migrate when the game already has notes", async () => {
    localStorage.setItem(
      "gamelib-game-notes",
      JSON.stringify({
        "game-3": [
          {
            id: "existing",
            gameId: "game-3",
            title: "Existing",
            content: "Keep me",
            tags: [],
            pinned: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );
    const onMigrated = vi.fn();
    const { result } = renderHook(() =>
      useGameNotes("game-3", "legacy text", onMigrated),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].title).toBe("Existing");
    expect(onMigrated).not.toHaveBeenCalled();
  });
});

describe("useGameNotes (Tauri bridge)", () => {
  beforeEach(() => {
    localStorage.clear();
    enableTauriRuntime();
    mockedInvoke.mockReset();
  });

  it("rolls back the optimistic note when the backend rejects the save", async () => {
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "load_game_notes") return Promise.resolve([]);
      return Promise.reject(new Error("disk full"));
    });

    const { result } = renderHook(() => useGameNotes("game-4"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const created = await result.current.createNote({ title: "Draft", content: "" });
      expect(created).toBeNull();
    });
    expect(result.current.notes).toHaveLength(0);
  });

  it("keeps the normalized row returned by the backend", async () => {
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "load_game_notes") return Promise.resolve([]);
      if (command === "save_game_note") {
        return Promise.resolve({
          id: "server-id",
          gameId: "game-5",
          title: "Server title",
          content: "Body",
          tags: [],
          pinned: false,
          createdAt: 111,
          updatedAt: 222,
        });
      }
      return Promise.resolve(0);
    });

    const { result } = renderHook(() => useGameNotes("game-5"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createNote({ title: "Draft", content: "Body" });
    });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].id).toBe("server-id");
    expect(result.current.notes[0].createdAt).toBe(111);
  });
});
