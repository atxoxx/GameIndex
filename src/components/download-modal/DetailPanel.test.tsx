import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetailPanel } from "./DetailPanel";
import type { DisplayMatch } from "./types";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      const strings: Record<string, string> = {
        "downloadModal.detailEmpty":
          "Select a source on the left to see its details.",
        "downloadModal.pickResult": "Pick a source result to download from.",
        "downloadModal.configHeader": "Download Configuration",
        "downloadModal.detailSelected": "Selected source",
        "downloadModal.detailUploaded": "Uploaded",
        "downloadModal.detailPlatform": "Platform",
        "downloadModal.detailRegion": "Region",
        "downloadModal.detailReleaseGroup": "Release group",
        "downloadModal.detailFiles": "Files",
        "downloadModal.detailChecksums": "Checksums",
        "downloadModal.detailTechnical": "Technical details",
        "downloadModal.detailRawMetadata": "Raw metadata",
        "downloadModal.filterAvailability": "Availability",
        "downloadModal.cacheCached": "Cached · instant",
        "downloadModal.matchHigh": "High match",
        "downloadModal.fileCount": "{count} files",
        "downloadModal.checksumCount": "{count} checksums",
        "downloadModal.mirrorCount": "{count} mirrors",
        "downloadModal.seeds": "Seeds {count}",
        "downloadModal.peers": "Peers {count}",
        "downloadModal.copyChecksum": "Copy checksum",
        "downloadModal.copied": "Copied",
        "downloadModal.verified": "Verified",
        "downloadModal.sectionMirrors": "Mirrors",
        "downloadModal.detailSource": "Source",
        "downloadModal.resolverOpen": "Open in GameIndex Browser",
        "downloadModal.resolverTitle": "Need a browser to unlock this link?",
        "downloadModal.resolverDesc": "Open the hoster page.",
        "downloadModal.openInBrowser": "Open in browser",
        "downloads.alreadyDownloaded": "Already downloaded",
        "downloads.newlyAddedSource": "Newly added source",
        "common.language": "Language",
        "common.expand": "Expand",
        "common.collapse": "Collapse",
      };
      const value = strings[key] ?? key;
      return vars
        ? value.replace(/\{(\w+)\}/g, (_match, name) =>
            String(vars[name] ?? `{${name}}`),
          )
        : value;
    },
  }),
}));

function match(overrides: Partial<DisplayMatch>): DisplayMatch {
  return {
    sourceName: "Source",
    sourceId: "source-id",
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

function baseProps(matchValue: DisplayMatch | null = null) {
  return {
    match: matchValue,
    selectedMirrorIndex: 0,
    onSelectMirror: vi.fn(),
    installedVersion: null,
    isDownloaded: () => false,
    savePath: null,
    gameName: "Game",
    onPickPath: vi.fn(),
    autoExtract: true,
    onAutoExtract: vi.fn(),
    chooseFiles: false,
    onChooseFiles: vi.fn(),
    onSelectFiles: vi.fn(),
    isFetchingFiles: false,
    useDebrid: false,
    onUseDebrid: vi.fn(),
    debridConfigured: false,
    cacheStatus: "idle" as const,
    onOpenPage: vi.fn(),
    onOpenBrowserResolver: vi.fn(),
    resolverActive: false,
    resolverPartsCaptured: 0,
  };
}

describe("DetailPanel", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("renders an instructive empty state when no release is selected", () => {
    render(<DetailPanel {...baseProps()} />);

    expect(
      screen.getByText("Select a source on the left to see its details."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pick a source result to download from."),
    ).toBeInTheDocument();
  });

  it("builds the dossier summary from present fields only", () => {
    render(
      <DetailPanel
        {...baseProps(
          match({
            title: "Elden Ring [FitGirl Repack] v1.10",
            fileSize: "62.4 GB",
            uploadDate: "2024-01-05T00:00:00Z",
            platform: "PC",
            region: "EUR",
            releaseGroup: "FitGirl",
            matchScore: 0.92,
            verified: true,
            seeds: 12,
            peers: 4,
            uris: [
              "magnet:?xt=urn:btih:abc",
              "https://mirror.example.com/file.torrent",
            ],
            fileList: [
              { name: "game.bin", size: 1024 },
              { name: "readme.txt", size: 10 },
            ],
            checksums: [{ algo: "sha256", value: "abc123" }],
          }),
        )}
        cacheStatus="cached"
      />,
    );

    expect(screen.getAllByText("Source").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Elden Ring [FitGirl Repack] v1.10"),
    ).toBeInTheDocument();
    expect(screen.getByText("62.4 GB")).toBeInTheDocument();
    expect(screen.getByText("Jan 5, 2024")).toBeInTheDocument();
    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("92% · High match")).toBeInTheDocument();
    expect(screen.getByText("Cached · instant")).toBeInTheDocument();
    expect(screen.getByText("Mirrors")).toBeInTheDocument();
    expect(screen.getAllByText("2 files").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 checksums").length).toBeGreaterThan(0);
    expect(screen.getByText("Seeds 12 · Peers 4")).toBeInTheDocument();
  });

  it("hides metadata that the release does not carry", () => {
    render(<DetailPanel {...baseProps(match({ title: "Tetris" }))} />);

    expect(
      screen.queryByText("downloadModal.detailUploaded"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("downloadModal.detailPlatform"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("downloadModal.detailRegion"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("downloadModal.detailReleaseGroup"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("downloadModal.filterAvailability"),
    ).not.toBeInTheDocument();
  });

  it("keeps checksums in a labelled technical disclosure and copies them", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <DetailPanel
        {...baseProps(
          match({
            title: "Game",
            infohash: "ABCDEF123456",
            checksums: [{ algo: "sha256", value: "abc123" }],
          }),
        )}
      />,
    );

    const disclosure = screen.getByRole("button", {
      name: /Technical details/,
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", {
        name: "Copy checksum: sha256",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Raw metadata")).toBeInTheDocument();
    expect(screen.getByText("ABCDEF123456")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy checksum: sha256",
      }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("lets the user switch mirrors and opens the browser resolver", () => {
    const props = baseProps(
      match({
        title: "Direct release",
        uris: [
          "https://host.example.com/file.zip",
          "https://mirror.example.com/file.zip",
        ],
      }),
    );

    render(<DetailPanel {...props} />);

    const select = screen.getByRole("combobox", {
      name: "downloadModal.selectMirror",
    });
    fireEvent.change(select, { target: { value: "1" } });
    expect(props.onSelectMirror).toHaveBeenCalledWith(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Open in GameIndex Browser" }),
    );
    expect(props.onOpenBrowserResolver).toHaveBeenCalledWith(
      "https://host.example.com/file.zip",
    );
  });
});
