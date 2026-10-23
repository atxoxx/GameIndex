import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../context/LanguageContext";
import { SidebarGameItem } from "./SidebarGameItem";
import type { Game } from "../../types/game";

vi.mock("../../context/GameContext", () => ({
  useGames: () => ({
    updateGame: vi.fn(),
    enqueueEnrich: vi.fn(),
    getGame: vi.fn(),
  }),
  NO_IGDB_MATCH_SOURCE: "no-match",
}));

vi.mock("../../context/SteamGridDbContext", () => ({
  useSteamGridArt: () => null,
}));

vi.mock("../../hooks/useSharedViewportVisibility", () => ({
  useSharedViewportVisibility: () => {},
}));

vi.mock("../../utils/routePreload", () => ({
  preloadGameDetail: () => {},
}));

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1",
    name: "Elden Ring",
    path: "C:/Games/EldenRing/eldenring.exe",
    platform: "PC",
    installed: true,
    playTime: "41h",
    addedAt: 1,
    playStatus: "playing",
    igdbRating: 96,
    ...overrides,
  } as Game;
}

function renderRow(props: Partial<React.ComponentProps<typeof SidebarGameItem>> = {}) {
  return render(
    <LanguageProvider>
      <SidebarGameItem
        game={game()}
        isSelected={false}
        isRunning={false}
        isPinned={false}
        bulkSelected={false}
        searchQuery=""
        onPointerEnter={() => {}}
        onPointerLeave={() => {}}
        onQuickPlay={() => {}}
        onTogglePin={() => {}}
        {...props}
      />
    </LanguageProvider>,
  );
}

describe("SidebarGameItem", () => {
  it("shows the platform, playtime and rating on the fact line", () => {
    const { container } = renderRow();
    const meta = container.querySelector(".sidebar-game-meta");

    expect(meta).toBeInTheDocument();
    expect(meta?.textContent).toContain("PC");
    expect(meta?.textContent).toContain("41h");
    expect(meta?.querySelector(".sbn-meta--rating")?.textContent).toContain("96");
    expect(screen.getByText("Elden Ring")).toBeInTheDocument();
  });

  it("keeps the compact density to a single name line", () => {
    const { container } = renderRow({ density: "compact" });

    expect(container.querySelector(".sidebar-game-meta")).toBeNull();
    expect(container.querySelector(".sidebar-game-item--compact")).toBeInTheDocument();
  });

  it("swaps the play button for the running state on the art", () => {
    const { container } = renderRow({ isRunning: true });
    expect(container.querySelector(".sidebar-game-status.running")).toBeInTheDocument();
    expect(container.querySelector(".sidebar-game-play")).toBeNull();
  });

  it("keeps the pin affordance for pinned rows", () => {
    const { container } = renderRow({ isPinned: true });
    expect(container.querySelector(".sidebar-game-pin-btn.is-pinned")).toBeInTheDocument();
    expect(container.querySelector(".sidebar-game-item.is-pinned")).toBeInTheDocument();
  });
});
