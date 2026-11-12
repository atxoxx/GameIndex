/**
 * External review sources: Metacritic (scraped), OpenCritic (RapidAPI when
 * `OPENCRITIC_RAPIDAPI_KEY` is present, HTML otherwise) and RAWG.
 *
 * Ported from `game_scraper/reviews/{metacritic,opencritic,mod}.rs`. The
 * Metacritic score summary is what `useMetacriticScore` renders; reviews are
 * what `fetch_external_reviews` returns.
 */
import * as cheerio from "cheerio";

import { getSecret } from "../../lib/secrets";
import { httpJson, httpText } from "../../lib/http";
import { cached, TTL } from "./cache";
import { collapse, decodeEntities, firstNumber, htmlToText, slugify } from "./text";
import type { SteamReviewShape } from "./steam";

export interface MetacriticScore {
  url: string;
  metascore?: number | null;
  metascoreSentiment?: string | null;
  criticReviewCount?: number | null;
  userScore?: number | null;
  userScoreSentiment?: string | null;
  userRatingCount?: number | null;
  positiveCount?: number | null;
  neutralCount?: number | null;
  negativeCount?: number | null;
  userPositiveCount?: number | null;
  userNeutralCount?: number | null;
  userNegativeCount?: number | null;
}

const REVIEW_CLIENT_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

/** Direct URL if it resolves, otherwise DuckDuckGo's first result for the site. */
async function resolveGameUrl(
  directUrl: string,
  host: string,
  gameName: string,
): Promise<string> {
  try {
    const direct = await httpText(directUrl, {
      headers: REVIEW_CLIENT_HEADERS,
      timeoutMs: 15_000,
      retries: 0,
      redirect: "follow",
    });
    if (direct.ok && !/404|not found/i.test(direct.text.slice(0, 400))) return directUrl;
  } catch {
    /* fall through to the search */
  }
  const query = `site:${host} ${gameName}`;
  const search = await httpText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { timeoutMs: 15_000, retries: 1 },
  );
  if (!search.ok) return directUrl;
  const $ = cheerio.load(search.text);
  for (const anchor of $("a.result__a").toArray()) {
    let href = $(anchor).attr("href") ?? "";
    if (!href) continue;
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("http")) return href;
  }
  return directUrl;
}

function parseMetacriticScores(html: string, url: string): MetacriticScore {
  const $ = cheerio.load(html);
  const summary: MetacriticScore = { url };
  $("[data-testid='global-score-wrapper']").each((_index, element) => {
    const wrapper = $(element);
    const header = collapse(wrapper.find("[data-testid='global-score-header']").first().text()).toLowerCase();
    const isUser = header.includes("user");
    if ((isUser && summary.userScore != null) || (!isUser && summary.metascore != null)) return;
    const value = collapse(wrapper.find("[data-testid='global-score-value']").first().text());
    const sentiment = collapse(wrapper.find("[data-testid='global-score-sentiment']").first().text()) || null;
    const countText = wrapper.find("[data-testid='global-score-review-count']").first().text();
    const count = firstNumber(countText);
    const scope = wrapper.parent().length ? wrapper.parent() : wrapper;
    const barCount = (selector: string): number | null => {
      const label = scope.find(selector).first().attr("aria-label") ?? "";
      return firstNumber(label);
    };
    const positive = barCount("[data-testid='global-score-graph-bar-positive']");
    const neutral = barCount("[data-testid='global-score-graph-bar-neutral']");
    const negative = barCount("[data-testid='global-score-graph-bar-negative']");
    if (isUser) {
      const parsed = Number.parseFloat(value);
      summary.userScore = Number.isFinite(parsed) ? parsed : null;
      summary.userScoreSentiment = sentiment;
      summary.userRatingCount = count;
      summary.userPositiveCount = positive;
      summary.userNeutralCount = neutral;
      summary.userNegativeCount = negative;
    } else {
      const parsed = Number.parseInt(value, 10);
      summary.metascore = Number.isFinite(parsed) ? parsed : null;
      summary.metascoreSentiment = sentiment;
      summary.criticReviewCount = count;
      summary.positiveCount = positive;
      summary.neutralCount = neutral;
      summary.negativeCount = negative;
    }
  });
  return summary;
}

/** Metacritic critic + user score summary. */
export async function fetchMetacriticScore(gameName: string): Promise<MetacriticScore> {
  return cached("scores", `metacritic:${gameName.trim().toLowerCase()}`, TTL.scores, async () => {
    const direct = `https://www.metacritic.com/game/${slugify(gameName)}/`;
    const url = await resolveGameUrl(direct, "metacritic.com", gameName);
    const response = await httpText(url, {
      headers: REVIEW_CLIENT_HEADERS,
      timeoutMs: 20_000,
      retries: 1,
    });
    if (!response.ok) {
      throw new Error(`Metacritic returned HTTP ${response.status} for "${gameName}".`);
    }
    return parseMetacriticScores(response.text, url);
  });
}

// ── OpenCritic RapidAPI ────────────────────────────────────────────────

interface OcSearchItem {
  id?: number;
  name?: string;
  relation?: string;
}

interface OcGameDetail {
  name?: string;
  num_reviews?: number;
  median_score?: number | null;
  top_critic_score?: number | null;
  percent_recommended?: number | null;
}

interface OcRatings {
  median?: number | null;
  count?: number;
}

function openCriticKey(): string | null {
  const key = getSecret("OPENCRITIC_RAPIDAPI_KEY");
  return key && key.trim() ? key.trim() : null;
}

function ocHeaders(key: string): Record<string, string> {
  return {
    "x-rapidapi-host": "opencritic-api.p.rapidapi.com",
    "x-rapidapi-key": key,
    Accept: "application/json",
  };
}

async function ocSearch(key: string, gameName: string): Promise<OcSearchItem | null> {
  const items = await httpJson<OcSearchItem[]>(
    `https://opencritic-api.p.rapidapi.com/meta/search?criteria=${encodeURIComponent(gameName)}`,
    { headers: ocHeaders(key), timeoutMs: 15_000, retries: 1 },
  );
  return items.find((item) => item.relation === "game") ?? items[0] ?? null;
}

/** OpenCritic score rows shaped like the review cards the UI renders. */
export async function fetchOpenCriticReviews(gameName: string): Promise<SteamReviewShape[]> {
  const key = openCriticKey();
  if (key) {
    try {
      return await cached("scores", `opencritic-api:${gameName.toLowerCase()}`, TTL.scores, async () => {
        const found = await ocSearch(key, gameName);
        if (!found?.id) throw new Error(`No OpenCritic match for "${gameName}".`);
        const [detail, ratings] = await Promise.all([
          httpJson<OcGameDetail>(`https://opencritic-api.p.rapidapi.com/game/${found.id}`, {
            headers: ocHeaders(key),
            timeoutMs: 15_000,
            retries: 1,
          }),
          httpJson<OcRatings>(`https://opencritic-api.p.rapidapi.com/ratings/game/${found.id}`, {
            headers: ocHeaders(key),
            timeoutMs: 15_000,
            retries: 1,
          }).catch(() => ({ median: null, count: 0 })),
        ]);
        const name = detail.name ?? found.name ?? gameName;
        const reviews: SteamReviewShape[] = [];
        const criticParts: string[] = [];
        if (detail.median_score != null) criticParts.push(`Median Score: ${Math.round(detail.median_score)}/100`);
        if (detail.top_critic_score != null) criticParts.push(`Top Critics: ${Math.round(detail.top_critic_score)}/100`);
        if ((detail.num_reviews ?? 0) > 0) criticParts.push(`Based on ${detail.num_reviews} critic reviews`);
        if (detail.percent_recommended != null) {
          criticParts.push(`Recommended by ${Math.round(detail.percent_recommended)}% of critics`);
        }
        if (criticParts.length) {
          reviews.push({
            title: `OpenCritic Critics — ${name}`,
            content: `${criticParts.join(". ")}.`,
            rating: detail.median_score ?? detail.top_critic_score ?? undefined,
            username: "OpenCritic Critics",
          });
        }
        if ((ratings.count ?? 0) > 0 || ratings.median != null) {
          const communityParts: string[] = [];
          if (ratings.median != null) communityParts.push(`Median Score: ${ratings.median.toFixed(1)}/5`);
          if ((ratings.count ?? 0) > 0) communityParts.push(`Based on ${ratings.count} player ratings`);
          if (communityParts.length) {
            reviews.push({
              title: `OpenCritic Community — ${name}`,
              content: `${communityParts.join(". ")}.`,
              rating: ratings.median != null ? ratings.median * 20 : undefined,
              username: "OpenCritic Community",
              votesUp: ratings.count,
            });
          }
        }
        if (reviews.length === 0) throw new Error(`No scores available on OpenCritic for "${gameName}".`);
        return reviews;
      });
    } catch (error) {
      console.warn("[metadata] OpenCritic RapidAPI failed, falling back to HTML:", error);
    }
  }
  return fetchOpenCriticHtmlReviews(gameName);
}

async function fetchOpenCriticHtmlReviews(gameName: string): Promise<SteamReviewShape[]> {
  const sentinel = `https://opencritic.com/game/0/${slugify(gameName)}`;
  const url = await resolveGameUrl(sentinel, "opencritic.com", gameName);
  const response = await httpText(url, {
    headers: REVIEW_CLIENT_HEADERS,
    timeoutMs: 20_000,
    retries: 1,
  });
  if (!response.ok) {
    const hint = openCriticKey()
      ? ""
      : " — set OPENCRITIC_RAPIDAPI_KEY for reliable results";
    throw new Error(`OpenCritic returned HTTP ${response.status}${hint}.`);
  }
  const $ = cheerio.load(response.text);
  const reviews: SteamReviewShape[] = [];
  $("app-review-card").each((_index, element) => {
    const card = $(element);
    const outlet = collapse(card.find("h4 > a[href^='/outlet/']").first().text());
    const author = collapse(card.find(".author > a[href^='/critic/']").first().text());
    const scoreText = collapse(card.find(".score").first().text());
    const snippet = collapse(card.find("p.font-small.grey-dark-text").first().text());
    const date = collapse(card.find(".date, time").first().text());
    if (!snippet && !author) return;
    const score = Number.parseFloat(scoreText.replace(/[^0-9.]/g, ""));
    reviews.push({
      title: outlet || undefined,
      content: snippet || undefined,
      rating: Number.isFinite(score) ? score : undefined,
      username: author || outlet || "OpenCritic",
      timestampCreated: date ? Math.floor(new Date(date).getTime() / 1000) || undefined : undefined,
    });
  });
  return reviews;
}

/** Metacritic user reviews, shaped like the Reviews tab's cards. */
export async function fetchMetacriticReviews(gameName: string): Promise<SteamReviewShape[]> {
  const direct = `https://www.metacritic.com/game/${slugify(gameName)}/user-reviews`;
  const url = await resolveGameUrl(direct, "metacritic.com", gameName);
  const response = await httpText(url, {
    headers: REVIEW_CLIENT_HEADERS,
    timeoutMs: 20_000,
    retries: 1,
  });
  if (!response.ok) throw new Error(`Metacritic returned HTTP ${response.status}.`);
  const $ = cheerio.load(response.text);
  const reviews: SteamReviewShape[] = [];
  $(
    "[data-testid='review-card'], .c-reviews-container--multi-column > div, .review.user_review",
  ).each((_index, element) => {
    const card = $(element);
    const username = collapse(card.find("a[href^='/user/']").first().text());
    const scoreText = collapse(
      card.find("[data-testid='review-card-score'] span, .c-siteReviewScore span").first().text(),
    );
    const dateText = card.find("[data-testid='review-card-date'], time, .date").first();
    const date = dateText.attr("datetime") ?? collapse(dateText.text());
    const spoiler = collapse(
      card
        .find(".bl_spoiler, [data-testid='review-spoiler-text'], .c-siteReview_quote span")
        .first()
        .text(),
    );
    let body = spoiler
      ? `[spoiler]${spoiler}[/spoiler]`
      : collapse(card.find("[data-testid='review-quote-text'], .review_body span").first().text());
    body = body.replace("This review contains spoilers, click expand to view.", "").trim();
    if (!body && !username) return;
    const score = Number.parseFloat(scoreText);
    reviews.push({
      content: body || undefined,
      rating: Number.isFinite(score) ? score * 10 : undefined,
      username: username || undefined,
      timestampCreated: date
        ? Math.floor(new Date(date).getTime() / 1000) || undefined
        : undefined,
    });
  });
  return reviews;
}

/** `fetch_external_reviews` dispatcher. */
export async function fetchExternalReviews(
  gameName: string,
  source: string,
): Promise<SteamReviewShape[]> {
  const normalized = source.trim().toLowerCase();
  if (normalized === "metacritic") return fetchMetacriticReviews(gameName);
  if (normalized === "opencritic") return fetchOpenCriticReviews(gameName);
  if (normalized === "rawg") {
    throw new Error(
      "RAWG reviews are not configured — add a RAWG API key before using this source.",
    );
  }
  throw new Error(`Unknown review source: ${source}`);
}

/** Exported for the harness: Metacritic HTML → score summary. */
export function parseMetacriticScoreFixture(html: string, url: string): MetacriticScore {
  return parseMetacriticScores(html, url);
}

/** Small helper kept for callers that only need plain text. */
export function reviewText(html: string): string {
  return decodeEntities(htmlToText(html));
}
