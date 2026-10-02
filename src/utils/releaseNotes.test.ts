import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  fetchGithubReleases,
  isSafeHref,
  parseInline,
  parseReleaseList,
  parseReleaseNotes,
  parseCommit,
  groupCommits,
  countCommits,
  parseInfoNote,
  GITHUB_RELEASES_API,
} from "./releaseNotes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const RELEASES_PAYLOAD = [
  {
    tag_name: "v1.2.0",
    name: "v1.2.0",
    body: "## What's Changed\n\n* release: v1.2.0 ([2194f3c](https://github.com/atxoxx/GameIndex/commit/2194f3c))",
    published_at: "2026-09-10T12:00:00Z",
    html_url: "https://github.com/atxoxx/GameIndex/releases/tag/v1.2.0",
    prerelease: false,
    draft: false,
  },
  {
    tag_name: "v1.1.0",
    name: "",
    body: "",
    published_at: "2026-08-01T12:00:00Z",
    html_url: "https://github.com/atxoxx/GameIndex/releases/tag/v1.1.0",
    prerelease: false,
    draft: false,
  },
  {
    tag_name: "v1.3.0-rc.1",
    name: "Release candidate",
    body: "Testing",
    published_at: "2026-09-11T12:00:00Z",
    html_url: "https://github.com/atxoxx/GameIndex/releases/tag/v1.3.0-rc.1",
    prerelease: true,
    draft: false,
  },
  {
    tag_name: "v9.9.9",
    name: "Draft",
    body: "unreleased",
    published_at: "2026-09-12T12:00:00Z",
    html_url: "https://github.com/atxoxx/GameIndex/releases/tag/v9.9.9",
    prerelease: false,
    draft: true,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("parseReleaseList", () => {
  it("normalizes, sorts newest-first and skips drafts", () => {
    const releases = parseReleaseList(RELEASES_PAYLOAD);

    expect(releases.map((r) => r.tag)).toEqual(["v1.3.0-rc.1", "v1.2.0", "v1.1.0"]);
    expect(releases[1].name).toBe("v1.2.0");
    expect(releases[1].prerelease).toBe(false);
    // Empty release names fall back to the tag.
    expect(releases[2].name).toBe("v1.1.0");
    expect(releases[0].prerelease).toBe(true);
  });

  it("surfaces the GitHub API error message", () => {
    expect(() =>
      parseReleaseList({ message: "API rate limit exceeded for 1.2.3.4" }),
    ).toThrow(/rate limit/i);
  });

  it("rejects payloads that are not a release array", () => {
    expect(() => parseReleaseList("nope")).toThrow(/unexpected/i);
  });
});

describe("parseReleaseNotes", () => {
  it("parses the generated release-notes layout", () => {
    const blocks = parseReleaseNotes(
      [
        "## What's Changed",
        "",
        "* fix(updater): install the right artifact ([b158d97](https://github.com/x/y/commit/b158d97))",
        "* release: v1.2.0 ([2194f3c](https://github.com/x/y/commit/2194f3c))",
        "",
        "---",
        "*See assets below to download GameIndex.*",
      ].join("\n"),
    );

    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "What's Changed" },
      {
        type: "list",
        ordered: false,
        items: [
          "fix(updater): install the right artifact ([b158d97](https://github.com/x/y/commit/b158d97))",
          "release: v1.2.0 ([2194f3c](https://github.com/x/y/commit/2194f3c))",
        ],
      },
      { type: "rule" },
      { type: "paragraph", text: "*See assets below to download GameIndex.*" },
    ]);
  });

  it("keeps ordered and unordered lists apart and groups quotes", () => {
    const blocks = parseReleaseNotes(
      "1. first\n2. second\n\n- bullet\n\n> quoted\n> again",
    );

    expect(blocks).toEqual([
      { type: "list", ordered: true, items: ["first", "second"] },
      { type: "list", ordered: false, items: ["bullet"] },
      { type: "quote", text: "quoted again" },
    ]);
  });

  it("returns nothing for an empty body", () => {
    expect(parseReleaseNotes("")).toEqual([]);
    expect(parseReleaseNotes("  \n\n")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("splits links, bold, italic and code", () => {
    const tokens = parseInline(
      "fix `launch` — [view](https://github.com/x) and **you** *can* help",
    );

    expect(tokens).toEqual([
      { type: "text", value: "fix " },
      { type: "code", value: "launch" },
      { type: "text", value: " — " },
      { type: "link", label: "view", href: "https://github.com/x" },
      { type: "text", value: " and " },
      { type: "strong", value: "you" },
      { type: "text", value: " " },
      { type: "em", value: "can" },
      { type: "text", value: " help" },
    ]);
  });

  it("leaves plain text untouched", () => {
    expect(parseInline("just text")).toEqual([{ type: "text", value: "just text" }]);
  });
});

describe("isSafeHref", () => {
  it("accepts http(s) and rejects other schemes", () => {
    expect(isSafeHref("https://github.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
  });
});

describe("parseCommit", () => {
  it("splits a conventional commit with scope and linked hash", () => {
    expect(
      parseCommit(
        "feat(bigscreen): make the game detail tabs controller-reachable ([c8ed13d](https://github.com/x/y/commit/c8ed13d))",
      ),
    ).toEqual({
      category: "feat",
      scope: "bigscreen",
      description: "make the game detail tabs controller-reachable",
      hash: "c8ed13d",
      href: "https://github.com/x/y/commit/c8ed13d",
      breaking: false,
    });
  });

  it("maps aliases (perf, build, chore) and unwraps bold subjects", () => {
    expect(parseCommit("perf(rust): narrow lock scope ([f10ef24](https://x/commit/f10ef24))").category).toBe("perf");
    expect(parseCommit("build(ts): enable incremental typechecking ([4af65f0](https://x/commit/4af65f0))").category).toBe("build");
    expect(parseCommit("chore: tidy things").category).toBe("chore");
    expect(parseCommit("**release: v1.4.0** (2691ad2)")).toMatchObject({
      category: "release",
      description: "v1.4.0",
      hash: "2691ad2",
      href: null,
    });
  });

  it("marks breaking changes and falls back to `other` for prose", () => {
    expect(parseCommit("feat(api)!: drop legacy endpoint").breaking).toBe(true);
    expect(parseCommit("Just a note about the release")).toMatchObject({
      category: "other",
      scope: null,
      description: "Just a note about the release",
    });
  });
});

describe("groupCommits", () => {
  it("orders categories and keeps commits together", () => {
    const groups = groupCommits([
      "fix(db): index sessions ([a1](https://x/commit/a1))",
      "feat(ui): add shelf ([b2](https://x/commit/b2))",
      "feat(core): speed up scan ([c3](https://x/commit/c3))",
      "release: v1.0.0 ([d4](https://x/commit/d4))",
    ]);

    expect(groups.map((g) => g.category)).toEqual(["feat", "fix", "release"]);
    expect(groups[0].commits.map((c) => c.description)).toEqual(["add shelf", "speed up scan"]);
    expect(groups[1].commits).toHaveLength(1);
  });

  it("counts only user-facing commits, ignoring prose and version bumps", () => {
    expect(
      countCommits([
        "feat: one",
        "docs: two",
        "some free-form note",
        "release: v1.0.0 ([d4](https://x/commit/d4))",
      ]),
    ).toBe(2);
  });
});

describe("parseInfoNote", () => {
  it("extracts a leading info note and its commit link", () => {
    expect(
      parseInfoNote("info: this release migrates the database ([abc1234](https://x/commit/abc1234))"),
    ).toEqual({
      text: "this release migrates the database",
      hash: "abc1234",
      href: "https://x/commit/abc1234",
    });
    expect(parseInfoNote("**info:** heads up, back up first")).toEqual({
      text: "heads up, back up first",
      hash: null,
      href: null,
    });
    expect(parseInfoNote("**info: memory usage is lower**")).toEqual({
      text: "memory usage is lower",
      hash: null,
      href: null,
    });
  });

  it("returns null when the line is not an info note", () => {
    expect(parseInfoNote("feat: add a thing")).toBeNull();
    expect(parseInfoNote("informational text without a prefix")).toBeNull();
  });
});

describe("fetchGithubReleases", () => {
  it("loads releases straight from the GitHub API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(RELEASES_PAYLOAD),
    });
    vi.stubGlobal("fetch", fetchMock);

    const releases = await fetchGithubReleases();

    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_RELEASES_API,
      expect.objectContaining({ headers: { Accept: "application/vnd.github+json" } }),
    );
    expect(releases[0].tag).toBe("v1.3.0-rc.1");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects with the rate-limit message instead of retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ message: "API rate limit exceeded" }),
      }),
    );

    await expect(fetchGithubReleases()).rejects.toThrow(/rate limit/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to the Rust fetch bridge when the webview fetch fails", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    (invoke as unknown as Mock).mockResolvedValue(
      JSON.stringify([RELEASES_PAYLOAD[1]]),
    );

    const releases = await fetchGithubReleases();

    expect(invoke).toHaveBeenCalledWith("fetch_url", { url: GITHUB_RELEASES_API });
    expect(releases.map((r) => r.tag)).toEqual(["v1.1.0"]);
  });
});
