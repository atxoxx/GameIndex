/**
 * ROM-folder watcher.
 *
 * Ported from `src-tauri/src/emulation.rs` (`start_rom_watcher`): every 25 s
 * (300 s when no emulator has a ROM folder) compare a cheap top-level signature
 * of each configured folder; when it changes, emit `rom-folder-changed` with
 * `{ emulatorId, folder, autoScan }`. The Emulators page listens for exactly
 * that event and either rescans automatically or offers a toast.
 *
 * The timer is `unref`'d so it never keeps the process alive, and it is skipped
 * in the boot smoke test (a synthetic run must not emit watcher noise).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { emit } from "../../ipc";
import { listEmulators } from "./store";

const ACTIVE_INTERVAL_MS = 25_000;
const IDLE_INTERVAL_MS = 300_000;

type Signature = Array<[string, number, number]>;

let started = false;
let stopped = false;

async function folderSignature(folder: string): Promise<Signature | null> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(folder, { withFileTypes: true });
  } catch {
    return null;
  }
  const signature: Signature = [];
  for (const entry of entries) {
    let size = 0;
    let modified = 0;
    try {
      const stat = await fsp.stat(path.join(folder, entry.name));
      size = stat.size;
      modified = Math.floor(stat.mtimeMs);
    } catch {
      continue;
    }
    signature.push([entry.name, size, modified]);
  }
  signature.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return signature;
}

function signaturesEqual(left: Signature | null, right: Signature | null): boolean {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return false;
  }
  return true;
}

/** Start the watcher once (idempotent). Safe to call from the registrar. */
export function startRomWatcher(): void {
  if (started || stopped) return;
  started = true;
  if (process.env.GI_SMOKE_TEST === "1") return;

  const lastSignatures = new Map<string, Signature | null>();
  let hasTargets = true;

  const tick = async (): Promise<void> => {
    try {
      const emulators = listEmulators();
      let targets = 0;
      for (const emulator of emulators) {
        const folder = emulator.romFolder.trim();
        if (!folder) continue;
        targets += 1;
        const current = await folderSignature(folder);
        const previous = lastSignatures.get(emulator.id);
        if (previous === undefined) {
          lastSignatures.set(emulator.id, current);
          continue;
        }
        if (current && !signaturesEqual(previous, current)) {
          lastSignatures.set(emulator.id, current);
          emit("rom-folder-changed", {
            emulatorId: emulator.id,
            folder,
            autoScan: emulator.autoScan === true,
          });
        }
      }
      const live = new Set(emulators.map((emulator) => emulator.id));
      for (const id of [...lastSignatures.keys()]) {
        if (!live.has(id)) lastSignatures.delete(id);
      }
      hasTargets = targets > 0;
    } catch (error) {
      console.error("[emulators] ROM folder watcher failed:", error);
    } finally {
      if (!stopped) {
        const timer = setTimeout(
          () => void tick(),
          hasTargets ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS,
        );
        timer.unref();
      }
    }
  };

  const initial = setTimeout(() => void tick(), ACTIVE_INTERVAL_MS);
  initial.unref();
}

/** Stop the watcher (tests / app teardown). */
export function stopRomWatcher(): void {
  stopped = true;
}
