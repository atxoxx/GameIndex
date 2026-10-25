import { describe, expect, it } from "vitest";
import type { NewsArticle } from "../../../types/news";
import {
  buildGameNewsBriefing,
  clusterLeads,
  matchesNewsCategory,
} from "./gameNewsBriefingData";

function article(
  title: string,
  publishedAt: string,
  sourceName = "Steam",
): NewsArticle {
  return {
    title,
    link: `https://example.com/${encodeURIComponent(sourceName)}/${encodeURIComponent(title)}`,
    description: "",
    content: "",
    pubDate: new Date(publishedAt).toUTCString(),
    sourceName,
    sourceUrl: "https://example.com",
    imageUrl: null,
  };
}

const now = Date.now();
const recent = new Date(now - 60_000).toISOString();
const older = new Date(now - 86_400_000).toISOString();
const lastVisit = now - 3_600_000;

const articles = [
  article("Patch 1.4 notes", recent),
  article("Studio announces a new expansion", recent),
  article("Interview with the composer", older, "IGN"),
];

describe("gameNewsBriefingData", () => {
  it("selects unread articles since the last visit", () => {
    const briefing = buildGameNewsBriefing(articles, new Set(), lastVisit);
    expect(briefing.hero?.title).toBe("Patch 1.4 notes");
    expect(briefing.unread.map((a) => a.title)).toEqual([
      "Patch 1.4 notes",
      "Studio announces a new expansion",
    ]);
    expect(briefing.unreadCount).toBe(2);
  });

  it("keeps the latest patch notes", () => {
    const briefing = buildGameNewsBriefing(articles, new Set(), lastVisit);
    expect(briefing.patchNotes.map((a) => a.title)).toContain("Patch 1.4 notes");
    expect(briefing.patchNotes.map((a) => a.title)).not.toContain(
      "Interview with the composer",
    );
  });

  it("matches categories", () => {
    const saved = new Set([articles[0].link]);
    const unread = new Set([articles[1].link]);
    expect(matchesNewsCategory(articles[0], "saved", saved, unread)).toBe(true);
    expect(matchesNewsCategory(articles[1], "unread", saved, unread)).toBe(true);
    expect(matchesNewsCategory(articles[2], "unread", saved, unread)).toBe(false);
    expect(matchesNewsCategory(articles[0], "patch_notes", saved, unread)).toBe(true);
    expect(matchesNewsCategory(articles[0], "press", saved, unread)).toBe(false);
  });

  it("collapses near-identical headlines into one lead", () => {
    const duplicates = [
      article("Stalker 2 gets a big new patch today", recent, "PC Gamer"),
      article("Stalker 2 gets a big new patch today", recent, "Eurogamer"),
      article("Unrelated cooking show announced", recent, "IGN"),
    ];
    const { leads, alsoByLink } = clusterLeads(duplicates, new Set());
    expect(leads.length).toBe(2);
    const clusterLead = leads.find((a) => a.title.includes("Stalker 2"));
    expect(clusterLead).toBeTruthy();
    expect(alsoByLink.get(clusterLead!.link)).toBe(1);
  });
});
