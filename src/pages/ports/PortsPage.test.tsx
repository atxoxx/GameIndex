import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { PortProject, PortsCatalog } from "../../types/port";
import PortsPage from "./PortsPage";

const catalog = vi.hoisted((): PortsCatalog => {
  const project = (overrides: Partial<PortProject>): PortProject => ({
    id: "id",
    game: "Game",
    portName: "Project",
    origin: "Recompilation",
    status: "Playable",
    languages: "C++",
    realRating: null,
    notes: "",
    platform: "Nintendo 64",
    group: "Nintendo",
    links: [{ label: "Project", url: "https://github.com/example/project", kind: "github" }],
    source: "pcgamingwiki",
    sourceUrl: "https://www.pcgamingwiki.com/wiki/List_of_unofficial_ports",
    sources: [
      {
        id: "pcgamingwiki",
        name: "PCGamingWiki",
        url: "https://www.pcgamingwiki.com/wiki/List_of_unofficial_ports",
      },
    ],
    platforms: [],
    stars: null,
    communityRating: null,
    targets: [],
    ...overrides,
  });
  return {
    source: "Merged from PCGamingWiki",
    fetchedAt: Date.now(),
    stale: false,
    sources: [
      {
        id: "pcgamingwiki",
        name: "PCGamingWiki",
        url: "https://www.pcgamingwiki.com/wiki/List_of_unofficial_ports",
        count: 3,
        ok: true,
        fetchedAt: Date.now(),
      },
    ],
    projects: [
      project({ id: "a", game: "Zelda 64", portName: "Zelda64Recomp" }),
      project({
        id: "b",
        game: "Super Mario World",
        portName: "smw",
        platform: "SNES",
        group: "Nintendo",
        origin: "Decompilation",
        status: "Development",
        sources: [
          { id: "gameport", name: "gameport.games", url: "https://gameport.games/projects/smw" },
        ],
        platforms: ["Windows", "Linux"],
        stars: 1234,
        communityRating: 4.5,
      }),
      project({
        id: "c",
        game: "Zelda 64",
        portName: "Zelda 64 Recompiled",
        origin: "Decompilation",
        status: "Development",
      }),
    ],
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "get_ports_catalog") return catalog;
    if (cmd === "refresh_ports_catalog") return catalog;
    if (cmd === "get_ports_sync_status") {
      return { active: false, current: null, done: 0, total: 0, merged: 0, startedAt: null };
    }
    if (cmd === "get_port_cover") {
      return { url: null, thumbUrl: null, fallbackUrl: null, source: null };
    }
    if (cmd === "get_port_readme") {
      return {
        markdown: "# Project README\n\nA native port.",
        sourceUrl: String(args?.url ?? ""),
        repo: {
          host: "github",
          owner: "example",
          repo: "project",
          url: "https://github.com/example/project",
          description: "A native port.",
          stars: 1200,
          language: "C++",
          updatedAt: "2026-01-01T00:00:00Z",
          license: "MIT",
          topics: ["n64"],
          homepage: null,
          openIssues: 3,
        },
      };
    }
    return null;
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string) => key,
  }),
}));

vi.mock("../../components/PageWidget", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

async function renderPage() {
  render(<PortsPage />);
  await screen.findByText("Zelda 64");
}

beforeEach(() => {
  localStorage.clear();
});

describe("PortsPage", () => {
  it("renders one card per game with origin, status and project count", async () => {
    await renderPage();

    expect(screen.getAllByText("Zelda 64")).toHaveLength(1);
    expect(screen.getByText("Super Mario World")).toBeInTheDocument();
    expect(screen.getAllByText("Playable").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Development").length).toBeGreaterThan(0);
    expect(screen.getByText("ports.projectCount")).toBeInTheDocument();
    expect(screen.getByText("ports.origin.mixed")).toBeInTheDocument();
  });

  it("filters by search tokens", async () => {
    await renderPage();

    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "mario" } });

    await waitFor(() => {
      expect(screen.queryByText("Zelda 64")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Super Mario World")).toBeInTheDocument();
  });

  it("filters by catalog source and supported platform", async () => {
    await renderPage();

    const sourceSelect = screen.getByRole("combobox", {
      name: "ports.filter.source",
    }) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: "gameport" } });

    await waitFor(() => {
      expect(screen.queryByText("Zelda 64")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Super Mario World")).toBeInTheDocument();

    const runsSelect = screen.getByRole("combobox", {
      name: "ports.filter.runsOn",
    }) as HTMLSelectElement;
    fireEvent.change(runsSelect, { target: { value: "macOS" } });

    await waitFor(() => {
      expect(screen.queryByText("Super Mario World")).not.toBeInTheDocument();
    });
    expect(screen.getByText("ports.empty.title")).toBeInTheDocument();
  });

  it("shows source stars and community rating on the card", async () => {
    await renderPage();

    expect(screen.getByText("1.2k")).toBeInTheDocument();
    expect(screen.getByText("4.5/5")).toBeInTheDocument();
  });

  it("groups sections when sorting by platform", async () => {
    await renderPage();

    const sort = screen
      .getAllByRole("combobox")
      .find((select) => (select as HTMLSelectElement).value === "name");
    expect(sort).toBeTruthy();
    fireEvent.change(sort as HTMLSelectElement, { target: { value: "platform" } });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nintendo 64" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "SNES" })).toBeInTheDocument();
    });
  });

  it("opens the detail modal with repository facts and README", async () => {
    await renderPage();

    fireEvent.click(screen.getByText("Zelda 64"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByText("A native port.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /ports.tab.readme/i }));

    expect(await screen.findByText("Project README")).toBeInTheDocument();
    expect(screen.getAllByText("A native port.").length).toBeGreaterThan(0);
  });

  it("switches between projects of a grouped game in the modal", async () => {
    await renderPage();

    fireEvent.click(screen.getByText("Zelda 64"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    const first = screen.getByRole("tab", { name: /Zelda64Recomp/ });
    expect(first).toHaveAttribute("aria-selected", "true");

    const second = screen.getByRole("tab", { name: /Zelda 64 Recompiled/ });
    fireEvent.click(second);

    await waitFor(() => {
      expect(second).toHaveAttribute("aria-selected", "true");
    });
    expect(first).toHaveAttribute("aria-selected", "false");
  });

  it("shows the stale banner with a retry action", async () => {
    cleanup();
    const original = catalog.stale;
    catalog.stale = true;
    render(<PortsPage />);
    await screen.findByText("Zelda 64");

    expect(screen.getByText(/ports.stale/)).toBeInTheDocument();
    catalog.stale = original;
  });
});
