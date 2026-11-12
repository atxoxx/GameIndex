# Capture workstream — clips, reels, replay buffer

Ported from `1b4a698b:src-tauri/src/capture/` (`mod.rs`, `windows.rs`,
`audio_windows.rs`, `listing.rs`), `reels.rs`, `db/clips.rs` and
`db/schema_clips.sql`.

## Files

| File | Role |
| --- | --- |
| `types.ts` | Wire + storage shapes (camelCase, same as the Rust serde contract) |
| `library.ts` | `clips.json` registry, reels, clips folder (listing/delete/reveal) |
| `ffmpeg.ts` | One-time capability probe, dshow device listing, recorder/replay processes, remux/concat |
| `controller.ts` | One-session state machine, events, app-quit cleanup |
| `../../commands/capture.ts` | Command registration |

## Storage

* `userData/clips.json` — `{ version: 1, clips: ClipRow[], reels: ReelRow[] }`,
  written atomically through `state/jsonStore.ts`. One document because a clip
  delete must also remove reel items in the same write.
* Clips: `videoFolder` from the overlay settings, else
  `Videos\GameIndex\Clips` (`app.getPath("videos")`).
* Replay buffer: `userData/capture/replay/buffer-<stamp>-<pid>/buf_*.ts`
  (deleted when the buffer stops; a crash at worst leaves that directory).
* Manual recordings are staged as `.recording-<stamp>-<pid>.ts` next to the
  final file and are hidden from `capture_get_recent_clips` (dot prefix).

## Recording

* Backend: `ffmpeg` from PATH, detected once (`ffmpeg -version`) and cached.
  `gdigrab` captures the primary display in physical pixels; `dshow` supplies
  audio. Every spawn uses an argv array and `shell: false`.
* Windows has no SIGINT for children, so a manual recording writes MPEG-TS and
  is remuxed to MP4 (`-c copy -movflags +faststart`) after the process is
  terminated. If the remux fails the transport stream is kept as the clip
  instead of throwing the take away.
* The replay buffer writes uniquely named 2–10 s TS segments (`-strftime 1`,
  never overwritten). Saving copies nothing: it concatenates the newest
  finalized segments (`-f concat -c copy`) while the buffer keeps running.
  The newest (still open) segment is retried without if the concat fails.
* Audio is limited to real dshow endpoints. Game audio needs a loopback device
  (Stereo Mix / virtual-audio-capturer); otherwise only the microphone is
  recorded. `capture_list_audio_devices` splits the flat dshow list into
  `output`/`input` with a documented name heuristic, because ffmpeg does not
  expose direction.
* No ffmpeg → `capture_is_supported` is `false`; start/stop/save commands throw
  `ffmpeg not found — install ffmpeg and add it to PATH, then restart GameIndex`.
  Nothing is spawned and no file is written.
* `before-quit` kills the encoder and remuxes synchronously (`spawnSync`) so a
  recording is not lost when the app closes mid-take. A hard crash of the main
  process can still orphan the ffmpeg child (Node cannot put it in a job
  object without native code); the next start reclaims abandoned staging files
  and replay buffers, and Windows will not delete files the orphan still holds.

## Behaviour notes / deviations

* `capture_is_supported` returns a **boolean** (the overlay binds it directly);
  the reason is reported by `capture_get_state().error` and the diagnostic
  `__capture_capabilities` command.
* `register_clip` fills `sizeBytes` from disk when the caller omits it (the Reels
  page imports by path only).
* `capture_delete_clip` also drops the registry row and its reel memberships, so
  the gallery cannot keep pointing at a deleted file.
* `.ts` is accepted by the listing/deletion guards because it is the
  kill-safe staging format and the remux fallback. The overlay preview cannot
  play a `.ts` file (the renderer's MIME map has no entry for it); it can be
  opened from the OS.
* Starting a replay buffer while recording finalizes the recording **and emits**
  `capture:clip-saved` (the Rust build dropped the clip silently).
* The replay buffer is always H.264/MP4 even when `videoFormat` is `webm`
  (VP9-in-TS is not a reliable concat path).
* `reels_get_snapshot` returns exactly `{ clips, reels }`; clips are sorted by
  `createdAt` desc, reels by `updatedAt` desc, matching the SQL DAO.
