/**
 * Discord Rich Presence, ported from `src-tauri/src/discord_presence.rs`.
 *
 * The Rust build used the `discord-rich-presence` crate, which speaks the
 * Discord RPC protocol over the local IPC socket the desktop client exposes
 * (`\\.\pipe\discord-ipc-N` on Windows, `$XDG_RUNTIME_DIR/discord-ipc-N` on
 * Linux/macOS). No npm client is needed for that: the wire format is a
 * 8-byte header (opcode + payload length, both int32 LE) followed by a JSON
 * body, so this module implements the four messages presence needs:
 *
 *   HANDSHAKE      { v: 1, client_id }        (op 0)
 *   SET_ACTIVITY   { cmd, args, nonce }       (op 1)
 *   PING / PONG    keepalive                  (op 3 / 4)
 *   CLOSE                                     (op 2)
 *
 * The renderer owns the decision of what to advertise: `useDiscordPresence`
 * emits `discord-presence-update` events (see `src/hooks/useDiscordPresence.ts`)
 * and this module maps the payload onto a Discord activity, owns the socket,
 * reconnects when Discord restarts and reports connection state back through
 * `discord-presence-status` so Settings can show "Discord is not running".
 *
 * The application id comes from `DISCORD_CLIENT_ID` (`electron.vite` bakes it
 * into the main bundle at build time), exactly like the Rust build.
 */
import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

import { emit, onEvent } from "../../ipc";
import { getSecret } from "../../lib/secrets";
import { getAppSetting } from "../../state/appSettings";

/** Discord's RPC opcodes (op is a little-endian int32 in the header). */
const OP = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
} as const;

/** Discord rejects longer strings with an ERROR frame instead of truncating. */
const MAX_TEXT = 128;
const MAX_BUTTON_LABEL = 32;
const MAX_ASSET_URL = 256;

const READY_TIMEOUT_MS = 4_000;
const RETRY_DELAY_MS = 15_000;

/** Discord exposes `discord-ipc-0` … `discord-ipc-9`; probe them in order. */
const MAX_PIPE_INDEX = 10;

/**
 * The `discord-presence-update` payload emitted by the renderer.
 *
 * Every field except `state` is optional: `useDiscordPresence` sends a minimal
 * `{ state: "stopped" }` when presence is switched off or should be cleared.
 */
export interface DiscordPresencePayload {
  /** `"playing"`, `"browsing"`, `"downloading"` or `"stopped"`. */
  state: string;
  gameId?: string;
  gameName?: string;
  /** Unix milliseconds. */
  startedAt?: number;
  /** Unix milliseconds; drives Discord's live countdown. */
  endsAt?: number;
  details?: string;
  stateText?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  largeUrl?: string;
  smallUrl?: string;
  detailsUrl?: string;
  stateUrl?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  button2Label?: string;
  button2Url?: string;
  /** `"playing"` (default) | `"listening"` | `"watching"` | `"competing"`. */
  activityType?: string;
  /** `"name"` | `"state"` | `"details"` — which line the member list shows. */
  statusDisplay?: string;
  partyId?: string;
  partyCurrent?: number;
  partyMax?: number;
}

interface RpcFrame {
  cmd?: string;
  evt?: string;
  data?: unknown;
  nonce?: string;
}

// ── activity mapping ────────────────────────────────────────────────

/** Playing = 0, Listening = 2, Watching = 3, Competing = 5 (RPC enum). */
function activityType(value: string | undefined): number {
  switch (value) {
    case "listening":
      return 2;
    case "watching":
      return 3;
    case "competing":
      return 5;
    default:
      return 0;
  }
}

/** Name = 0, State = 1, Details = 2. Details is the most informative. */
function statusDisplayType(value: string | undefined): number {
  switch (value) {
    case "name":
      return 0;
    case "state":
      return 1;
    default:
      return 2;
  }
}

function clampText(value: string | undefined, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Discord fetches activity art server-side, so `assets.*_image` must be a
 * public https URL (or an uploaded asset key). Anything else - a `data:` URI,
 * a `giasset://` path, a Tauri asset URL - is dropped instead of being sent
 * and rejected.
 */
function httpsUrl(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  return /^https:\/\//i.test(url) ? url.slice(0, MAX_ASSET_URL) : undefined;
}

/**
 * Map a renderer payload onto Discord's activity object.
 *
 * Mirrors `build_activity` in the Rust module: `details` falls back to the
 * game name, an empty `stateText` is omitted (browsing has no second line),
 * timestamps are converted from ms to unix seconds, assets are only attached
 * when an image is present, at most two buttons are sent, and a party is only
 * attached when it has a positive size.
 */
export function buildActivity(payload: DiscordPresencePayload): Record<string, unknown> {
  const details = clampText(payload.details ?? payload.gameName) ?? "";
  const activity: Record<string, unknown> = {
    details,
    type: activityType(payload.activityType),
    status_display_type: statusDisplayType(payload.statusDisplay),
  };

  const state = clampText(payload.stateText);
  if (state) activity.state = state;

  const detailsUrl = httpsUrl(payload.detailsUrl);
  if (detailsUrl) activity.details_url = detailsUrl;
  const stateUrl = httpsUrl(payload.stateUrl);
  if (stateUrl) activity.state_url = stateUrl;

  const startedAt = Number(payload.startedAt ?? 0);
  const endsAt = Number(payload.endsAt ?? 0);
  if (startedAt > 0 || endsAt > 0) {
    const timestamps: Record<string, number> = {};
    if (startedAt > 0) timestamps.start = Math.floor(startedAt / 1000);
    if (endsAt > 0) timestamps.end = Math.floor(endsAt / 1000);
    activity.timestamps = timestamps;
  }

  const largeImage = httpsUrl(payload.largeImage);
  const smallImage = httpsUrl(payload.smallImage);
  if (largeImage || smallImage) {
    const assets: Record<string, string> = {};
    if (largeImage) assets.large_image = largeImage;
    const largeText = clampText(payload.largeText);
    if (largeText) assets.large_text = largeText;
    if (smallImage) assets.small_image = smallImage;
    const smallText = clampText(payload.smallText);
    if (smallText) assets.small_text = smallText;
    const largeUrl = httpsUrl(payload.largeUrl);
    if (largeUrl) assets.large_url = largeUrl;
    const smallUrl = httpsUrl(payload.smallUrl);
    if (smallUrl) assets.small_url = smallUrl;
    activity.assets = assets;
  }

  const buttons: { label: string; url: string }[] = [];
  for (const [label, url] of [
    [payload.buttonLabel, payload.buttonUrl],
    [payload.button2Label, payload.button2Url],
  ] as const) {
    const text = clampText(label, MAX_BUTTON_LABEL);
    const href = httpsUrl(url);
    if (text && href) buttons.push({ label: text, url: href });
  }
  if (buttons.length > 0) activity.buttons = buttons.slice(0, 2);

  const partyMax = Number(payload.partyMax ?? 0);
  if (payload.partyId && Number.isFinite(partyMax) && partyMax > 0) {
    const partyCurrent = Math.min(
      Math.max(Number(payload.partyCurrent ?? 1) || 1, 0),
      partyMax,
    );
    activity.party = { id: payload.partyId, size: [partyCurrent, partyMax] };
  }

  return activity;
}

// ── IPC transport ───────────────────────────────────────────────────

function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload ?? {}), "utf8");
  const frame = Buffer.alloc(8 + body.length);
  frame.writeInt32LE(op, 0);
  frame.writeInt32LE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

/**
 * Socket paths Discord may be listening on, in probe order. Windows uses the
 * named-pipe namespace; everywhere else Discord creates a unix socket in the
 * runtime/temp dirs (including the Flatpak/Snap ones, like other RPC clients).
 */
function socketPaths(): string[] {
  const override = process.env.GI_DISCORD_IPC_PATH;
  if (override) return [override];

  if (process.platform === "win32") {
    return Array.from({ length: MAX_PIPE_INDEX }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }

  const dirs = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    "/tmp",
    path.join(os.homedir(), ".flatpak", "app", "com.discordapp.Discord", "xdg-run"),
  ].filter((dir): dir is string => Boolean(dir));
  const unique = [...new Set(dirs)];
  return unique.flatMap((dir) =>
    Array.from({ length: MAX_PIPE_INDEX }, (_, i) => path.join(dir, `discord-ipc-${i}`)),
  );
}

function openSocket(): Promise<net.Socket | null> {
  const paths = socketPaths();
  return new Promise((resolve) => {
    let index = 0;
    const attempt = (): void => {
      if (index >= paths.length) {
        resolve(null);
        return;
      }
      const target = paths[index++];
      const socket = net.createConnection(target);
      const onError = (): void => {
        socket.destroy();
        attempt();
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        resolve(socket);
      });
    };
    attempt();
  });
}

// ── connection state ────────────────────────────────────────────────

let started = false;
let clientId: string | null = null;

let socket: net.Socket | null = null;
let receiveBuffer: Buffer = Buffer.alloc(0);
let connected = false;
let connecting: Promise<boolean> | null = null;
let readyResolve: ((ok: boolean) => void) | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let lastActivity: Record<string, unknown> | null = null;
let disposed = false;
/** Last connection state announced to the renderer, to avoid event spam. */
let reportedConnected: boolean | null = null;

function reportConnected(next: boolean): void {
  if (reportedConnected === next) return;
  reportedConnected = next;
  emit("discord-presence-status", { connected: next });
}

/** Push the current connection state even when it has not changed: the
 *  renderer subscribes after its first commands, so a deduped event from boot
 *  would otherwise leave Settings showing "idle". */
function announceStatus(): void {
  reportedConnected = connected;
  emit("discord-presence-status", { connected });
}

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * Keep trying to reach Discord while the feature is on. Discord may be started
 * after GameIndex (or restarted), and the renderer only emits on state changes
 * - without this, presence would stay dark until the user navigated again.
 */
function scheduleRetry(): void {
  if (disposed || retryTimer || !started || !clientId) return;
  if (!getAppSetting("discord_presence")) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (disposed) return;
    void ensureConnected().then((ok) => {
      if (disposed) return;
      if (ok) {
        if (lastActivity) void writeActivity(lastActivity);
      } else {
        scheduleRetry();
      }
    });
  }, RETRY_DELAY_MS);
  retryTimer.unref?.();
}

function handleFrame(frame: RpcFrame): void {
  if (frame.evt === "READY") {
    connected = true;
    const resolve = readyResolve;
    readyResolve = null;
    resolve?.(true);
    return;
  }
  if (frame.evt === "ERROR") {
    console.warn("[discord] activity rejected:", JSON.stringify(frame.data ?? {}).slice(0, 400));
    const resolve = readyResolve;
    readyResolve = null;
    resolve?.(false);
    return;
  }
  if (frame.cmd === "DISPATCH" && frame.evt === "ACTIVITY_JOIN") {
    // Not a game with join/spectate support; ignore the invite prompt.
    return;
  }
}

function handleOpcode(op: number, body: Buffer): void {
  if (op === OP.PING) {
    // Discord closes the pipe if a PING goes unanswered.
    socket?.write(encodeFrame(OP.PONG, safeJson(body)));
    return;
  }
  if (op === OP.CLOSE) {
    socket?.destroy();
    return;
  }
  const frame = safeJson(body);
  if (frame && typeof frame === "object") handleFrame(frame as RpcFrame);
}

function safeJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}

function onGone(): void {
  socket = null;
  connected = false;
  receiveBuffer = Buffer.alloc(0);
  const resolve = readyResolve;
  readyResolve = null;
  resolve?.(false);
  reportConnected(false);
  // The renderer keeps advertising the same page/game, so reconnect in the
  // background: Discord may simply have been restarted.
  scheduleRetry();
}

function attach(sock: net.Socket): void {
  socket = sock;
  receiveBuffer = Buffer.alloc(0);

  sock.on("data", (chunk: Buffer) => {
    receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
    while (receiveBuffer.length >= 8) {
      const op = receiveBuffer.readInt32LE(0);
      const length = receiveBuffer.readInt32LE(4);
      if (length < 0 || receiveBuffer.length < 8 + length) return;
      const body = receiveBuffer.subarray(8, 8 + length);
      receiveBuffer = receiveBuffer.subarray(8 + length);
      handleOpcode(op, body);
    }
  });
  sock.on("error", onGone);
  sock.on("close", onGone);

  sock.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: clientId }));
}

function waitForReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      readyResolve = null;
      resolve(connected);
    }, READY_TIMEOUT_MS);
    timer.unref?.();
    readyResolve = (ok) => {
      clearTimeout(timer);
      resolve(ok);
    };
  });
}

/**
 * Connect + handshake, or reuse the live socket. Resolves `false` when Discord
 * is not running (or refused the handshake) so callers can retry later.
 */
function ensureConnected(): Promise<boolean> {
  if (connected && socket) return Promise.resolve(true);
  if (connecting) return connecting;
  if (!clientId || disposed) return Promise.resolve(false);

  connecting = (async () => {
    try {
      const sock = await openSocket();
      if (!sock) {
        reportConnected(false);
        return false;
      }
      attach(sock);
      const ok = await waitForReady();
      if (!ok) {
        sock.destroy();
        socket = null;
        reportConnected(false);
        return false;
      }
      reportConnected(true);
      return true;
    } catch (error) {
      console.warn("[discord] connect failed:", error instanceof Error ? error.message : error);
      socket?.destroy();
      socket = null;
      reportConnected(false);
      return false;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

async function writeActivity(activity: Record<string, unknown> | null): Promise<boolean> {
  if (!(await ensureConnected())) return false;
  if (disposed || !socket) return false;
  try {
    socket.write(
      encodeFrame(OP.FRAME, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity },
        nonce: randomUUID(),
      }),
    );
    return true;
  } catch {
    onGone();
    return false;
  }
}

async function pushActivity(): Promise<void> {
  if (!lastActivity) return;
  const ok = await writeActivity(lastActivity);
  if (!ok) scheduleRetry();
}

/** Drop the activity without opening a connection just to say "nothing". */
function clearActivity(): void {
  lastActivity = null;
  clearRetryTimer();
  if (!connected && !socket) return;
  void writeActivity(null);
}

/** Apply one renderer payload: clear, or advertise the new activity. */
function applyPayload(payload: DiscordPresencePayload): void {
  if (disposed) return;
  if (payload.state === "stopped" || !getAppSetting("discord_presence")) {
    clearActivity();
    return;
  }
  lastActivity = buildActivity(payload);
  void pushActivity();
}

// ── public surface ──────────────────────────────────────────────────

/**
 * Register the `discord-presence-update` listener and connect when the user
 * already opted in. Idempotent; the app calls it once while booting.
 */
export function startDiscordPresence(): void {
  if (started) return;
  started = true;

  const id = getSecret("DISCORD_CLIENT_ID");
  if (!id) {
    console.warn("[discord] DISCORD_CLIENT_ID is not configured; presence disabled");
    return;
  }
  clientId = id;

  onEvent("discord-presence-update", (payload) => {
    if (!payload || typeof payload !== "object") return;
    applyPayload(payload as DiscordPresencePayload);
  });

  app.on("before-quit", () => {
    disposed = true;
    clearRetryTimer();
    if (socket) {
      try {
        socket.write(encodeFrame(OP.CLOSE, {}));
      } catch {
        /* already gone */
      }
      socket.destroy();
      socket = null;
    }
  });

  if (getAppSetting("discord_presence")) {
    void ensureConnected().then((ok) => {
      if (!ok) scheduleRetry();
    });
  }
}

/**
 * Flip the master switch. Disabling clears whatever is on the profile right
 * away (the renderer also emits `stopped`, this just makes it immediate).
 */
export function setDiscordPresenceEnabled(enabled: boolean): void {
  if (disposed) return;
  if (enabled) {
    void ensureConnected().then((ok) => {
      // Answer the renderer's toggle with the real state so Settings can show
      // "Discord is not running" instead of waiting for a later change.
      announceStatus();
      if (!ok) scheduleRetry();
      else if (lastActivity) void writeActivity(lastActivity);
    });
    return;
  }
  reportedConnected = null;
  clearActivity();
}

/** Connection state, for diagnostics/tests. */
export function isDiscordPresenceConnected(): boolean {
  return connected;
}
