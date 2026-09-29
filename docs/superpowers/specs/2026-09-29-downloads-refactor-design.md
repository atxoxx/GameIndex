# Downloads page refactor — design spec

**Date:** 2026-09-29
**Status:** Approved
**Scope:** Downloads page layout, scheduling subsystem, diagnostics subsystem (full stack).

## Problem

The Downloads page (`src/pages/DownloadsPage.tsx`) is a single flat vertical
stack: header → bandwidth hero → sparkline → filter bar → one list/grid section,
with every secondary surface (history, statistics, diagnostics, speed limits)
buried in modals. The engine is deliberately queue-less, so there is no way to
delay a transfer or cap how many run at once, and the only "diagnostics" today
is a table inside `DownloadStatsModal`.

## Goal

1. Reorganise the page into tabs (Active / Scheduled / History / Diagnostics).
2. Add real scheduling: start at a time or inside a window, per-download start
   time, time-of-day bandwidth rules, and a max-concurrent limit.
3. Add a first-class diagnostics surface: live engine health, disk/storage, an
   error log, and an exportable report.

## Non-goals

- Rewriting the download engine. The existing concurrent engine is kept; the
  scheduler gates entry to it.
- Replacing `DownloadStatsModal`. It stays reachable from the hero.
- New heavyweight dependencies.

## Architecture

### Page shell

Persistent chrome above the tabs: `PageHeader` (title + Add Download) and
`BandwidthHero`. Below them a `role="tablist"` bar (mirroring the
`.dl-stats-nav-bar` convention) switching panels:

| Tab | Content |
|---|---|
| Active | Bandwidth sparkline, filter bar, toolbar, list/grid/compact (existing). |
| Scheduled | Global scheduler config card + waiting/pinned queue. |
| History | The `download_history` ledger, promoted out of the stats modal. |
| Diagnostics | Engine health, disk, error log, export. |

`PageWidget` wrappers are preserved. New widget keys are registered in
`interfaceLayout`, `widgetIcons`, `DownloadsPagePreview`, and `theme.css`.

### Scheduling

**Global config** persisted in `db::kv` under `download_scheduler` (JSON),
loaded in `initialize_engine`, exposed to the frontend via
`scheduler_get_config` / `scheduler_set_config`. Shape:

```
enabled, windowEnabled, windowStart "HH:MM", windowEnd "HH:MM", days[7],
maxConcurrent (0 = unlimited), autoStartQueued,
bandwidthRules[{ id, label, days[7], start, end, downloadKbps, uploadKbps, disableUpload }]
```

**Per-download** `scheduled_start_at: Option<u64>` on `Download`
(`#[serde(default)]`, plus the legacy v1 migration literal). Set via
`download_set_schedule(id, at)`.

**Loop.** A dedicated tokio task (~30 s cadence) spawned in
`initialize_engine`, using the existing "collect under lock → act after
releasing it" discipline. It starts due in-window records subject to
`maxConcurrent`.

**Concurrency gate.** The authoritative check-and-set is inside
`begin_download()` under one write lock; when the cap is reached the record is
left `Queued` and `false` is returned, so concurrent manual resumes cannot
overshoot. `resume_in_progress()` and `torrent_resume_all` respect the
scheduler.

**Bandwidth rules.** On rule transitions the loop calls the existing
`torrent_set_speed_limits()` (direct/debrid throttling is read per-chunk from
`DIRECT_LIMIT_BPS`, so it applies without a worker restart). Base limits are
kept on the manager so rules do not clobber the user's setting. `kbps × 1024`
is preserved.

**Invariant.** A held download stays `Queued`, never `FetchingMetadata`, so the
360 s metadata watchdog cannot fire on it.

### Diagnostics

New module `src-tauri/src/downloads/diagnostics.rs` + command
`download_diagnostics()`:

1. **Live engine health** — per download: librqbit peer breakdown
   (`live/live_tcp/live_utp/queued/connecting/dead/seen/steals`), ETA, average
   piece time, error string; session counters. HTTP: module-level `AtomicU64`
   counters next to `DIRECT_LIMIT_BPS` for retries, stalls, 429/transient,
   mirror switches, segment reconnects.
2. **Disk / storage** — `resolve_mounts` per active save path, `.gamelib_tmp`
   size per in-flight download, queue footprint vs. free space.
3. **Error & event log** — recent live errors, `download_history` error rows,
   tail of `crash.log`.
4. **Export** — JSON/Markdown through `save_text_file`.

The Diagnostics tab renders a status-tile grid (like `CompatibilityTab`'s
maintenance panel), a per-download health table, disk bars, an error-log table,
and export/reset controls.

## Data flow

```
DownloadContext  ──invoke──▶  scheduler_get_config / scheduler_set_config
                 ──invoke──▶  download_set_schedule
                 ──invoke──▶  download_diagnostics
scheduler loop   ──▶ manager::start_download (gated by begin_download)
                 ──▶ torrent_set_speed_limits (rule transition)
```

## Error handling

- All new commands return `Result<_, String>`; the frontend surfaces failures
  through `showToast`, matching existing download handlers.
- The scheduler loop is fire-and-forget and never panics the engine: each tick
  is a no-op on error, matching the existing 1 s loop.
- Diagnostics aggregation is read-only and best-effort; a failing sub-section
  degrades to an empty list rather than failing the whole snapshot.

## Testing

- Rust: unit tests for window/day matching and the concurrency gate (happy +
  error path).
- Frontend: vitest for diagnostics aggregation/formatting.
- Gates: `npx tsc --noEmit`, `cargo check`, `npm run lint`, `npm test`,
  `npm run audit:i18n`.

## Delivery phases

| Phase | Deliverable |
|---|---|
| A | Tabbed page shell + History tab (no backend change). |
| B | Scheduling subsystem (full stack). |
| C | Diagnostics subsystem (full stack). |
