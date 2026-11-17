import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { VrModEntry, VrModGameGroup } from "../../../types/vrMod";
import { makeLink } from "./vrModData";
import VrModDetailModal from "./VrModDetailModal";

const readmes: Record<string, string> = {
  "https://github.com/alice/alyssa-vr": "# Alyssa VR\n\nMain repository README.",
  "https://github.com/bob/alyssa-vr": "# Alyssa VR fork\n\nFork README.",
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    const url = String(args?.url ?? "");
    if (cmd === "get_vr_mod_repo") {
      const [owner, repo] = url.split("/").slice(-2);
      return {
        host: "github",
        owner,
        repo,
        url,
        description: `Repo ${owner}`,
        stars: 42,
        topics: [],
      };
    }
    if (cmd === "get_vr_mod_readme") {
      return { markdown: readmes[url] ?? "", sourceUrl: url, repo: null };
    }
    return null;
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// A stable `t`: the modal's README effect depends on it, and a fresh function
// per render would re-run that effect forever (the real context memoises it).
const { translate } = vi.hoisted(() => ({ translate: (key: string) => key }));

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: translate }),
}));

vi.mock("../../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => vi.fn(async () => true),
}));

function entry(overrides: Partial<VrModEntry> & Pick<VrModEntry, "id" | "modName">): VrModEntry {
  return {
    gameKey: "alyssa",
    gameTitle: "Alyssa",
    description: "",
    details: "",
    links: [],
    image: null,
    date: null,
    kind: "dedicated",
    platforms: ["PCVR"],
    sources: [{ id: "vrportnews", name: "VR Port News", url: "https://vrportnews.com" }],
    author: null,
    compatibility: null,
    ...overrides,
  };
}

const group: VrModGameGroup = {
  key: "alyssa",
  title: "Alyssa",
  entries: [
    entry({
      id: "a",
      modName: "Alyssa VR",
      description: "A short description.",
      details: "Platform: PCVR\nMotion controls: supported",
      links: [makeLink("Source", "https://github.com/alice/alyssa-vr")],
      date: "2026-01-01",
      author: "Alice",
    }),
    entry({
      id: "b",
      modName: "Alyssa VR Fork",
      description: "Fork description.",
      details: "Platform: PCVR\nFork feature: yes",
      links: [makeLink("Fork", "https://github.com/bob/alyssa-vr")],
      author: "Bob",
    }),
  ],
  githubLinks: [
    makeLink("Source", "https://github.com/alice/alyssa-vr"),
    makeLink("Fork", "https://github.com/bob/alyssa-vr"),
  ],
  image: null,
  date: "2026-01-01",
  kinds: ["dedicated"],
  platforms: ["PCVR"],
  sources: [{ id: "vrportnews", name: "VR Port News", url: "https://vrportnews.com" }],
  author: "Alice",
};

function itemSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "ports.vrMods.itemSelect" }) as HTMLSelectElement;
}

describe("VrModDetailModal", () => {
  beforeEach(() => cleanup());

  it("shows the first mod's description, details and repository", async () => {
    render(<VrModDetailModal group={group} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Alyssa")).toBeInTheDocument();
    expect(screen.getByText("A short description.")).toBeInTheDocument();
    expect(screen.getByText("supported")).toBeInTheDocument();
    // Flush the asynchronous repository-meta effect before cleanup.
    expect(await screen.findByText("Repo alice")).toBeInTheDocument();
  });

  it("lists the game's mods and switches the whole modal to another one", async () => {
    render(<VrModDetailModal group={group} onClose={() => {}} />);

    const select = itemSelect();
    expect(select.options).toHaveLength(2);
    expect(select.options[0].textContent).toContain("Alyssa VR");
    expect(select.options[0].textContent).toContain("alice/alyssa-vr");
    expect(select.options[1].textContent).toContain("Alyssa VR Fork");
    expect(select.options[1].textContent).toContain("bob/alyssa-vr");

    fireEvent.change(select, { target: { value: "1" } });

    // Every part of the modal follows the selected item, not just the repo.
    expect(screen.getByText("Fork description.")).toBeInTheDocument();
    expect(screen.getByText("Fork feature")).toBeInTheDocument();
    expect(screen.queryByText("A short description.")).not.toBeInTheDocument();
    expect(await screen.findByText("Repo bob")).toBeInTheDocument();
  });

  it("swaps the README with the selected mod's repository", async () => {
    render(<VrModDetailModal group={group} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: "ports.vrMods.tab.readme" }));
    expect(await screen.findByText(/Main repository README/)).toBeInTheDocument();

    fireEvent.change(itemSelect(), { target: { value: "1" } });
    expect(await screen.findByText(/Fork README/)).toBeInTheDocument();
  });

  it("keeps mods without a repository selectable", async () => {
    const noRepo: VrModGameGroup = {
      ...group,
      entries: [
        group.entries[0],
        entry({
          id: "c",
          modName: "Alyssa VR (Patreon)",
          description: "Patreon-only build.",
          links: [makeLink("Patreon", "https://www.patreon.com/alyssa-vr")],
        }),
      ],
      githubLinks: group.githubLinks.slice(0, 1),
    };

    render(<VrModDetailModal group={noRepo} onClose={() => {}} />);
    expect(itemSelect().options).toHaveLength(2);

    fireEvent.change(itemSelect(), { target: { value: "1" } });
    expect(screen.getByText("Patreon-only build.")).toBeInTheDocument();
    // The repo section disappears, but the link list still offers the page.
    expect(screen.queryByText("ports.vrMods.repo.title")).not.toBeInTheDocument();
    expect(screen.getByText("Patreon")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "ports.vrMods.tab.readme" }));
    expect(await screen.findByText("ports.vrMods.readme.noRepo")).toBeInTheDocument();
  });
});
