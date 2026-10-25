# In-Game Overlay & Capture - Feature Guide

GameIndex ships an always-on-top HUD that floats over your running game, plus a native capture
toolkit for screenshots and video. The overlay is a **separate, lightweight window**: it renders only
the widgets you enable and never interrupts the game, so you can watch FPS, temperature and session
stats, take a clip, or look something up in the embedded Guides browser without alt-tabbing.

The overlay is **off by default** - turn it on in **Settings → Overlay** when you want it.

For the implementation map (Rust modules, commands, events), see the "In-game overlay & capture"
section of [`knowledge.md`](../knowledge.md). For Linux/Steam Deck specifics, see the
[Linux, Wine & Proton guide](linux-wine-proton.md).

---

## Table of contents

1. [At a glance](#at-a-glance)
2. [Enabling the overlay](#enabling-the-overlay)
3. [The ticker (collapsed HUD)](#the-ticker-collapsed-hud)
4. [The panel](#the-panel)
5. [Performance & telemetry](#performance--telemetry)
6. [Capture: screenshots](#capture-screenshots)
7. [Capture: video & replay](#capture-video--replay)
8. [Where captures are saved](#where-captures-are-saved)
9. [Appearance & accessibility](#appearance--accessibility)
10. [Games started outside GameIndex](#games-started-outside-gameindex)
11. [Platform support](#platform-support)
12. [Settings reference](#settings-reference)
13. [Troubleshooting](#troubleshooting)
14. [Related](#related)

---

## At a glance

| Capability | What it does |
|---|---|
| **Ticker** | A small collapsed HUD (condensed strip or gauge cluster) with live telemetry and capture chips. |
| **Panel** | An expandable panel with a labeled section rail, sub-tabs for captures/activity, and quick settings. |
| **Global hotkeys** | Toggle the HUD, take a screenshot, start/stop recording and save a replay from inside the game. |
| **Screenshots** | One-key captures with optional sound, flash and clipboard copy; recent-capture gallery. |
| **Video & replay** | Manual recording and a rolling instant-replay buffer, with game audio and optional microphone. |
| **Guides browser** | An embedded web preview inside the panel (PCGamingWiki, HowLongToBeat, YouTube, maps and more). |
| **Click-through** | Let clicks pass through the collapsed ticker while you play. |
| **Adaptive look** | Glass / solid / dim backgrounds, native acrylic on Windows, and adaptive theming from game art. |

---

## Enabling the overlay

1. Open **Settings → Overlay**.
2. Switch **Enable overlay** on.
3. Pick a **corner** and adjust **opacity** if the default bottom-right placement is not ideal.

Once enabled, press the **toggle hotkey** in-game to bring the HUD up. It cycles through three states:
**hidden → ticker → panel → hidden**.

### Default hotkeys

| Action | Default shortcut |
|---|---|
| Toggle the overlay (hidden / ticker / panel) | `Shift+F1` |
| Take a screenshot | `F12` |
| Start / stop recording | `Shift+F2` |
| Save a replay clip | `Shift+F3` |

Every hotkey is rebindable in **Settings → Overlay**. Global hotkeys are registered by the operating
system, so they work while the game is focused. If a toggle binding conflicts with another app,
GameIndex keeps the previous binding and tells you; capture bindings are best-effort.

> **Note:** when the overlay is disabled, no hotkeys are registered at all - not even the capture
> ones. Enable the overlay to use screenshots and recording.

---

## The ticker (collapsed HUD)

The ticker is the reduced, always-visible HUD. Its layout is chosen in **Settings → Overlay → Widgets**:

- **Strip** - one condensed row: live telemetry on the left, capture controls and
  activity badges on the right, and the expand button at the end. It wraps when the
  window gets narrow and the window grows to fit.
- **Gauges** - a ring cluster for FPS, CPU/GPU and RAM usage plus CPU/GPU temperatures,
  with a session clock and a compact control row.

Older `single` and `minimal` layouts collapse into **Strip**; they no longer exist
as separate presets.

You choose which chips appear (FPS, CPU, GPU, temperatures, RAM, sparkline, session timer, mic,
record, replay, screenshot). The FPS figure is colour-graded (`≥60` good, `≥30` fair, below that
low), and a sensor that reports nothing shows a dash rather than a fake number.

**Ticker click-through** (off by default) makes the collapsed ticker ignore the mouse so your clicks
reach the game. The expanded panel is always interactive, and the toggle hotkey is the way back in.

The bell badge is an **unread** count: it starts empty on first use, increments when a new achievement
or download completes, and clears once you open **Activity → Notifications**. The read marker is
persisted, so the badge does not come back for old events.

---

## The panel

The panel is the full HUD, opened from the ticker (or by pressing the toggle hotkey a second time).
A labeled rail on the left lists every enabled section; the header shows the game, the live session
clock, FPS and the capture controls. The panel reopens on the section you last used.

| Section | Contents |
|---|---|
| **Session** | Current game, session clock, lifetime playtime and session controls. |
| **Performance** | FPS, CPU/GPU/RAM KPIs and rolling area graphs, plus a frametime/gauge deep-dive. |
| **Captures** | Sub-tabs: **Screenshots** (gallery) and **Clips** (recording/replay controls). |
| **Guides** | The embedded Guides browser (always available, not toggleable). |
| **Notes** | Your GameIndex game notes, editable from the HUD. |
| **Timer** | A simple play/stop timer. |
| **Activity** | Sub-tabs: **Achievements**, **Downloads** and **Notifications**. |
| **Settings** | Curated quick settings; **Open full settings** jumps to Settings → Overlay. |

Sections disappear when every widget inside them is disabled in **Settings → Overlay → Widgets**;
Guides stays regardless. Multi-widget sections split into sub-tabs instead of one long scroll.

Press `Escape` to collapse the panel back to the ticker. The `?` button in the header opens a
**hotkey cheatsheet** with every bound shortcut, and `Esc` closes the sheet without collapsing the
panel. **Open full settings** hides the HUD, focuses the main window and lands on the Overlay
settings page; the HUD comes back on the toggle hotkey.

---

## Performance & telemetry

The performance tab reads from the same collectors as the Activity page, but samples live while the
overlay is open (default every **1000 ms**; raise or lower **Update frequency** in settings). The
deep-dive shows:

- **Frame stats** - average, 1% low, 0.1% low, minimum and maximum FPS (lows are computed from the
  worst 1% / 0.1% of samples). While the deep-dive is open the sampler boosts to a **100 ms** poll
  for a denser series, and drops back to the ordinary rate when it closes. When RTSS is the FPS
  source, the Min/Max chips additionally show RTSS's own frame-level bounds from its stat window.
- **Frametime** - the frametime graph, or `1000 / FPS` when a dedicated frametime sensor is unavailable.
- **Hardware sensors** - VRAM, GPU power, CPU power and GPU core/memory clocks where the platform reports them.
- **Session peaks** - peak CPU, GPU and RAM for the current session.

Telemetry sources depend on the platform: MSI Afterburner / RivaTuner shared memory and
LibreHardwareMonitor / OpenHardwareMonitor on Windows; MangoHud and GameScope on Linux. Missing
sensors are simply omitted - GameIndex never fabricates a reading.

---

## Capture: screenshots

Press the screenshot hotkey (`F12` by default) any time the overlay is active. Options in
**Settings → Overlay → Capture**:

- **Format** - PNG (default) or JPEG.
- **Save folder** - override the default capture location.
- **Sound** and **flash** on capture.
- **Copy to clipboard** after capture.
- **Include overlay** - keep the HUD in the shot, or hide it for a clean frame.
- **Delay** - a short pause before the shutter.

The **Captures → Screenshots** section lists recent screenshots newest-first, with view, copy-path, open-folder
and delete actions. Clicking a shot opens a full-window preview with a **Back to captures** button,
previous/next controls (arrow keys work too), a position counter and an actual-size zoom toggle;
`Esc` closes the preview without collapsing the panel.

---

## Capture: video & replay

The video recorder is platform-gated (see below) and lives in **Captures → Clips** and the ticker
capture controls.

- **Record** starts a manual recording; press the record hotkey again (or Stop) to finish and save a clip.
- **Countdown** - an optional pre-roll (default off) waits after pressing Record before the capture
  actually starts, giving you a ClapShot-style heads-up. The HUD shows a live countdown during it.
- **Replay** arms a rolling buffer (default **60 s**, configurable). Press the replay hotkey to save the
  last 60 seconds as a clip without having recorded up front.
- **Audio** - capture **game audio** (on by default) and optionally your **microphone**, choosing devices.
- **Quality** - frame rate (default 60), bitrate (default 12 000 kbps), resolution scale and format.

Recording and replay are mutually exclusive; a manual recording stops an armed replay. On game exit,
any active recording/replay is stopped automatically.

> **Note:** the **Enable video capture** toggle is enforced by the backend — with it off, the record /
> replay commands are refused and their global hotkeys are unbound (screenshots stay available).

---

## Where captures are saved

By default both screenshots and clips land in a per-game folder:

- **Windows:** your Videos folder's `Captures\<Game>` — read from the Explorer shell-folder
  settings, so a redirected location (OneDrive, or a moved Videos library) is honoured
- **Linux / macOS:** `$HOME/Videos/Captures/<Game>`

Names follow `Capture_<date>_<time>.(png|jpg)`, `Record_<date>.mp4` and `Replay_<date>.mp4`. Override
the location with **Screenshot folder** / **Video folder** in settings, or open the folder straight
from the Captures → Screenshots section.

The Community page's **Captures** tab is a separate gallery that scans your Steam, system and custom
screenshot folders and adds grouping, favourites, a lightbox and slideshow playback.

---

## Appearance & accessibility

- **Background style** - `glass`, `solid` or `dim`, with adjustable blur and opacity. On Windows the
  HUD can use native acrylic blur; other platforms use a CSS glass effect.
- **Panel density** - `comfortable` (default) or `compact`. Density changes spacing and chart height
  only; **Text size** stays a separate accessibility control.
- **Adaptive theming** - when your app theme is *Adaptive*, the HUD samples the running game's artwork
  into its accents.
- **Accessibility** - reduce effects (performance mode), high-contrast mode and text scaling.
- **Position** - pick a corner, or drag the HUD; a manually dragged position is remembered.

---

## Games started outside GameIndex

**Detect the current game** (on by default) lets the overlay appear for a library title you launched
directly from Steam, your desktop shortcut or an emulator. The detector matches the running process
(by executable, install folder or, for ROMs, the emulator command line) and adopts it as a
**view-only** session: it shows telemetry and lets you capture, but it does **not** record playtime or
start a tracked session.

---

## Platform support

| Platform | Overlay window | Hotkeys | Screenshots | Video |
|---|---|---|---|---|
| **Windows** | Non-activating tool window, native acrylic | Global shortcut plugin | GDI, foreground monitor | Windows Graphics Capture + Media Foundation (H.264/MP4) + WASAPI audio |
| **Linux - X11** | `_NET_WM_STATE_ABOVE`, real click-through | Global shortcut plugin | `x11rb` | `gpu-screen-recorder` (`-w screen`) |
| **Linux - Wayland** | `wlr-layer-shell` (no click-through) | XDG Desktop Portal | XDG Screenshot portal (prompts you) | `gpu-screen-recorder` (`-w portal`) |
| **macOS** | Builds, HUD inert | - | - | Not supported (stub) |

On Wayland, no input pass-through protocol exists, so a click-through ticker is not possible and the
screenshot portal may ask for confirmation. GNOME/mutter has no layer-shell support, and Wayland
without a portal leaves global hotkeys unavailable. On Linux, video requires the external
**`gpu-screen-recorder`** binary to be installed - GameIndex does not bundle it.

---

## Settings reference

| Setting | Default | Notes |
|---|---|---|
| Enable overlay | off | Master switch; nothing binds until it is on. |
| Toggle hotkey | `Shift+F1` | Cycles hidden → ticker → panel. |
| Screenshot hotkey | `F12` | Best-effort registration. |
| Record hotkey | `Shift+F2` | |
| Save replay hotkey | `Shift+F3` | |
| Corner | bottom-right | Or drag the HUD. |
| Opacity | 0.9 | |
| Ticker layout | strip | strip / gauges. Legacy `single`/`minimal` load as strip. |
| Panel density | comfortable | comfortable / compact (spacing + chart height). |
| Panel section | last used | Reopens on the section you last viewed. |
| Background | glass | glass / solid / dim. |
| Reduce effects | off | Performance mode. |
| High contrast | off | |
| Text scale | 1.0 | |
| Ticker click-through | off | Collapsed ticker only. |
| Idle dim / hide | off | Fades the collapsed ticker out after idle seconds; hide fully hides the window (the toggle hotkey brings it back). |
| Update frequency | 1000 ms | Live telemetry interval; the deep-dive temporarily boosts it to 100 ms. |
| Detect current game | on | Adopts externally-launched titles (view-only); any foreground fullscreen app counts as a generic session when no library title matches. |
| Screenshot format | PNG | PNG / JPEG. |
| Screenshot sound / flash / clipboard | on | |
| Video FPS / bitrate | 60 / 12 000 kbps | |
| Recording countdown | off | Optional pre-roll before a recording actually starts (max 10 s). |
| Replay buffer | 60 s | 5–600 s. |
| Game audio / microphone | on / off | |

---

## Troubleshooting

- **Hotkeys do nothing.** The overlay is probably disabled - hotkeys are only bound when it is on.
  On Wayland, global hotkeys need the XDG Desktop Portal; a session without one cannot deliver them.
- **Screenshot on Wayland shows a prompt.** The XDG Screenshot portal asks you to confirm; that is expected.
- **No FPS in the HUD.** Install/launch a sensor source - RTSS/MSI Afterburner (Windows) or MangoHud (Linux).
  Missing sensors render as a dash, never a wrong number.
- **Recording is unavailable.** On Linux, install `gpu-screen-recorder`; it is not bundled. On macOS,
  video capture is not supported.
- **The HUD is in the way.** Set it to click-through, move it to another corner, shrink it, or bind an
  easier toggle hotkey.
- **Clicks go through, but I cannot open the panel.** With click-through on, use the toggle hotkey -
  the collapsed ticker does not accept the mouse.

---

## Related

- [Linux, Wine & Proton guide](linux-wine-proton.md) - Wayland/X11 specifics, GameScope and MangoHud.
- [Mods Discover guide](mods-discover.md) - the multi-source mod browser.
- [`knowledge.md`](../knowledge.md) - the overlay/capture implementation map.
- Settings → **Overlay** and Settings → **Discord** in-app.
