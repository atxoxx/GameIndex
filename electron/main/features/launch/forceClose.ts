/**
 * `force_close_game`.
 *
 * Ported from `src-tauri/src/launcher.rs` (`force_close_game`). Terminates the
 * tracked process, then routes through the normal session finalization so the
 * Activity row, `lastPlayed` stamp and `game-exited` event are identical to a
 * natural exit.
 *
 * The kill is path-verified first (PID-recycling guard): if the PID now belongs
 * to another executable, nothing is killed and the caller gets
 * `{ pid, killed: false }` so the UI can warn instead of pretending success.
 */
import { emit } from "../../ipc";
import { killMatchingProcesses, killProcessTree, pidMatchesExe } from "./processes";
import { activeSessions, finalizeSession } from "./sessions";

export interface ForceCloseResult {
  pid: number;
  killed: boolean;
}

export async function forceCloseGame(gameId: string): Promise<ForceCloseResult> {
  if (!gameId) throw new Error("force_close_game requires a gameId");

  const session = activeSessions.get(gameId);
  if (!session) {
    throw new Error(`Game is not running: ${gameId}`);
  }

  const pid = session.lastPid;
  const expectedExe = session.matchedExe;
  const installDir = session.installDir;

  let killed = false;
  if (expectedExe || installDir) {
    killed = await killMatchingProcesses(expectedExe, installDir);
  }
  if (!killed && pid > 0) {
    if (await pidMatchesExe(pid, expectedExe)) {
      killed = await killProcessTree(pid);
    }
  }

  // A second click (or the poll loop) may have cleared the session between the
  // read above and now. Still emit `game-exited` so the running indicator and
  // tray status clear, mirroring the Rust race handling.
  const finalized = await finalizeSession(gameId, { killedByUser: true });
  if (!finalized) {
    emit("game-exited", {
      gameId,
      elapsedSeconds: 0,
      finishedAt: Date.now(),
    });
  }

  return { pid, killed };
}
