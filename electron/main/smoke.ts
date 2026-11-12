/**
 * Headless-ish smoke run: `GI_SMOKE_TEST=1 npx electron out/main/index.cjs`.
 *
 * Boots the real app, records renderer console errors and load failures, prints
 * the window inventory, then exits. Used to verify the Electron conversion
 * without clicking through the UI.
 */
import { BrowserWindow, app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { COMMAND_CATALOG } from "./commands/commandCatalog";
import { getStubbedCommandNames } from "./commands";
import { getWindowLabel, listCommands } from "./ipc";

const BOOT_BUDGET_MS = Number(process.env.GI_SMOKE_TIMEOUT ?? 15_000);

/**
 * A packaged GUI app on Windows has no attached stdout, so the harness also
 * writes to `%TEMP%\gameindex-smoke.log`.
 */
function makeLogger(): (line: string) => void {
  const file = path.join(app.getPath("temp"), "gameindex-smoke.log");
  try {
    fs.writeFileSync(file, "");
  } catch {
    /* ignore */
  }
  return (line: string) => {
    try {
      console.log(line);
    } catch {
      /* no attached stdout in a packaged GUI app */
    }
    try {
      fs.appendFileSync(file, `${line}\n`);
    } catch {
      /* ignore */
    }
  };
}

export function installSmokeTest(): void {
  if (process.env.GI_SMOKE_TEST !== "1") return;

  const log = makeLogger();
  const fatal: string[] = [];
  const consoleErrors: string[] = [];
  const probes = (process.env.GI_SMOKE_COMMANDS ?? "")
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((entry) => {
      // `cmd` or `cmd:{"json":"args"}` — arguments after the first colon.
      const index = entry.indexOf(":");
      if (index <= 0) return { cmd: entry, args: undefined };
      const raw = entry.slice(index + 1);
      try {
        return { cmd: entry.slice(0, index), args: JSON.parse(raw) as unknown };
      } catch {
        return { cmd: entry, args: undefined };
      }
    });

  app.on("browser-window-created", (_event, win) => {
    const contents = win.webContents;

    // `GI_SMOKE_COMMANDS=a,b,c` invokes real backend commands through the
    // preload bridge once the renderer has loaded, so the harness can prove
    // return shapes without clicking through the UI.
    if (probes.length > 0) {
      contents.once("did-finish-load", () => {
        if (getWindowLabel(win) !== "main") return;
        void (async () => {
          for (const probe of probes) {
            // Give async sources (tasklist/typeperf/nvidia-smi children) a beat
            // to land before the next probe reads their cache.
            await new Promise((resolve) => setTimeout(resolve, 350));
            try {
              const value = await contents.executeJavaScript(
                `window.__giBridge.invoke(${JSON.stringify(probe.cmd)}, ${JSON.stringify(probe.args)})`,
              );
              const serialized = JSON.stringify(value);
              log(
                `[smoke:cmd] ${probe.cmd} => ${serialized === undefined ? "null" : serialized}`.slice(0, 400),
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              log(`[smoke:cmd] ${probe.cmd} !! ${message.slice(0, 300)}`);
            }
          }
        })();
      });
    }

    contents.on("did-fail-load", (_e, code, description, url) => {
      const line = `did-fail-load ${code} ${description} ${url}`;
      fatal.push(line);
      log(`[smoke] ${line}`);
    });

    contents.on("render-process-gone", (_e, details) => {
      const line = `render-process-gone ${details.reason}`;
      fatal.push(line);
      log(`[smoke] ${line}`);
    });

    // Electron ≥34 passes a details object; older signatures pass positional
    // args. Accept both so the harness survives a version bump.
    contents.on("console-message", (...args: unknown[]) => {
      const details = args[1] as
        | { level?: string | number; message?: string }
        | number
        | undefined;
      const level = typeof details === "number" ? details : details?.level;
      const message =
        typeof details === "object" && details !== null
          ? details.message
          : (args[2] as string | undefined);
      const isError = level === 3 || level === "error" || level === 2;
      if (isError && message) {
        if (consoleErrors.length < 40) consoleErrors.push(message);
        log(`[smoke:renderer] ${message}`);
      }
    });
  });

  setTimeout(() => {
    const fatalCount = fatal.length;
    try {
      const windows = BrowserWindow.getAllWindows().map((win) => ({
        label: getWindowLabel(win),
        visible: win.isVisible(),
        url: win.webContents.getURL(),
      }));
      log(`[smoke] windows: ${JSON.stringify(windows)}`);
      const stubNames = getStubbedCommandNames();
      log(
        `[smoke] commands: ${COMMAND_CATALOG.length - stubNames.length}/${COMMAND_CATALOG.length} catalog names implemented (${listCommands().length} handlers, ${stubNames.length} stubs)`,
      );
      if (process.env.GI_SMOKE_DUMP === "1") {
        const dumpFile = path.join(app.getPath("temp"), "gameindex-stubs.txt");
        fs.writeFileSync(dumpFile, `${stubNames.join("\n")}\n`);
        log(`[smoke] stubs written to ${dumpFile}`);
      }
      log(`[smoke] renderer console errors: ${consoleErrors.length}`);
      log(`[smoke] fatal errors: ${fatalCount}`);
      log("[smoke] done");
    } finally {
      // Console errors are expected while features are still stubbed; only a
      // failed load or a dead renderer fails the smoke run.
      app.exit(fatalCount === 0 ? 0 : 2);
    }
  }, BOOT_BUDGET_MS);
}
