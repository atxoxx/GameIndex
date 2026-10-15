import { describe, it, expect, beforeEach } from "vitest";
import {
  cacheCapableProvider,
  cacheKeyFor,
  cacheMagnetFor,
  clearSessionCache,
  getSessionCache,
  setSessionCache,
} from "./cacheCheck";

const HASH = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";

describe("cacheCapableProvider", () => {
  it("accepts only providers with a cache endpoint", () => {
    expect(cacheCapableProvider("alldebrid")).toBe(true);
    expect(cacheCapableProvider("TorBox")).toBe(true);
    expect(cacheCapableProvider("realdebrid")).toBe(false);
    expect(cacheCapableProvider("none")).toBe(false);
    expect(cacheCapableProvider("")).toBe(false);
  });
});

describe("cacheMagnetFor", () => {
  it("prefers an explicit magnet", () => {
    expect(cacheMagnetFor({ magnet: "magnet:?xt=urn:btih:abc", infohash: HASH })).toBe(
      "magnet:?xt=urn:btih:abc",
    );
  });

  it("promotes a bare infohash to a magnet", () => {
    expect(cacheMagnetFor({ magnet: null, infohash: HASH })).toBe(
      `magnet:?xt=urn:btih:${HASH}`,
    );
  });

  it("ignores a malformed hash and returns null when uncheckable", () => {
    expect(cacheMagnetFor({ magnet: null, infohash: "not-a-hash" })).toBeNull();
    expect(cacheMagnetFor({ magnet: null, infohash: undefined })).toBeNull();
  });
});

describe("cacheKeyFor", () => {
  it("shares a key across results with the same infohash", () => {
    const a = cacheKeyFor("alldebrid", { magnet: `magnet:?xt=urn:btih:${HASH}` });
    const b = cacheKeyFor("Alldebrid", { magnet: null, infohash: HASH });
    expect(a).toBe(b);
  });

  it("scopes the key by provider and returns null when uncheckable", () => {
    expect(cacheKeyFor("alldebrid", { magnet: null, infohash: HASH })).not.toBe(
      cacheKeyFor("torbox", { magnet: null, infohash: HASH }),
    );
    expect(cacheKeyFor("alldebrid", { magnet: null, infohash: undefined })).toBeNull();
  });
});

describe("session cache", () => {
  beforeEach(() => clearSessionCache());

  it("remembers verdicts until cleared", () => {
    expect(getSessionCache("k")).toBeUndefined();
    setSessionCache("k", true);
    expect(getSessionCache("k")).toBe(true);
    setSessionCache("k", false);
    expect(getSessionCache("k")).toBe(false);
    clearSessionCache();
    expect(getSessionCache("k")).toBeUndefined();
  });
});
