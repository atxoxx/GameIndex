# Session telemetry (launch workstream)

Collects the per-sample series persisted on `sessions.metrics_json` and the
aggregates stored on the row. Entry point: `readTelemetry()` in `./index.ts`;
the sampler in `../launch/metrics.ts` calls it once per sample and never awaits.

## Fields (frontend contract: `PerfSample` / `SessionMetrics` in `src/types/game.ts`)

Sample (`MetricSample`, one per ~3 s):

| field | meaning | when unknown |
|---|---|---|
| `t` | **elapsed seconds** since the session sampler started | always present |
| `cpu` | whole-machine CPU % (`os.cpus()` deltas) | always present |
| `ram` | whole-machine RAM % (`os.freemem()`) | always present |
| `gpu` | aggregate GPU % (Windows counter) | `0` (no reading; not counted in the average) |
| `cpuTemp` / `gpuTemp` | °C from MSI Afterburner (MAHM) or LibreHardwareMonitor; GPU also falls back to nvidia-smi | `0` (the persisted "no sensor" sentinel, as in Rust) |
| `gpuClockMhz` | GPU core clock (MHz) from MAHM/LHM/nvidia-smi | omitted |
| `fps` | instantaneous FPS from Afterburner's MAHM `Framerate` sensor or RTSS | `null` (never fabricated `0`) |
| `memMb` | game process working set (MB) | omitted |

Snapshot (`SessionMetricsSnapshot`, final `metrics_json` + row columns):
`avgFps`, `minFps`, `maxFps`, `avgCpuUsage`, `avgGpuUsage`, `avgRamUsage`,
`avgCpuTemp`, `avgGpuTemp`, `resolution` (`"unknown"`, no source), `samples`,
plus `avgProcessRamMb`, `avgGpuClockMhz`, `gpuAdapters` when known.
No FPS source ⇒ all three FPS fields are `0` (the UI renders "—"), matching the
Rust `aggregate_metrics` policy.

## Sources

### GPU % — `./gpu.ts`
`typeperf "\GPU Engine(*)\Utilization Percentage" -sc 1`, one short-lived child
every ~3.5 s while a session runs, 12 s timeout, output cached. The counter path
is discovered once (`typeperf -qx "GPU Engine"`, then the full `-qx` listing for
localised installs) and cached. Aggregation: per adapter (`luid_<low>_phys_N`),
values are **summed per engine class** (`3D`, `Copy`, `VideoDecode`, …) and the
busiest class wins; the reported percentage is the busiest adapter. Summing
every engine would double-count copy/3D work and exceed 100 %.

Adapter names come from one `Get-CimInstance Win32_VideoController` query,
cached for the process. Windows exposes no cheap LUID→name mapping, so the list
is stored as labels (`gpuAdapters`) rather than claiming which adapter is first.

A cached reading older than 15 s is treated as missing (`gpu: 0`).

### FPS — `./rtss.ts`
RTSS exposes `RTSSSharedMemoryV2`. Node cannot map it, so a persistent helper
(`powershell.exe -EncodedCommand`, C# `MemoryMappedFile`) prints one batch per
second:

```
A|<pid>|<exe path>|<min>/<avg>/<max>     (empty triplet = stats not ready)
T|<unix ms>|<app count>                  (ends the batch; 0 clears FPS)
```

Header layout used: signature `0x52545353` (`'RTSS'`; the byte-swapped
`0x53535452` is also accepted), `appArrOffset` at `0x08`, `appArrSize` (bytes)
at `0x0C`, `appEntrySize` at `0x10`; entry `pid` at `0`, `szName[260]` at `4`,
FPS triplets at `0x1BC/0x1C0/0x1C4` (`0x1C0`/`0x1E0` variants tried, u32/100,
`0 < v ≤ 500`, `min ≤ avg ≤ max`).

Lifecycle: started lazily only when `tasklist` shows `RTSS.exe`; restarted after
a silent/dead helper (15 s backoff); killed on quit (`stopTelemetry`) and when
the last session ends. FPS is matched by PID first, then by exe base name. When
RTSS is absent or has no entry for the game, FPS is `null`.

`buildRtssHelperScript(sectionName)` accepts a test section name; the harness
uses it to verify the real C# reader against a synthetic mapping.

### Temperatures / clock — `./mahm.ts`, `./lhm.ts`, `./nvidia.ts`
Priority: **MAHM → LHM → nvidia-smi**.

- `mahm.ts` reads MSI Afterburner's `MAHMSharedMemory` through a persistent
  PowerShell/C# probe (the same source the Tauri build used). It is the only
  source of **CPU temperature** when LHM is not running, and also carries GPU
  temp/usage, clocks, power, VRAM and Afterburner's `Framerate` sensor. Only
  started when `MSIAfterburner.exe` is running.
- `lhm.ts` reads `http://localhost:8085/data.json` (LibreHardwareMonitor /
  OpenHardwareMonitor), 800 ms timeout, refreshed every 2 s, retried every 30 s
  when closed. Maps GPU core/hot-spot temperature, GPU core clock and the CPU
  package/Tctl temperature.
- `nvidia.ts` runs `nvidia-smi --query-gpu=...` every 2 s as a GPU-only fallback
  (temperature, core clock, utilisation, VRAM). Needs no extra software, but
  never provides CPU temperature.

Without any of them, temperatures stay `null` and the UI shows "—": Windows has
no user-mode CPU temperature API (`MSAcpi_ThermalZoneTemperature` is unsupported
on most desktop boards and the thermal performance counters are absent).

## Persistence cadence

- Sample cadence `SAMPLE_INTERVAL_MS = 2500` (watcher polls every 3 s while a
  session runs, so a sample lands on almost every poll).
- Every sample batch is appended to the running row immediately
  (`appendSample` → `metrics_json.samples`), so `get_session_samples` has a
  dense curve and a crash loses at most one interval. After 900 appended
  samples only every 10th live sample is appended (bounds row growth); the
  final snapshot always replaces the blob with the complete bucket-averaged
  series (≤ 1200 points).
- On exit the row is finalized with `avgFps/avgCpu/avgGpu/avgRam` columns and
  the full snapshot in `metrics_json`.

## Watcher reliability (session creation)

`installLaunchLifecycle()` now starts the poll loop at boot (`ensureWatcherStarted`)
instead of waiting for the renderer's index push, and
`ensureWatcherStarted()` schedules a poll when a persisted index exists.
An empty index no longer stops the loop: it retries every 60 s. Every poll
always schedules the next one, even after an exception. When the cheap name
index finds nothing, a path-based sweep (`Get-CimInstance Win32_Process`, at
most once a minute, only with no live session) matches a running binary inside
a known install dir — except Windows' own tree, which is never a game.

## Not covered here

`electron/main/surfaces/overlayMetrics.ts` (and `surfaces/overlay.ts`) still
sample only CPU/RAM for the in-game HUD. That folder is outside this
workstream's write scope; wiring the overlay to `readTelemetry()` is the
remaining step (GPU %, temps, FPS keys are already produced here).
