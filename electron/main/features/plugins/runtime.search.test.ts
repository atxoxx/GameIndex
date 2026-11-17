/**
 * Plugin runtime search behaviour: sandbox reuse, manifest trust and the result
 * cache. The sandbox is real QuickJS, but the plugins here never touch the
 * network — every observable goes through the injected logger.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeManifest } from "./manifest";
import { PluginRuntime } from "./runtime";
import { sha256Hex } from "./registry";
import type { PluginDocument, PluginRecord } from "./types";

const PLUGIN_ID = "probe";

/** A plugin that logs its own evaluation and every search run. */
function pluginSource(marker: string): string {
  return `
console.log("eval:${marker}");
definePlugin({
  id: "${PLUGIN_ID}",
  name: "Probe",
  version: "1.0.0",
  allowedHosts: ["example.com"],
  search: function (query) {
    console.log("run:${marker}:" + query);
    if (query === "nothing") return [];
    return [{ id: "1", title: query + " release", size: "1 GB" }];
  },
});
`;
}

interface Harness {
  runtime: PluginRuntime;
  logs: string[];
  /** Replace the file on disk (a hash change forces a re-validation). */
  writeSource(source: string): void;
  document: PluginDocument;
}

const tempDirs: string[] = [];

function createHarness(source: string): Harness {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "gi-plugin-search-"));
  tempDirs.push(baseDir);
  const pluginDir = path.join(baseDir, PLUGIN_ID);
  fs.mkdirSync(pluginDir, { recursive: true });
  const sourceFile = path.join(pluginDir, "plugin.js");
  fs.writeFileSync(sourceFile, source, "utf8");

  const manifest = normalizeManifest({
    id: PLUGIN_ID,
    name: "Probe",
    version: "1.0.0",
    allowedHosts: ["example.com"],
  });
  const record: PluginRecord = {
    id: PLUGIN_ID,
    name: "Probe",
    version: "1.0.0",
    author: "",
    description: "",
    sourceUrl: "",
    platformCategory: "pc",
    fileHash: sha256Hex(source),
    enabled: true,
    importedAt: 1,
    lastError: null,
    manifest,
  };
  const document: PluginDocument = { version: 1, plugins: [record] };
  const logs: string[] = [];
  const runtime = new PluginRuntime({
    baseDir,
    document: {
      read: () => document,
      write: (value) => {
        document.plugins = value.plugins;
        return value;
      },
    },
    logger: (...args) => logs.push(args.map((value) => String(value)).join(" ")),
  });

  return {
    runtime,
    logs,
    document,
    writeSource(next) {
      fs.writeFileSync(sourceFile, next, "utf8");
    },
  };
}

function count(logs: string[], needle: string): number {
  return logs.filter((line) => line.includes(needle)).length;
}

describe("PluginRuntime search", () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evaluates the plugin once per search, not twice", async () => {
    const harness = createHarness(pluginSource("v1"));

    const rows = await harness.runtime.searchWithPlugins("doom");

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("doom");
    // One QuickJS context for the search; the stored manifest is trusted
    // because the file hash still matches.
    expect(count(harness.logs, "eval:v1")).toBe(1);
    expect(count(harness.logs, "run:v1:doom")).toBe(1);
  });

  it("re-validates a plugin edited on disk once, then trusts the new manifest", async () => {
    const harness = createHarness(pluginSource("v1"));
    await harness.runtime.searchWithPlugins("doom");
    expect(count(harness.logs, "eval:v1")).toBe(1);

    harness.writeSource(pluginSource("v2"));

    // Hash mismatch: validation sandbox + search sandbox for this run.
    await harness.runtime.searchWithPlugins("quake");
    expect(count(harness.logs, "eval:v2")).toBe(2);
    expect(harness.document.plugins[0].fileHash).toBe(sha256Hex(pluginSource("v2")));

    // The refreshed manifest makes the next search single-sandbox again.
    await harness.runtime.searchWithPlugins("duke");
    expect(count(harness.logs, "eval:v2")).toBe(3);
  });

  it("expires empty answers after a minute but keeps hits for the full TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = Date.now();
    const harness = createHarness(pluginSource("v1"));

    await harness.runtime.searchWithPlugins("nothing");
    await harness.runtime.searchWithPlugins("nothing");
    expect(count(harness.logs, "run:v1:nothing")).toBe(1);

    // A transient "no results" must not stick for the whole 15-minute TTL.
    vi.setSystemTime(started + 61_000);
    await harness.runtime.searchWithPlugins("nothing");
    expect(count(harness.logs, "run:v1:nothing")).toBe(2);

    // Non-empty results keep the long TTL.
    vi.setSystemTime(started + 122_000);
    await harness.runtime.searchWithPlugins("doom");
    expect(count(harness.logs, "run:v1:doom")).toBe(1);
    vi.setSystemTime(started + 183_000);
    await harness.runtime.searchWithPlugins("doom");
    expect(count(harness.logs, "run:v1:doom")).toBe(1);
  });
});
