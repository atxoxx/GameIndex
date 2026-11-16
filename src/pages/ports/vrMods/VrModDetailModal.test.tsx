import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { VrModGameGroup } from "../../../types/vrMod";
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
      return { host: "github", owner, repo, url, description: "A VR mod", stars: 42, topics: [] };
    }
    if (cmd === "get_vr_mod_readme") {
      return { markdown: readmes[url] ?? "", sourceUrl: url, repo: null };
    }
    return null;
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string) => key }),
}));

vi.mock("../../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => vi.fn(async () => true),
}));

const group: VrModGameGroup = {
  key: "alyssa",
  title: "Alyssa",
  entries: [
    {
      id: "a",
      gameKey: "alyssa",
      gameTitle: "Alyssa",
      modName: "Alyssa VR",
      description: "A short description.",
      details: "Platform: PCVR\nMotion controls: supported",
      links: [makeLink("Source", "https://github.com/alice/alyssa-vr")],
      image: null,
      date: "2026-01-01",
      kind: "dedicated",
      platforms: ["PCVR"],
      sources: [{ id: "vrportnews", name: "VR Port News", url: "https://vrportnews.com" }],
      author: "Alice",
      compatibility: null,
    },
  ],
  githubLinks: [
    makeLink("Main", "https://github.com/alice/alyssa-vr"),
    makeLink("Fork", "https://github.com/bob/alyssa-vr"),
  ],
  image: null,
  date: "2026-01-01",
  kinds: ["dedicated"],
  platforms: ["PCVR"],
  sources: [{ id: "vrportnews", name: "VR Port News", url: "https://vrportnews.com" }],
  author: "Alice",
};

describe("VrModDetailModal", () => {
  beforeEach(() => cleanup());

  it("shows the short description and full details on the overview tab", async () => {
    render(<VrModDetailModal group={group} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Alyssa")).toBeInTheDocument();
    expect(screen.getByText("A short description.")).toBeInTheDocument();
    expect(screen.getByText("supported")).toBeInTheDocument();
    // Flush the asynchronous repository-meta effect before cleanup.
    expect(await screen.findByText("A VR mod")).toBeInTheDocument();
  });

  it("lists deduped GitHub links in a dropdown and swaps the README", async () => {
    render(<VrModDetailModal group={group} onClose={() => {}} />);

    const select = screen.getByRole("combobox", {
      name: "ports.vrMods.repoSelect",
    }) as HTMLSelectElement;
    expect(select.options).toHaveLength(2);
    expect(select.options[0].textContent).toContain("alice/alyssa-vr");

    fireEvent.click(screen.getByRole("tab", { name: "ports.vrMods.tab.readme" }));
    expect(await screen.findByText(/Main repository README/)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "1" } });
    expect(await screen.findByText(/Fork README/)).toBeInTheDocument();
  });
});
