import { describe, expect, it } from "vitest";
import type { StoreInstall } from "../../types/storeInstalls";
import {
  formatEtaLabel,
  storeInstallDetail,
  storeInstallHeadline,
  storeInstallPercent,
} from "./storeInstallText";

const dict: Record<string, string> = {
  "storeInstall.starting": "Starting…",
  "storeInstall.downloading": "Downloading…",
  "storeInstall.downloadingPercent": "Downloading · {percent}%",
  "storeInstall.installing": "Installing…",
  "storeInstall.installingPercent": "Installing · {percent}%",
  "download.status.secondsRemaining": "{seconds}s left",
  "download.status.minutesRemaining": "{minutes}m {remainingSeconds}s left",
  "download.status.hoursRemaining": "{hours}h {remainingMinutes}m left",
  "download.status.daysRemaining": "{days}d {remainingHours}h left",
  "download.status.over30d": "more than 30 days",
};

function t(key: string, vars?: Record<string, unknown>): string {
  const template = dict[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ""));
}

function entry(overrides: Partial<StoreInstall> = {}): StoreInstall {
  return {
    key: "steam:440",
    gameId: "g1",
    source: "steam",
    appId: "440",
    title: "Team Fortress 2",
    state: "downloading",
    percent: 42.4,
    downloaded: 400,
    total: 1000,
    speed: 12_500_000,
    eta: 190,
    ...overrides,
  };
}

describe("storeInstallPercent", () => {
  it("rounds and caps just below a hundred while a transfer is still running", () => {
    expect(storeInstallPercent(entry({ percent: 42.4 }))).toBe(42);
    expect(storeInstallPercent(entry({ percent: 99.9 }))).toBe(99);
    expect(storeInstallPercent(entry({ percent: 120 }))).toBe(99);
  });

  it("returns null when the store cannot report a percentage", () => {
    expect(storeInstallPercent(entry({ percent: null }))).toBeNull();
    expect(storeInstallPercent(entry({ percent: Number.NaN }))).toBeNull();
  });
});

describe("storeInstallHeadline", () => {
  it("names the phase and the percentage", () => {
    expect(storeInstallHeadline(entry(), t)).toBe("Downloading · 42%");
    expect(storeInstallHeadline(entry({ state: "installing", percent: 88 }), t)).toBe(
      "Installing · 88%",
    );
  });

  it("falls back to a phase without a number when there is none", () => {
    expect(storeInstallHeadline(entry({ percent: null }), t)).toBe("Downloading…");
    expect(storeInstallHeadline(entry({ state: "pending", percent: null }), t)).toBe("Starting…");
  });
});

describe("storeInstallDetail", () => {
  const speed = (bytes: number) => `${bytes} B/s`;
  const eta = (seconds: number) => `${seconds}s`;

  it("joins speed and time left", () => {
    expect(storeInstallDetail(entry(), speed, eta)).toBe("12500000 B/s · 190s");
  });

  it("drops the line for a phase that has no transfer rate", () => {
    expect(storeInstallDetail(entry({ speed: null, eta: null }), speed, eta)).toBeNull();
    expect(storeInstallDetail(entry({ state: "installing" }), speed, eta)).toBeNull();
  });
});

describe("formatEtaLabel", () => {
  it("uses the download page's wording for each bucket", () => {
    expect(formatEtaLabel(45, t)).toBe("45s left");
    expect(formatEtaLabel(190, t)).toBe("3m 10s left");
    expect(formatEtaLabel(3700, t)).toBe("1h 1m left");
    expect(formatEtaLabel(60 * 60 * 24 * 2, t)).toBe("2d 0h left");
    expect(formatEtaLabel(60 * 60 * 24 * 31, t)).toBe("more than 30 days");
  });
});
