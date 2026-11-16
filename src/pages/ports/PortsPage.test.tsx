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
    ...overrides,
  });
  return {
    source: "https://www.pcgamingwiki.com/wiki/List_of_unofficial_ports",
    fetchedAt: Date.UTC(2026, 0, 2),
    stale: false,
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
