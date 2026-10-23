import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../context/LanguageContext";
import { ResultRow } from "./ResultRow";
import { accentForPlatform } from "../../types/emulator";
import type { DisplayMatch } from "./types";

function match(overrides: Partial<DisplayMatch>): DisplayMatch {
  return {
    sourceName: "Source",
    sourceId: "s",
    title: "Game",
    fileSize: "1 GB",
    uris: [],
    magnet: null,
    uploadDate: null,
    matchScore: 0.9,
    isNew: false,
    provider: "plugin",
    platform: "Xbox 360",
    id: "id",
    ...overrides,
  };
}

function renderRow(props: Partial<React.ComponentProps<typeof ResultRow>> = {}) {
  return render(
    <LanguageProvider>
      <ResultRow
        match={match({})}
        selected={false}
        onSelect={() => {}}
        isDownloaded={() => false}
        {...props}
      />
    </LanguageProvider>,
  );
}

describe("ResultRow platform + cache accents", () => {
  it("tints the card and platform chip with the console accent", () => {
    const { container } = renderRow();
    const card = container.querySelector(".dl-result-card") as HTMLElement;
    expect(card.style.getPropertyValue("--dl-platform-accent")).toBe(
      accentForPlatform("Xbox 360"),
    );
    expect(screen.getByText("Xbox 360")).toBeInTheDocument();
  });

  it("carries the cache colour on the flag, not the card edge", () => {
    const { container } = renderRow({ cacheStatus: "cached" });
    const card = container.querySelector(".dl-result-card") as HTMLElement;
    expect(card.className).not.toContain("is-cache-");
    expect(container.querySelector(".dl-flag--cache-cached")).toBeInTheDocument();
  });

  it("leaves a platform-less source row unaccented", () => {
    const { container } = renderRow({
      match: match({ provider: "source", platform: undefined }),
    });
    const card = container.querySelector(".dl-result-card") as HTMLElement;
    expect(card.style.getPropertyValue("--dl-platform-accent")).toBe("");
    expect(screen.queryByText("Xbox 360")).not.toBeInTheDocument();
  });
});

describe("ResultRow update state", () => {
  it("flags a newer release on the title line", () => {
    const { container } = renderRow({
      match: match({ title: "Game v2.0.0" }),
      installedVersion: "v1.0.0",
    });

    const flag = container.querySelector(".dl-result-flags .dl-flag--update");
    expect(flag).toBeInTheDocument();
    expect(flag?.textContent?.trim()).not.toBe("");
  });

  it("keeps the flags empty when the release matches the install", () => {
    const { container } = renderRow({
      match: match({ title: "Game v1.0.0" }),
      installedVersion: "v1.0.0",
    });

    expect(container.querySelector(".dl-result-flags")?.childElementCount).toBe(0);
  });

  it("keeps every fact on one quiet line", () => {
    const { container } = renderRow({
      match: match({
        title: "Game v2.0.0 DODI",
        seeds: 24,
        peers: 4,
        uploadDate: "2026-08-28T00:00:00Z",
      }),
      installedVersion: "v1.0.0",
    });

    const facts = container.querySelector(".dl-result-facts");
    expect(facts).toBeInTheDocument();
    expect(facts?.querySelector(".dl-fact--source")?.textContent).toBe("Source");
    expect(facts?.querySelector(".dl-fact--size")?.textContent).toContain("1 GB");
    expect(facts?.querySelector(".dl-fact--health")?.textContent).toContain("24");
    expect(facts?.querySelector(".dl-fact--match")?.textContent).toContain("90%");
  });
});
