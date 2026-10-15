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

  it("carries the cache colour on the badge, not the card edge", () => {
    const { container } = renderRow({ cacheStatus: "cached" });
    const card = container.querySelector(".dl-result-card") as HTMLElement;
    expect(card.className).not.toContain("is-cache-");
    expect(container.querySelector(".dl-badge--cache-cached")).toBeInTheDocument();
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
