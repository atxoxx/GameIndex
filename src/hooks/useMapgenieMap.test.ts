import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMapgenieMap } from "./useMapgenieMap";
import type { MapgenieGame } from "../types/game";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const sample: MapgenieGame = {
  slug: "elden-ring",
  title: "Elden Ring",
  url: "https://mapgenie.io/elden-ring/maps/the-lands-between",
  image: "https://media.mapgenie.io/elden-ring.jpg",
  maps: [
    {
      title: "The Lands Between",
      slug: "the-lands-between",
      url: "https://mapgenie.io/elden-ring/maps/the-lands-between",
    },
  ],
};

describe("useMapgenieMap", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("reports a found match with the backend payload", async () => {
    invokeMock.mockResolvedValue(sample);

    const { result } = renderHook(() => useMapgenieMap("Elden Ring"));

    await waitFor(() => expect(result.current.status).toBe("found"));
    expect(result.current.data).toEqual(sample);
    expect(invokeMock).toHaveBeenCalledWith("fetch_mapgenie_map", {
      gameName: "Elden Ring",
    });
  });

  it("reports missing when MapGenie has no match", async () => {
    invokeMock.mockResolvedValue(null);

    const { result } = renderHook(() => useMapgenieMap("Some Obscure Game"));

    await waitFor(() => expect(result.current.status).toBe("missing"));
    expect(result.current.data).toBeNull();
  });

  it("treats a failed lookup as missing instead of throwing", async () => {
    invokeMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useMapgenieMap("Elden Ring"));

    await waitFor(() => expect(result.current.status).toBe("missing"));
    expect(result.current.data).toBeNull();
  });

  it("never queries the backend for a blank name", () => {
    const { result } = renderHook(() => useMapgenieMap("   "));

    expect(result.current.status).toBe("missing");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
