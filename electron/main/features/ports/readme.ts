/**
 * README + repository metadata for port projects.
 *
 * Port rows link straight at GitHub/GitLab, often at a README *inside* a
 * monorepo (`blob/main/games/avsp/README.md`, where the repo is the tool and
 * each game is a folder). So the resolver keeps the `ref` + inner path from a
 * blob link and only falls back to conventional README names at the repo root.
 *
 * Raw content URLs are used instead of the REST API for the README itself:
 * they have no rate limit and no auth requirement. The GitHub REST API is used
 * only for the repository facts card (stars, description, last update), cached
 * for hours and treated as optional.
 */
import { cached, cacheGet, cacheSet } from "../metadata/cache";
import { httpJson, httpText } from "../../lib/http";
import type { PortReadme, PortRepoMeta } from "../../../../src/types/port";

const DAY = 24 * 60 * 60_000;
const README_TTL = 7 * DAY;
const REPO_TTL = 6 * 60 * 60_000;
const MAX_MARKDOWN = 400_000;
const MAX_REPO_BYTES = 300_000;

const README_CANDIDATES = [
  "README.md",
  "readme.md",
  "Readme.md",
  "README.MD",
  "README.markdown",
  "README.rst",
  "README.txt",
  "README",
  "docs/README.md",
];

interface RepoRef {
  host: "github" | "gitlab";
  owner: string;
  repo: string;
  /** GitLab projects can be nested (`group/subgroup/repo`). */
  fullPath: string;
  /** Branch/tag from a blob/tree URL, when present. */
  ref?: string;
  /** Path inside the repo from a blob URL, when present. */
  filePath?: string;
  /** Canonical repository URL. */
  url: string;
}

/** Parse a project link into a repository handle, or null for plain websites. */
export function parseRepoRef(rawUrl: string): RepoRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  if (host === "github.com") {
    const [owner, repo, kind, ref, ...rest] = segments;
    if (!owner || !repo) return null;
    const isBlob = kind === "blob" || kind === "raw";
    return {
      host: "github",
      owner,
      repo: repo.replace(/\.git$/, ""),
      fullPath: `${owner}/${repo.replace(/\.git$/, "")}`,
      ref: isBlob ? ref : undefined,
      filePath: isBlob && rest.length ? rest.join("/") : undefined,
      url: `https://github.com/${owner}/${repo.replace(/\.git$/, "")}`,
    };
  }

  if (host === "gitlab.com") {
    const blobSplit = url.pathname.split("/-/")[0].split("/").filter(Boolean);
    if (blobSplit.length < 2) return null;
    const repo = blobSplit[blobSplit.length - 1];
    const owner = blobSplit.slice(0, -1).join("/");
    const isBlob = url.pathname.includes("/-/blob/") || url.pathname.includes("/-/raw/");
    let ref: string | undefined;
    let filePath: string | undefined;
    if (isBlob) {
      const marker = url.pathname.includes("/-/raw/") ? "/-/raw/" : "/-/blob/";
      const tail = url.pathname.split(marker)[1] ?? "";
      const parts = tail.split("/").filter(Boolean);
      ref = parts[0];
      if (parts.length > 1) filePath = parts.slice(1).join("/");
    }
    return {
      host: "gitlab",
      owner,
      repo: repo.replace(/\.git$/, ""),
      fullPath: `${owner}/${repo.replace(/\.git$/, "")}`,
      ref,
      filePath,
      url: `https://gitlab.com/${owner}/${repo.replace(/\.git$/, "")}`,
    };
  }

  return null;
}

function rawReadmeUrl(ref: RepoRef, candidate: string): string {
  if (ref.host === "github") {
    if (candidate === "" && ref.ref && ref.filePath) {
      return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.ref}/${ref.filePath}`;
    }
    return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/HEAD/${candidate}`;
  }
  if (candidate === "" && ref.ref && ref.filePath) {
    return `https://gitlab.com/${ref.fullPath}/-/raw/${ref.ref}/${ref.filePath}`;
  }
  return `https://gitlab.com/${ref.fullPath}/-/raw/HEAD/${candidate}`;
}

function looksLikeMarkdown(text: string): boolean {
  const head = text.slice(0, 600).toLowerCase();
  if (!text.trim()) return false;
  // Raw GitHub 404s and HTML error pages must not render as a README.
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return false;
  return true;
}

async function loadReadme(ref: RepoRef): Promise<{ markdown: string; sourceUrl: string } | null> {
  const candidates = ref.filePath
    ? [""]
    : README_CANDIDATES.map((name) => name);
  for (const candidate of candidates) {
    const url = rawReadmeUrl(ref, candidate);
    try {
      const response = await httpText(url, {
        timeoutMs: 15_000,
        headers: { Accept: "text/plain, text/markdown;q=0.9, */*;q=0.5" },
      });
      if (!response.ok) continue;
      const text = response.text.slice(0, MAX_REPO_BYTES);
      if (!looksLikeMarkdown(text)) continue;
      return { markdown: text.slice(0, MAX_MARKDOWN), sourceUrl: url };
    } catch {
      // Try the next conventional filename.
    }
  }
  return null;
}

interface GithubRepoResponse {
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  topics?: string[];
  homepage?: string | null;
  open_issues_count?: number;
}

interface GitlabProjectResponse {
  description?: string | null;
  star_count?: number;
  last_activity_at?: string | null;
  license?: { name?: string | null } | null;
  topics?: string[];
  web_url?: string;
  open_issues_count?: number;
}

async function loadRepoMeta(ref: RepoRef): Promise<PortRepoMeta | null> {
  if (ref.host === "github") {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const payload = await httpJson<GithubRepoResponse>(
      `https://api.github.com/repos/${ref.fullPath}`,
      { timeoutMs: 10_000, headers, retries: 0 },
    );
    return {
      host: "github",
      owner: ref.owner,
      repo: ref.repo,
      url: ref.url,
      description: payload.description ?? null,
      stars: payload.stargazers_count ?? null,
      language: payload.language ?? null,
      updatedAt: payload.pushed_at ?? payload.updated_at ?? null,
      license: payload.license?.spdx_id && payload.license.spdx_id !== "NOASSERTION"
        ? payload.license.spdx_id
        : payload.license?.name ?? null,
      topics: Array.isArray(payload.topics) ? payload.topics.slice(0, 8) : [],
      homepage: payload.homepage ?? null,
      openIssues: payload.open_issues_count ?? null,
    };
  }

  const payload = await httpJson<GitlabProjectResponse>(
    `https://gitlab.com/api/v4/projects/${encodeURIComponent(ref.fullPath)}`,
    { timeoutMs: 10_000, retries: 0 },
  );
  return {
    host: "gitlab",
    owner: ref.owner,
    repo: ref.repo,
    url: ref.url,
    description: payload.description ?? null,
    stars: payload.star_count ?? null,
    language: null,
    updatedAt: payload.last_activity_at ?? null,
    license: payload.license?.name ?? null,
    topics: Array.isArray(payload.topics) ? payload.topics.slice(0, 8) : [],
    homepage: null,
    openIssues: payload.open_issues_count ?? null,
  };
}

/** In-flight repo lookups, so the card and the README tab share one request. */
const repoMetaInflight = new Map<string, Promise<PortRepoMeta | null>>();

/** Repository facts for the modal's overview card. Never throws. */
export function fetchPortRepoMeta(rawUrl: string): Promise<PortRepoMeta | null> {
  const ref = parseRepoRef(rawUrl);
  if (!ref) return Promise.resolve(null);
  const key = `repo:${ref.host}:${ref.fullPath}`;
  const hit = cacheGet<PortRepoMeta | null>("ports", key, REPO_TTL);
  if (hit !== undefined) return Promise.resolve(hit);
  // The modal asks for the card on open and the README tab asks again a moment
  // later; both should wait on the same GitHub/GitLab call instead of racing.
  const pending = repoMetaInflight.get(key);
  if (pending) return pending;
  const request = loadRepoMeta(ref)
    .then((meta) => {
      cacheSet("ports", key, meta);
      return meta;
    })
    .catch(() => {
      cacheSet("ports", key, null);
      return null;
    })
    .finally(() => {
      repoMetaInflight.delete(key);
    });
  repoMetaInflight.set(key, request);
  return request;
}

/** Resolve and cache a project README. Never throws. */
export async function fetchPortReadme(rawUrl: string): Promise<PortReadme> {
  const ref = parseRepoRef(rawUrl);
  if (!ref) {
    return {
      markdown: "",
      sourceUrl: rawUrl,
      repo: null,
      error: "This project is not hosted on a repository with a readable README.",
    };
  }

  const cacheKey = `readme:${ref.host}:${ref.fullPath}:${ref.ref ?? "HEAD"}:${ref.filePath ?? ""}`;
  // Repository facts and the README itself are independent requests: run them
  // together so the README tab is not slowed down by the GitHub API round trip.
  const [repo, payload] = await Promise.all([
    fetchPortRepoMeta(rawUrl).catch(() => null),
    cached<{ markdown: string; sourceUrl: string } | null>(
      "ports",
      cacheKey,
      README_TTL,
      () => loadReadme(ref),
    ),
  ]);

  if (!payload) {
    return {
      markdown: "",
      sourceUrl: ref.url,
      repo,
      error: "No README was found in this repository.",
    };
  }
  return { markdown: payload.markdown, sourceUrl: payload.sourceUrl, repo };
}
