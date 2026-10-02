import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChangelogModal } from "./ChangelogModal";
import { fetchGithubReleases, type ReleaseEntry } from "../../utils/releaseNotes";

vi.mock("../../utils/releaseNotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/releaseNotes")>();
  return { ...actual, fetchGithubReleases: vi.fn() };
});

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("../../hooks/useAppVersion", () => ({
  useAppVersion: () => "1.2.0",
}));

const RELEASES: ReleaseEntry[] = [
  {
    tag: "v1.2.0",
    name: "v1.2.0",
    body: [
      "## What's Changed",
      "",
      "* fix(updater): install the right artifact ([b158d97](https://github.com/atxoxx/GameIndex/commit/b158d97))",
      "",
      "---",
      "*See assets below to download GameIndex.*",
    ].join("\n"),
    publishedAt: "2026-09-10T12:00:00Z",
    url: "https://github.com/atxoxx/GameIndex/releases/tag/v1.2.0",
    prerelease: false,
  },
  {
    tag: "v1.1.0",
    name: "v1.1.0",
    body: "",
    publishedAt: "2026-08-01T12:00:00Z",
    url: "https://github.com/atxoxx/GameIndex/releases/tag/v1.1.0",
    prerelease: false,
  },
];

const fetchMock = fetchGithubReleases as unknown as Mock;

function renderModal(onClose = vi.fn()) {
  render(<ChangelogModal open onClose={onClose} />);
  return { onClose };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("ChangelogModal", () => {
  it("renders the latest release expanded with its notes and badges", async () => {
    fetchMock.mockResolvedValue(RELEASES);
    renderModal();

    expect(await screen.findByText("v1.2.0")).toBeInTheDocument();
    expect(screen.getByText("v1.1.0")).toBeInTheDocument();
    expect(screen.getByText("updater.changelogLatest")).toBeInTheDocument();
    expect(screen.getByText("updater.changelogCurrent")).toBeInTheDocument();
    expect(screen.getByText("updater.changelogChanges")).toBeInTheDocument();

    fireEvent.click(
      screen.getByText("updater.changelogGroup.fixes").closest("button") as HTMLButtonElement,
    );
    const commitLink = screen.getByRole("link", { name: "b158d97" });
    expect(commitLink).toHaveAttribute(
      "href",
      "https://github.com/atxoxx/GameIndex/commit/b158d97",
    );
  });

  it("groups commits, highlights a leading info note, and collapses sections", async () => {
    fetchMock.mockResolvedValue([
      {
        tag: "v1.3.0",
        name: "v1.3.0",
        body: [
          "info: back up your database before updating ([aaa1111](https://github.com/atxoxx/GameIndex/commit/aaa1111))",
          "",
          "## What's Changed",
          "",
          "* feat(ui): add a shelf ([bbb2222](https://github.com/atxoxx/GameIndex/commit/bbb2222))",
          "* fix(db): index sessions ([ccc3333](https://github.com/atxoxx/GameIndex/commit/ccc3333))",
        ].join("\n"),
        publishedAt: "2026-09-20T12:00:00Z",
        url: "https://github.com/atxoxx/GameIndex/releases/tag/v1.3.0",
        prerelease: false,
      },
    ] satisfies ReleaseEntry[]);
    renderModal();

    expect(await screen.findByText("updater.changelogInfo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "aaa1111" })).toBeInTheDocument();
    expect(screen.getByText("updater.changelogGroup.features")).toBeInTheDocument();
    expect(screen.getByText("updater.changelogGroup.fixes")).toBeInTheDocument();

    // Sections start collapsed.
    expect(screen.queryByRole("link", { name: "bbb2222" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ccc3333" })).not.toBeInTheDocument();

    const featuresHead = screen
      .getByText("updater.changelogGroup.features")
      .closest("button") as HTMLButtonElement;
    fireEvent.click(featuresHead);

    expect(screen.getByRole("link", { name: "bbb2222" })).toBeInTheDocument();
    // The fixes section stayed collapsed.
    expect(screen.queryByRole("link", { name: "ccc3333" })).not.toBeInTheDocument();
  });

  it("expands collapsed releases on demand", async () => {
    fetchMock.mockResolvedValue(RELEASES);
    renderModal();

    const older = await screen.findByText("v1.1.0");
    fireEvent.click(older.closest("button") as HTMLButtonElement);

    expect(screen.getByText("updater.changelogNoNotes")).toBeInTheDocument();
  });

  it("shows the rate-limit hint and recovers through retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("API rate limit exceeded"));
    renderModal();

    expect(await screen.findByText("updater.changelogError")).toBeInTheDocument();
    expect(screen.getByText("updater.changelogRateLimited")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(RELEASES);
    const [retry] = screen.getAllByRole("button", { name: "updater.changelogRefresh" });
    fireEvent.click(retry);

    expect(await screen.findByText("v1.2.0")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    fetchMock.mockResolvedValue(RELEASES);
    const { onClose } = renderModal();
    await screen.findByText("v1.2.0");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
