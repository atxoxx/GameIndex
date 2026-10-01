import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageProvider } from "../../context/LanguageContext";
import { DownloadToolbar } from "./DownloadToolbar";
import { ResultsPane } from "./ResultsPane";
import { QueuePreview } from "./QueuePreview";
import { DEFAULT_FILTERS } from "./useFilterPresets";
import type { DisplayMatch } from "./types";
import type { TorrentDownload } from "../../types/download";

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
    provider: "source",
    id: "id",
    ...overrides,
  };
}

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("ResultsPane", () => {
  const matches = [
    match({ id: "a", title: "Elden Ring [FitGirl Repack]" }),
    match({ id: "b", title: "Elden Ring Deluxe", matchScore: 0.3 }),
  ];

  it("renders results and selects on click", () => {
    const onSelect = vi.fn();
    wrap(
      <ResultsPane
        matches={matches}
        selectedId={null}
        onSelect={onSelect}
        isDownloaded={() => false}
        installedVersion={null}
        reliabilityFor={() => undefined}
        recommendedId="a"
        batchMode={false}
        batchSelected={new Set()}
        onToggleBatch={() => {}}
        compareIds={new Set()}
        onToggleCompare={() => {}}
        totalRawMatchesCount={matches.length}
        searchProgress={null}
        hasActiveFilters={false}
        onClearFilters={() => {}}
        weakCount={1}
        showWeakMatches={false}
        onToggleWeak={() => {}}
      />,
    );
    expect(screen.getByText(/Elden Ring \[FitGirl Repack\]/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Elden Ring \[FitGirl Repack\]/));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("toggles batch selection when in batch mode", () => {
    const onToggleBatch = vi.fn();
    wrap(
      <ResultsPane
        matches={[matches[0]]}
        selectedId={null}
        onSelect={() => {}}
        isDownloaded={() => false}
        reliabilityFor={() => undefined}
        recommendedId={null}
        batchMode
        batchSelected={new Set()}
        onToggleBatch={onToggleBatch}
        compareIds={new Set()}
        onToggleCompare={() => {}}
        totalRawMatchesCount={1}
        searchProgress={null}
        hasActiveFilters={false}
        onClearFilters={() => {}}
        weakCount={0}
        showWeakMatches={false}
        onToggleWeak={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleBatch).toHaveBeenCalledWith("a");
  });
});

describe("DownloadToolbar", () => {
  it("emits search changes and reveals the filter popover", () => {
    const onChange = vi.fn();
    wrap(
      <DownloadToolbar
        filters={DEFAULT_FILTERS}
        onChange={onChange}
        onClearFilters={() => {}}
        sourceFilterOptions={[{ id: "all", label: "All", count: 1 }]}
        groupOptions={[]}
        installedVersion={null}
        newerCount={0}
        shownCount={1}
        totalCount={1}
        presets={[]}
        activePresetId={null}
        onApplyPreset={() => {}}
        onSavePreset={() => {}}
        onDeletePreset={() => {}}
        batchMode={false}
        onToggleBatchMode={() => {}}
        selectedCount={0}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "elden" } });
    expect(onChange).toHaveBeenCalledWith({ searchQuery: "elden" });
    expect(screen.queryByText("Filter by source")).not.toBeInTheDocument();
  });
});

describe("QueuePreview", () => {
  it("renders active downloads", () => {
    const download = {
      id: "d1",
      kind: "torrent",
      name: "Elden Ring",
      sourceUri: "magnet:?xt=urn:btih:abc",
      savePath: "C:/Games",
      downloaded: 1024,
      totalSize: 2048,
      progress: 0.5,
      downloadSpeed: 2048,
      uploadSpeed: 0,
      peers: 3,
      seeds: 5,
      status: { kind: "downloading" },
      gameId: null,
      sourceName: "Source",
      addedAt: 1,
      files: [],
    } as unknown as TorrentDownload;

    wrap(<QueuePreview downloads={[download]} />);
    expect(screen.getByText("Elden Ring")).toBeInTheDocument();
  });
});
