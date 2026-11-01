#[cfg(windows)]
use windows::core::PCSTR;
#[cfg(windows)]
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingA, UnmapViewOfFile, FILE_MAP_READ,
};
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE, BOOL};
#[cfg(windows)]
use std::ffi::CString;
#[cfg(windows)]
use std::sync::Mutex;

#[cfg(windows)]
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct MAHMSharedMemoryHeader {
    pub signature: u32,
    pub version: u32,
    pub header_size: u32,
    pub entry_count: u32,
    pub entry_size: u32,
    pub time: i32,
    pub gpu_count: u32,
    pub gpu_entry_size: u32,
}

/// One adapter from Afterburner's GPU list. The field names follow the MAHM
/// SDK (`MAHM_SHARED_MEMORY_GPU`), not their position in the struct: Afterburner
/// stores the PCI identity first, then the die codename, then the marketing
/// name. Reading `device` where `family` lives (or `bios` where `memAmount`
/// lives) silently matches the wrong adapter / parses the BIOS string as a
/// VRAM amount, so the offsets below are load-bearing.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, Default)]
struct MahmGpuInfo {
    /// `szFamily`, the die codename, e.g. `GB203-A`.
    family: String,
    /// `szDevice`, the marketing name, e.g. `NVIDIA GeForce RTX 5070 Ti`.
    device: String,
    /// `szDriver`, the driver version, e.g. `616.56`.
    driver: String,
    /// VRAM in megabytes when Afterburner reports it (often left at 0).
    vram_mb: Option<f32>,
}

// Both structs are large (arrays of 260-byte strings) and their layout differs
// between MAHM versions, so every field is read by offset instead of casting to
// a `#[repr(C)]` mirror. Reference: the MAHM SDK header, `MAHM_SHARED_MEMORY_ENTRY`
// and `MAHM_SHARED_MEMORY_GPU`.
//
// Entry (modern layout):
//   offset 0: szSrcName[260]
//   offset 260: szSrcUnits[260]
//   offset 520: szLocSrcName[260]
//   offset 780: szLocSrcUnits[260]
//   offset 1040: szRecommendedFormat[260]
//   offset 1300: data (float, 4 bytes)
//   offset 1304: minLimit (float, 4 bytes)
//   offset 1308: maxLimit (float, 4 bytes)
//   offset 1312: flags (u32, 4 bytes)
//   offset 1316: dwGpu (u32, 4 bytes) — GPU index for this entry, `u32::MAX`
//                for CPU/system sensors (per-core entries carry the core index)
//   offset 1320: dwSrcId (u32, 4 bytes) — source ID
//
// GPU record:
//   offset 0: szGpuId[260]
//   offset 260: szFamily[260]
//   offset 520: szDevice[260]
//   offset 780: szDriver[260]
//   offset 1040: szBios[260]
//   offset 1300: dwMemAmount (u32, megabytes; 0 when not populated)

#[cfg(windows)]
const ENTRY_NAME_OFFSET: usize = 0;
#[cfg(windows)]
const ENTRY_NAME_SIZE: usize = 260;
#[cfg(windows)]
const ENTRY_UNITS_OFFSET: usize = 260;
#[cfg(windows)]
const ENTRY_UNITS_SIZE: usize = 260;
// Modern layout: data value at 5 × 260 = 1300
#[cfg(windows)]
const MODERN_DATA_OFFSET: usize = 1300;
// Legacy layout: data value at 544 (pre-v2.0 entries with 268-byte strings)
#[cfg(windows)]
const LEGACY_DATA_OFFSET: usize = 544;
#[cfg(windows)]
const LEGACY_ENTRY_SIZE_THRESHOLD: u32 = 640;

// GPU record field offsets (see the layout comment above).
#[cfg(windows)]
const GPU_FAMILY_OFFSET: usize = 260;
#[cfg(windows)]
const GPU_DEVICE_OFFSET: usize = 520;
#[cfg(windows)]
const GPU_DRIVER_OFFSET: usize = 780;
#[cfg(windows)]
const GPU_MEM_AMOUNT_OFFSET: usize = 1300;

#[cfg(windows)]
#[derive(Debug, Clone)]
pub struct MahmMetrics {
    pub cpu_usage: Option<f32>,
    pub cpu_temp: Option<f32>,
    pub gpu_usage: Option<f32>,
    pub gpu_temp: Option<f32>,
    pub ram_usage: Option<f32>,
    pub ram_units: String,   // e.g. "%", "MB", "GB"
    pub fps: Option<f32>,
    /// Instantaneous frame time in milliseconds, when Afterburner exposes it.
    pub frametime: Option<f32>,
    /// GPU dedicated memory in use, in megabytes.
    pub vram_used_mb: Option<f32>,
    /// Total GPU dedicated memory, in megabytes (parsed from the GPU list).
    pub vram_total_mb: Option<f32>,
    /// GPU board power draw in watts.
    pub gpu_power: Option<f32>,
    /// CPU package power draw in watts.
    pub cpu_power: Option<f32>,
    /// GPU core clock in MHz.
    pub gpu_core_clock: Option<f32>,
    /// GPU memory clock in MHz.
    pub gpu_mem_clock: Option<f32>,
}

#[cfg(windows)]
static CACHED_MAHM_HANDLE: Mutex<Option<isize>> = Mutex::new(None);

#[cfg(windows)]
unsafe fn try_open_mahm() -> Option<isize> {
    if let Ok(cache) = CACHED_MAHM_HANDLE.lock() {
        if let Some(handle) = *cache {
            return Some(handle);
        }
    }

    let name = CString::new("MAHMSharedMemory").ok()?;

    let h = OpenFileMappingA(
        FILE_MAP_READ.0,
        BOOL::from(false),
        PCSTR(name.as_ptr() as *const u8),
    );

    match h {
        Ok(handle) => {
            let raw = handle.0 as isize;
            let _ = handle;
            if let Ok(mut cache) = CACHED_MAHM_HANDLE.lock() {
                *cache = Some(raw);
            }
            Some(raw)
        }
        Err(_) => None,
    }
}

/// Drop the cached mapping handle so the next read re-opens the section.
/// Used when `MapViewOfFile` fails against a stale handle (Afterburner
/// restarted and recreated the shared-memory section); without this the
/// reader would keep returning `None` until the app restarts.
#[cfg(windows)]
fn clear_mahm_handle() {
    if let Ok(mut cache) = CACHED_MAHM_HANDLE.lock() {
        *cache = None;
    }
}

/// Extract a null-terminated ASCII string from raw memory at `ptr` with max `len` bytes.
#[cfg(windows)]
unsafe fn read_str_at(ptr: *const u8, len: usize) -> String {
    let slice = std::slice::from_raw_parts(ptr, len);
    let end = slice.iter().position(|&b| b == 0).unwrap_or(len);
    String::from_utf8_lossy(&slice[..end]).trim().to_string()
}

/// Null-terminated ASCII from a fixed-size MAHM byte field (the GPU records
/// are `[u8; 260]` arrays, unlike the pointer-based sensor entries).
#[cfg(windows)]
fn cstr_from_bytes(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

/// Whether a GameIndex GPU name (`filter`, e.g. "NVIDIA GeForce RTX 5070 Ti")
/// identifies the MAHM adapter described by its `device` (marketing name),
/// `family` (die codename, e.g. "GB203-A") or `driver` field. Afterburner
/// stores the marketing name in `device` on current builds and in `driver` on
/// older ones, so all three are checked. Bidirectional containment tolerates
/// the abbreviated variants Afterburner emits. Shared with tests.
#[cfg(any(windows, test))]
fn mahm_gpu_name_matches(filter: &str, gpu: &MahmGpuInfo) -> bool {
    let filter = filter.trim().to_lowercase();
    if filter.is_empty() {
        return false;
    }
    [&gpu.device, &gpu.family, &gpu.driver].iter().any(|raw| {
        let cleaned = raw.trim().to_lowercase();
        !cleaned.is_empty() && (cleaned.contains(&filter) || filter.contains(&cleaned))
    })
}

/// Resolve which Afterburner adapter to sample.
///
/// The caller's adapter index comes from Windows' adapter enumeration, which
/// does not match Afterburner's GPU list order: a desktop with an iGPU lists
/// the iGPU first in MAHM ("GPU1") and the gaming card second, while Windows
/// may list a virtual display adapter first. Using that index directly made
/// the overlay report the *iGPU's* power draw — on AMD the IGP power sensor
/// mirrors CPU package power, so the GPU tile ended up showing the CPU's
/// wattage.
///
/// Resolution order:
///   1. the adapter matching the explicit selection (Settings → Hardware);
///   2. otherwise the adapter Afterburner monitors most (the most per-GPU
///      sensors), which is the card its OSD is actually built around;
///   3. otherwise index 0.
#[cfg(any(windows, test))]
fn resolve_gpu_index(
    gpu_name: Option<&str>,
    gpus: &[MahmGpuInfo],
    per_gpu_sensor_counts: &[u32],
) -> u32 {
    if let Some(name) = gpu_name {
        if let Some(pos) = gpus.iter().position(|gpu| mahm_gpu_name_matches(name, gpu)) {
            return pos as u32;
        }
    }

    // `Reverse` on the index keeps the lowest one on a tie.
    per_gpu_sensor_counts
        .iter()
        .enumerate()
        .max_by_key(|(idx, count)| (**count, std::cmp::Reverse(*idx)))
        .filter(|(_, count)| **count > 0)
        .map(|(idx, _)| idx as u32)
        .unwrap_or(0)
}

/// Get the offset of the float `data` field within an entry,
/// based on the entry size reported by the header.
#[cfg(windows)]
fn get_data_offset(entry_size: u32) -> usize {
    if entry_size < LEGACY_ENTRY_SIZE_THRESHOLD {
        LEGACY_DATA_OFFSET
    } else {
        MODERN_DATA_OFFSET
    }
}

/// Determine whether an MAHM shared-memory entry represents the system RAM
/// sensor (as opposed to GPU memory, pagefile, swap, or commit charge).
///
/// Afterburner's shared memory exposes several memory-related entries
/// — both from its native sensors and from HWiNFO / third-party plugins
/// that Afterburner imports. The Playnite GameActivity reference
/// (Lacro59/playnite-gameactivity-plugin) uses a similar broad match to
/// pull the right entry across locales and imports.
///
// Excluded phrases: substring match (case-insensitive). An entry that
// contains any of these is *not* considered system RAM.
//
// NOTE: "shared memory" is intentionally broad. In MAHM context this almost
// always refers to GPU AWE (Address Windowing Extensions) shared memory,
// not OS-level shared memory. This matches the Playnite plugin's policy;
// if a future MAHM revision exposes genuine system shared memory under this
// exact name, narrow the exclusion to a more specific phrase (e.g.
// "shared gpu memory") rather than relaxing it globally.
#[cfg(any(windows, test))]
const NON_SYSTEM_RAM_HINTS: &[&str] = &[
    "vram",
    "video memory",
    "gpu memory",
    "dedicated memory",
    "shared memory",
    "virtual memory",
    "pagefile",
    "page file",
    "swap usage",
    "swap used",
    "committed memory",
    "commit charge",
];

/// Exact-name matches (case-insensitive) for system RAM entries.
#[cfg(any(windows, test))]
const SYSTEM_RAM_NAMES: &[&str] = &[
    "ram usage",
    "memory usage",
    "memory used",
    "used memory",
    "used ram",
    "physical memory used",
    "physical memory",
    "physical ram",
    "system memory",
    "system memory used",
    "system ram",
    "ram",
    "memory",
    "ram load",
    "memory load",
];

/// True iff `name` (an MAHM sensor display name) corresponds to system RAM.
#[cfg(any(windows, test))]
fn matches_system_ram(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    if name_lower.is_empty() {
        return false;
    }
    if NON_SYSTEM_RAM_HINTS.iter().any(|hint| name_lower.contains(hint)) {
        return false;
    }
    SYSTEM_RAM_NAMES.contains(&name_lower.as_str())
}

/// True iff `name` names a GPU dedicated-memory *usage* sensor (VRAM), as
/// opposed to system RAM, shared GPU memory or a capacity reading. Used to
/// surface the deep-dive VRAM tile without colliding with the system-RAM
/// matcher (which excludes every VRAM hint).
#[cfg(any(windows, test))]
fn matches_gpu_memory_used(name: &str) -> bool {
    let n = name.to_lowercase();
    if n.is_empty() {
        return false;
    }
    let dedicated = n.contains("vram")
        || n.contains("video memory")
        || n.contains("gpu memory")
        || n.contains("dedicated memory")
        // Afterburner labels per-GPU entries as "GPU1 memory …", so the index
        // sits between "gpu" and "memory"; accept any gpu-scoped memory name.
        || (n.contains("gpu") && n.contains("memory"));
    dedicated && (n.contains("usage") || n.contains("used") || n.contains("allocated"))
}

/// GPU board power draw (e.g. "GPU power", "GPU1 power"). Power-*limit*
/// entries ("GPU2 power limit") are percentages / raw flags with no unit, so
/// they must not be reported as a wattage.
#[cfg(any(windows, test))]
fn matches_gpu_power(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("gpu") && n.contains("power") && !n.contains("limit")
}

/// CPU package power draw (e.g. "CPU package power", "CPU power").
#[cfg(any(windows, test))]
fn matches_cpu_power(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("cpu") && n.contains("power") && !n.contains("gpu") && !n.contains("limit")
}

/// Whether a MAHM entry's unit field denotes watts. The value is meaningless
/// without it: HWiNFO imports and per-GPU limit sensors surface as "%", "MHz",
/// "V", "MB" or with no unit at all. Afterburner leaves the unit empty for some
/// flag sensors, so an empty unit is accepted (the value range and the "limit"
/// name guard weed those out).
#[cfg(any(windows, test))]
fn units_allow_watts(units: &str) -> bool {
    let units = units.trim();
    units.is_empty() || units.to_lowercase().starts_with('w')
}

/// GPU core clock (e.g. "GPU clock", "GPU1 core clock").
#[cfg(any(windows, test))]
fn matches_gpu_core_clock(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("gpu") && n.contains("clock") && !n.contains("mem")
}

/// GPU memory clock (e.g. "GPU memory clock", "GPU1 mem clock").
#[cfg(any(windows, test))]
fn matches_gpu_mem_clock(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("gpu") && n.contains("clock") && (n.contains("mem") || n.contains("memory"))
}

/// Whether an MAHM entry's owning GPU (`dwGpu`, or `None` for the legacy
/// layout that did not expose it) belongs to the resolved adapter. Per-GPU
/// sensors (power, clocks, VRAM) must be filtered this way, otherwise the
/// first GPU in the list — often the iGPU or a virtual adapter — wins and the
/// deep-dive shows that adapter's readings for every GPU. Package/system
/// sensors carry `u32::MAX` and never match; legacy entries can't be
/// attributed, so they pass through (the previous first-match behaviour).
#[cfg(any(windows, test))]
fn gpu_entry_on_adapter(entry_dw_gpu: Option<u32>, resolved_gpu_idx: u32) -> bool {
    match entry_dw_gpu {
        Some(g) => g == resolved_gpu_idx,
        None => true,
    }
}

/// Whether a CPU power entry is the package/aggregate reading rather than a
/// single core's. The aggregate is named "CPU power" / "CPU package power"
/// and carries the system sentinel `dwGpu` (`u32::MAX`); per-core entries are
/// "CPU1 power", "CPU2 power", … and must not shadow it.
#[cfg(any(windows, test))]
fn cpu_power_entry_is_package(name: &str, entry_dw_gpu: Option<u32>) -> bool {
    let n = name.trim().to_lowercase();
    n == "cpu power" || n.contains("package") || entry_dw_gpu == Some(u32::MAX)
}

/// Instantaneous frame time sensor ("Frametime" / "Frame time").
#[cfg(any(windows, test))]
fn matches_frametime(name: &str) -> bool {
    let n = name.to_lowercase();
    n == "frametime" || n == "frame time" || n.contains("frametime")
}

/// Parse Afterburner's GPU `mem_amount` field (e.g. "8192 MB", "12 GB",
/// "4096MB") into megabytes. Returns `None` for an unparseable value.
#[cfg(any(windows, test))]
fn parse_mem_amount_mb(raw: &str) -> Option<f32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Split into a leading number and trailing unit, tolerating the missing
    // space in values like "4096MB".
    let split = trimmed
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))
        .unwrap_or(trimmed.len());
    let (num_part, unit_part) = trimmed.split_at(split);
    let value: f32 = num_part.replace(',', "").parse().ok()?;
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    let unit = unit_part.trim().to_lowercase();
    let mb = if unit.starts_with('g') {
        value * 1024.0
    } else if unit.starts_with('k') {
        value / 1024.0
    } else if unit.starts_with('b') {
        value / (1024.0 * 1024.0)
    } else {
        // No/unknown unit => the field is already megabytes.
        value
    };
    Some(mb)
}

/// Parse Afterburner's GPU list into memory. Bounded against the mapped view
/// the same way the sensor entries are: a corrupted header must not walk off
/// the end of a shared-memory section.
#[cfg(windows)]
unsafe fn read_gpu_list(base: *const u8, header: &MAHMSharedMemoryHeader) -> Vec<MahmGpuInfo> {
    let mut gpus = Vec::new();
    // The name fields run through `szDriver`, so a record narrower than that is
    // not a GPU record we can read at all.
    if header.gpu_count == 0
        || (header.gpu_entry_size as usize) < GPU_DRIVER_OFFSET + ENTRY_NAME_SIZE
    {
        return gpus;
    }

    let gpus_offset =
        header.header_size as usize + header.entry_count as usize * header.entry_size as usize;
    for i in 0..header.gpu_count as usize {
        let rel = gpus_offset + i * header.gpu_entry_size as usize;
        if rel + header.gpu_entry_size as usize > 0x40000 {
            break;
        }
        let gpu = base.add(rel);

        // Newer builds append `dwMemAmount` (megabytes) as a DWORD; the earliest
        // v2.0 layout kept a 260-byte string there instead. Prefer the DWORD,
        // fall back to the string form when the record is wide enough for it.
        let vram_mb = if header.gpu_entry_size as usize
            >= GPU_MEM_AMOUNT_OFFSET + ENTRY_NAME_SIZE
        {
            parse_mem_amount_mb(&cstr_from_bytes(std::slice::from_raw_parts(
                gpu.add(GPU_MEM_AMOUNT_OFFSET),
                ENTRY_NAME_SIZE,
            )))
        } else if header.gpu_entry_size as usize >= GPU_MEM_AMOUNT_OFFSET + 4 {
            let mb = *(gpu.add(GPU_MEM_AMOUNT_OFFSET) as *const u32);
            if mb > 0 && mb < 1_048_576 {
                Some(mb as f32)
            } else {
                None
            }
        } else {
            None
        };

        gpus.push(MahmGpuInfo {
            family: cstr_from_bytes(std::slice::from_raw_parts(
                gpu.add(GPU_FAMILY_OFFSET),
                ENTRY_NAME_SIZE,
            )),
            device: cstr_from_bytes(std::slice::from_raw_parts(
                gpu.add(GPU_DEVICE_OFFSET),
                ENTRY_NAME_SIZE,
            )),
            driver: cstr_from_bytes(std::slice::from_raw_parts(
                gpu.add(GPU_DRIVER_OFFSET),
                ENTRY_NAME_SIZE,
            )),
            vram_mb,
        });
    }
    gpus
}

/// Count the per-GPU sensors Afterburner exposes for each adapter. Used to pick
/// a sane adapter when no GPU is selected in Settings: the card Afterburner
/// monitors in depth (temperature, usage, clocks, power) is the one its OSD
/// tracks, whereas the iGPU/virtual adapters only expose a couple of entries.
#[cfg(windows)]
unsafe fn count_gpu_sensors(
    base: *const u8,
    header: &MAHMSharedMemoryHeader,
    data_offset: usize,
    has_dw_gpu: bool,
    gpu_count: usize,
) -> Vec<u32> {
    let mut counts = vec![0u32; gpu_count];
    if !has_dw_gpu || gpu_count == 0 {
        return counts;
    }
    let entries_base = base.add(header.header_size as usize);
    for i in 0..header.entry_count as usize {
        // Same view bound as the main entry loop: a corrupt header must not
        // walk past the mapped section.
        let entry_offset = header.header_size as usize + i * header.entry_size as usize;
        if entry_offset + data_offset + 4 > 0x200000 {
            break;
        }
        let entry = entries_base.add(i * header.entry_size as usize);
        let name = read_str_at(entry.add(ENTRY_NAME_OFFSET), ENTRY_NAME_SIZE);
        if name.is_empty() || !name.to_lowercase().contains("gpu") {
            continue;
        }
        let dw_gpu = *(entry.add(data_offset + 16) as *const u32);
        // `u32::MAX` marks a system-wide entry; per-core CPU sensors carry the
        // core index instead, so restricting the match to "gpu" in the name is
        // what keeps them out of these counts.
        if dw_gpu != u32::MAX {
            if let Some(slot) = counts.get_mut(dw_gpu as usize) {
                *slot += 1;
            }
        }
    }
    counts
}

/// Parse MSI Afterburner Shared Memory metrics.
///
/// Uses **exact sensor name matching** following the reference Playnite GameActivity plugin:
/// - `"CPU usage"` / `"CPU temperature"` for CPU
/// - `"GPU usage"` / `"GPU temperature"` for GPU  
/// - `"RAM usage"` for RAM
/// - `"Framerate"` for FPS
///
/// These are the standard English names that MSI Afterburner uses in its shared memory.
/// The matching is case-insensitive.
///
/// `gpu_name` is the adapter selected in Settings → Hardware; it is resolved
/// against Afterburner's own GPU list. When it is `None` (automatic selection)
/// or does not match an Afterburner entry, the most-monitored adapter is used
/// instead of blindly taking index 0 — see [`resolve_gpu_index`].
#[cfg(windows)]
pub fn read_mahm_metrics(gpu_name: Option<&str>) -> Option<MahmMetrics> {
    unsafe {
        let handle_raw = try_open_mahm()?;
        let map_handle = HANDLE(handle_raw as *mut std::ffi::c_void);

        let view = MapViewOfFile(map_handle, FILE_MAP_READ, 0, 0, 0);

        let base = view.Value;
        if base.is_null() {
            let _ = UnmapViewOfFile(view);
            // The cached handle is stale (Afterburner restarted). Clear it so
            // the next poll re-opens the section instead of failing forever.
            clear_mahm_handle();
            return None;
        }

        let header = *(base as *const MAHMSharedMemoryHeader);

        // Check signature: MAHM = 0x4D41484D
        if header.signature != 0x4D41484D {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        // Sanity checks. `entry_size` / `header_size` / `gpu_count` must be
        // bounded — a corrupted header with a huge entry size would otherwise
        // make the entry loop below read far past the mapped view and crash.
        if header.entry_count > 1000
            || header.entry_size < 32
            || header.entry_size > 0x2000
            || header.header_size > 0x1000
            || header.gpu_count > 64
        {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        let data_offset = get_data_offset(header.entry_size);

        // The modern entry layout carries the owning GPU index (`dwGpu`) right
        // after the min/max/flags fields; the legacy layout has no such field.
        let has_dw_gpu = header.entry_size >= LEGACY_ENTRY_SIZE_THRESHOLD;

        let gpus = read_gpu_list(base as *const u8, &header);
        let sensor_counts = count_gpu_sensors(
            base as *const u8,
            &header,
            data_offset,
            has_dw_gpu,
            gpus.len(),
        );
        let resolved_gpu_idx = resolve_gpu_index(gpu_name, &gpus, &sensor_counts);
        let vram_total_mb = gpus
            .get(resolved_gpu_idx as usize)
            .and_then(|gpu| gpu.vram_mb);

        let target_gpu_num = resolved_gpu_idx + 1;
        let expected_gpu_usage_1 = format!("gpu{} usage", target_gpu_num);
        let expected_gpu_usage_2 = format!("gpu{} load", target_gpu_num);
        let expected_gpu_temp_1 = format!("gpu{} temperature", target_gpu_num);
        let expected_gpu_temp_2 = format!("gpu{} temp", target_gpu_num);

        let mut cpu_usage: Option<f32> = None;
        let mut cpu_temp: Option<f32> = None;
        let mut gpu_usage: Option<f32> = None;
        let mut gpu_temp: Option<f32> = None;
        let mut ram_usage: Option<f32> = None;
        let mut ram_units = String::new();
        let mut fps: Option<f32> = None;
        let mut frametime: Option<f32> = None;
        let mut vram_used_mb: Option<f32> = None;
        let mut gpu_power: Option<f32> = None;
        let mut cpu_power: Option<f32> = None;
        let mut cpu_power_is_package = false;
        let mut gpu_core_clock: Option<f32> = None;
        let mut gpu_mem_clock: Option<f32> = None;

        let entries_base = (base as *const u8).add(header.header_size as usize);

        for i in 0..header.entry_count {
            // Bound each entry against a generous fixed cap so a corrupt
            // entry_count / entry_size combination can't read past the view.
            let entry_offset = header.header_size as usize + (i * header.entry_size) as usize;
            if entry_offset + data_offset + 4 > 0x200000 {
                break;
            }
            let entry = entries_base.add((i * header.entry_size) as usize);
            let name = read_str_at(entry.add(ENTRY_NAME_OFFSET), ENTRY_NAME_SIZE);
            if name.is_empty() {
                continue;
            }
            
            let data = *(entry.add(data_offset) as *const f32);
            let name_lower = name.to_lowercase();
            let entry_dw_gpu = if has_dw_gpu {
                Some(*(entry.add(data_offset + 16) as *const u32))
            } else {
                None
            };
            let on_selected_gpu = gpu_entry_on_adapter(entry_dw_gpu, resolved_gpu_idx);

            let expected_gpu_usage_1_space = format!("gpu {} usage", target_gpu_num);
            let expected_gpu_usage_2_space = format!("gpu {} load", target_gpu_num);
            let expected_gpu_temp_1_space = format!("gpu {} temperature", target_gpu_num);
            let expected_gpu_temp_2_space = format!("gpu {} temp", target_gpu_num);

            let is_match_gpu_usage = name_lower == expected_gpu_usage_1
                || name_lower == expected_gpu_usage_1_space
                || name_lower == expected_gpu_usage_2
                || name_lower == expected_gpu_usage_2_space
                || (resolved_gpu_idx == 0 && (name_lower == "gpu usage" || name_lower == "gpu load" || name_lower == "gpu"));

            let is_match_gpu_temp = name_lower == expected_gpu_temp_1
                || name_lower == expected_gpu_temp_1_space
                || name_lower == expected_gpu_temp_2
                || name_lower == expected_gpu_temp_2_space
                || (resolved_gpu_idx == 0 && (name_lower == "gpu temperature" || name_lower == "gpu temp"));

            let is_ram = matches_system_ram(&name);

            // Match using exact standard sensor names from MSI Afterburner,
            // same as the Playnite GameActivity reference plugin.
            if name_lower == "cpu usage" || name_lower == "cpu load" {
                cpu_usage = Some(data);
            } else if name_lower == "cpu temperature" || name_lower == "cpu temp" || name_lower == "cpu1 temperature" {
                cpu_temp = Some(data);
            } else if is_match_gpu_usage {
                if gpu_usage.is_none() {
                    gpu_usage = Some(data);
                }
            } else if is_match_gpu_temp {
                if gpu_temp.is_none() {
                    gpu_temp = Some(data);
                }
            } else if is_ram {
                // First matching entry wins: native Afterburner entries
                // tend to be iterated before HWiNFO imports, so they take
                // precedence over the noisier imported reading. Both produce
                // valid percentages — reordering in future MAHM versions
                // won't degrade correctness, only which source we pick.
                if ram_usage.is_none() {
                    ram_usage = Some(data);
                    let units = read_str_at(entry.add(ENTRY_UNITS_OFFSET), ENTRY_UNITS_SIZE);
                    ram_units = units;
                }
            } else if frametime.is_none() && matches_frametime(&name) {
                if data.is_finite() && data > 0.0 && data <= 1000.0 {
                    frametime = Some(data);
                }
            } else if vram_used_mb.is_none() && on_selected_gpu && matches_gpu_memory_used(&name) {
                if data.is_finite() && data > 0.0 && data <= 1_048_576.0 {
                    vram_used_mb = Some(data);
                }
            } else if gpu_power.is_none() && on_selected_gpu && matches_gpu_power(&name) {
                // Watts only: a "power limit" percentage or an HWiNFO import in
                // another unit must never be rendered as a wattage.
                let units = read_str_at(entry.add(ENTRY_UNITS_OFFSET), ENTRY_UNITS_SIZE);
                if units_allow_watts(&units) && data.is_finite() && data > 0.0 && data <= 2000.0 {
                    gpu_power = Some(data);
                }
            } else if matches_cpu_power(&name) {
                // Prefer the package/aggregate reading over a single core's.
                let units = read_str_at(entry.add(ENTRY_UNITS_OFFSET), ENTRY_UNITS_SIZE);
                if units_allow_watts(&units) && data.is_finite() && data > 0.0 && data <= 2000.0 {
                    let is_package = cpu_power_entry_is_package(&name, entry_dw_gpu);
                    if cpu_power.is_none() || (is_package && !cpu_power_is_package) {
                        cpu_power = Some(data);
                        cpu_power_is_package = is_package;
                    }
                }
            } else if gpu_core_clock.is_none() && on_selected_gpu && matches_gpu_core_clock(&name) {
                if data.is_finite() && data > 0.0 && data <= 20_000.0 {
                    gpu_core_clock = Some(data);
                }
            } else if gpu_mem_clock.is_none() && on_selected_gpu && matches_gpu_mem_clock(&name) {
                if data.is_finite() && data > 0.0 && data <= 20_000.0 {
                    gpu_mem_clock = Some(data);
                }
            } else if name_lower == "framerate" || name_lower == "fps" {
                // Bound the Framerate sensor reading. MAHM stores data as
                // a raw f32 from the entry's `data` field; if the entry is
                // uninitialised / corrupted (common on app start, or when
                // a sensor plugin is disabled mid-run) MAHM's `data`
                // field is whatever was last in shared memory — frequently
                // something like 0xCCCCCCCC or `u32::MAX` reinterpreted as
                // f32, which then becomes f64::max when re-cast. Without a
                // bound here, that single bad sample makes
                // `aggregate_metrics` produce max_fps ≈ 4e9 (u32::MAX), and
                // the GameActivity FPS chart — which auto-scales the Y
                // axis to its data range — renders gridlines at
                // 858993459 / 1717986918 / 2576980777 / 3435973836 /
                // 4294967262 (the 0x33 / 0x66 / 0x99 / 0xCC / 0xFF pattern
                // generated by evenly dividing u32::MAX into 5 segments).
                //
                // The cap matches RTSS: we don't surface rates above 500
                // FPS anywhere, so anything > 500 is by definition garbage
                // from the wrong field / wrong memory.
                if data.is_finite() && data > 0.0 && data <= 500.0 {
                    fps = Some(data);
                }
            }
        }

        let _ = UnmapViewOfFile(view);

        Some(MahmMetrics {
            cpu_usage,
            cpu_temp,
            gpu_usage,
            gpu_temp,
            ram_usage,
            ram_units,
            fps,
            frametime,
            vram_used_mb,
            vram_total_mb,
            gpu_power,
            cpu_power,
            gpu_core_clock,
            gpu_mem_clock,
        })
    }
}

/// Release cached handle
#[allow(dead_code)]
#[cfg(windows)]
pub fn release_mahm() {
    if let Ok(mut cache) = CACHED_MAHM_HANDLE.lock() {
        if let Some(handle) = cache.take() {
            unsafe {
                let _ = CloseHandle(HANDLE(handle as *mut std::ffi::c_void));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ram_matcher_matches_afterburner_native_names() {
        assert!(matches_system_ram("RAM usage"));
        assert!(matches_system_ram("Memory usage"));
        assert!(matches_system_ram("Memory"));
        assert!(matches_system_ram("Ram load"));
    }

    #[test]
    fn ram_matcher_matches_hwinfo_imports() {
        // HWiNFO-imported sensors that afterburner surfaces with localized
        // names — these were the root cause of "RAM still not detected".
        assert!(matches_system_ram("Physical Memory Used"));
        assert!(matches_system_ram("Used memory"));
        assert!(matches_system_ram("Memory used"));
        assert!(matches_system_ram("System memory"));
        assert!(matches_system_ram("System memory used"));
        assert!(matches_system_ram("System ram"));
        assert!(matches_system_ram("Physical memory"));
        assert!(matches_system_ram("Physical ram"));
    }

    #[test]
    fn ram_matcher_excludes_vram_and_gpu_memory() {
        assert!(!matches_system_ram("GPU memory usage"));
        assert!(!matches_system_ram("Dedicated memory used"));
        assert!(!matches_system_ram("VRAM usage"));
        assert!(!matches_system_ram("Video memory"));
        assert!(!matches_system_ram("Shared memory"));
    }

    #[test]
    fn ram_matcher_excludes_pagefile_swap_and_commit() {
        assert!(!matches_system_ram("Pagefile usage"));
        assert!(!matches_system_ram("Page file usage"));
        assert!(!matches_system_ram("Virtual memory used"));
        assert!(!matches_system_ram("Commit charge"));
        assert!(!matches_system_ram("Committed memory"));
        assert!(!matches_system_ram("Swap usage"));
    }

    #[test]
    fn ram_matcher_is_case_insensitive() {
        assert!(matches_system_ram("ram USAGE"));
        assert!(matches_system_ram("MEMORY usage"));
        assert!(matches_system_ram("PhYsIcAl mEmOrY UsEd"));
    }

    #[test]
    fn ram_matcher_empty_or_unrelated_names_return_false() {
        assert!(!matches_system_ram(""));
        assert!(!matches_system_ram("CPU usage"));
        assert!(!matches_system_ram("Framerate"));
        assert!(!matches_system_ram("GPU temperature"));
    }

    #[test]
    fn ram_matcher_substring_exclusion_takes_precedence() {
        // Locks in the exclusion-first contract so a future refactor that
        // flips the order (checks SYSTEM_RAM_NAMES before NON_SYSTEM_RAM_HINTS)
        // is caught by CI rather than silently re-accepting VRAM / pagefile.
        assert!(!matches_system_ram("System dedicated memory used"));
        assert!(!matches_system_ram("Physical GPU memory"));
        assert!(!matches_system_ram("Virtual memory usage"));
        assert!(!matches_system_ram("RAM pagefile usage"));
        assert!(!matches_system_ram("Committed memory"));
    }

    #[test]
    fn gpu_memory_used_matches_vram_sensors_but_not_system_ram() {
        assert!(matches_gpu_memory_used("VRAM usage"));
        assert!(matches_gpu_memory_used("GPU memory usage"));
        assert!(matches_gpu_memory_used("Dedicated memory used"));
        assert!(matches_gpu_memory_used("GPU1 memory allocated"));
        // Capacity readings and system RAM must not be treated as GPU usage.
        assert!(!matches_gpu_memory_used("RAM usage"));
        assert!(!matches_gpu_memory_used("Memory usage"));
        assert!(!matches_gpu_memory_used("VRAM"));
        assert!(!matches_gpu_memory_used(""));
    }

    #[test]
    fn power_and_clock_matchers_disambiguate_cpu_gpu_and_core_mem() {
        assert!(matches_gpu_power("GPU power"));
        assert!(matches_gpu_power("GPU1 power"));
        assert!(!matches_gpu_power("CPU package power"));

        assert!(matches_cpu_power("CPU package power"));
        assert!(matches_cpu_power("CPU power"));
        assert!(!matches_cpu_power("GPU power"));

        assert!(matches_gpu_core_clock("GPU clock"));
        assert!(matches_gpu_core_clock("GPU1 core clock"));
        assert!(!matches_gpu_core_clock("GPU memory clock"));

        assert!(matches_gpu_mem_clock("GPU memory clock"));
        assert!(matches_gpu_mem_clock("GPU1 mem clock"));
        assert!(!matches_gpu_mem_clock("GPU core clock"));
    }

    #[test]
    fn frametime_matcher_accepts_afterburner_names() {
        assert!(matches_frametime("Frametime"));
        assert!(matches_frametime("frame time"));
        assert!(matches_frametime("FrameTime"));
        assert!(!matches_frametime("framerate"));
        assert!(!matches_frametime("fps"));
    }

    #[test]
    fn mem_amount_parses_common_afterburner_units() {
        assert_eq!(parse_mem_amount_mb("8192 MB"), Some(8192.0));
        assert_eq!(parse_mem_amount_mb("12 GB"), Some(12.0 * 1024.0));
        assert_eq!(parse_mem_amount_mb("4096MB"), Some(4096.0));
        assert_eq!(parse_mem_amount_mb(""), None);
        assert_eq!(parse_mem_amount_mb("garbage"), None);
        assert_eq!(parse_mem_amount_mb("0 MB"), None);
    }

    /// A MAHM adapter record as the reader builds it.
    fn gpu(family: &str, device: &str, driver: &str) -> MahmGpuInfo {
        MahmGpuInfo {
            family: family.to_string(),
            device: device.to_string(),
            driver: driver.to_string(),
            vram_mb: None,
        }
    }

    #[test]
    fn gpu_name_matches_marketing_name_in_device_field() {
        assert!(mahm_gpu_name_matches(
            "NVIDIA GeForce RTX 5070 Ti",
            &gpu("GB203-A", "NVIDIA GeForce RTX 5070 Ti", "616.56"),
        ));
    }

    #[test]
    fn gpu_name_matches_marketing_name_in_driver_field() {
        // Older builds keep the marketing name in `driver`.
        assert!(mahm_gpu_name_matches(
            "NVIDIA GeForce RTX 3080",
            &gpu("GA102", "", "NVIDIA GeForce RTX 3080"),
        ));
    }

    #[test]
    fn gpu_name_matches_die_codename() {
        assert!(mahm_gpu_name_matches("GB203-A", &gpu("GB203-A", "", "")));
    }

    #[test]
    fn gpu_name_matches_is_case_insensitive_and_empty_safe() {
        assert!(mahm_gpu_name_matches(
            "amd radeon(tm) graphics",
            &gpu("", "AMD Radeon(TM) Graphics", ""),
        ));
        assert!(!mahm_gpu_name_matches("", &gpu("GB203-A", "NVIDIA", "")));
        assert!(!mahm_gpu_name_matches(
            "NVIDIA GeForce RTX 5070 Ti",
            &gpu("", "", ""),
        ));
    }

    #[test]
    fn gpu_name_does_not_match_an_unrelated_adapter() {
        // The 5070 Ti must never resolve to the TU106 (RTX 2070) entry.
        assert!(!mahm_gpu_name_matches(
            "NVIDIA GeForce RTX 5070 Ti",
            &gpu("TU106-A", "NVIDIA GeForce RTX 2070", "616.56"),
        ));
        assert!(!mahm_gpu_name_matches(
            "NVIDIA GeForce RTX 5070 Ti",
            &gpu("GB203-A", "", "616.56"),
        ));
    }

    #[test]
    fn explicit_selection_wins_over_sensor_counts() {
        let gpus = vec![
            gpu("", "AMD Radeon(TM) Graphics", ""),
            gpu("GB203-A", "NVIDIA GeForce RTX 5070 Ti", "616.56"),
            gpu("TU106-A", "NVIDIA GeForce RTX 2070", "616.56"),
        ];
        let counts = [5, 18, 15];
        assert_eq!(
            resolve_gpu_index(Some("NVIDIA GeForce RTX 5070 Ti"), &gpus, &counts),
            1
        );
        assert_eq!(
            resolve_gpu_index(Some("NVIDIA GeForce RTX 2070"), &gpus, &counts),
            2
        );
    }

    #[test]
    fn unresolved_or_missing_selection_picks_the_monitored_adapter() {
        // The real desktop this was written against: Afterburner lists the iGPU
        // first, so a hardcoded index 0 reported the iGPU's power draw (which
        // mirrors CPU package power) instead of the gaming card's.
        let gpus = vec![
            gpu("", "AMD Radeon(TM) Graphics", "AMD Software"),
            gpu("GB203-A", "NVIDIA GeForce RTX 5070 Ti", "616.56"),
            gpu("TU106-A", "NVIDIA GeForce RTX 2070", "616.56"),
        ];
        let counts = [5, 18, 15];
        assert_eq!(resolve_gpu_index(None, &gpus, &counts), 1);
        // A selection Afterburner does not list (e.g. a virtual display
        // adapter) must not fall back to index 0 either.
        assert_eq!(
            resolve_gpu_index(Some("Parsec Virtual Display Adapter"), &gpus, &counts),
            1
        );
    }

    #[test]
    fn auto_resolution_handles_absent_and_tied_sensor_data() {
        let gpus = vec![gpu("", "GPU A", ""), gpu("", "GPU B", "")];
        // No sensors at all: keep the first adapter rather than panicking.
        assert_eq!(resolve_gpu_index(None, &gpus, &[]), 0);
        assert_eq!(resolve_gpu_index(None, &gpus, &[0, 0]), 0);
        // Ties prefer the lowest index.
        assert_eq!(resolve_gpu_index(None, &gpus, &[4, 4]), 0);
        assert_eq!(resolve_gpu_index(None, &gpus, &[0, 1]), 1);
    }

    #[test]
    fn power_sensors_reject_limit_and_non_watt_units() {
        // "GPU2 power limit" is a percentage / raw flag, not a wattage.
        assert!(matches_gpu_power("GPU2 power"));
        assert!(!matches_gpu_power("GPU2 power limit"));
        assert!(!matches_gpu_power("Power limit"));

        assert!(matches_cpu_power("CPU Package Power"));
        assert!(!matches_cpu_power("CPU power limit"));
        assert!(!matches_cpu_power("GPU power"));

        assert!(units_allow_watts(""));
        assert!(units_allow_watts("W"));
        assert!(units_allow_watts(" w "));
        assert!(units_allow_watts("Watts"));
        assert!(!units_allow_watts("%"));
        assert!(!units_allow_watts("MHz"));
        assert!(!units_allow_watts("°C"));
        assert!(!units_allow_watts("V"));
        assert!(!units_allow_watts("MB"));
    }

    #[test]
    fn gpu_entry_on_adapter_matches_only_the_resolved_index() {
        assert!(gpu_entry_on_adapter(Some(1), 1));
        assert!(!gpu_entry_on_adapter(Some(0), 1));
        // The package/system sentinel never matches a real adapter.
        assert!(!gpu_entry_on_adapter(Some(u32::MAX), 1));
        // Legacy layout (no dwGpu) can't be attributed → passes through.
        assert!(gpu_entry_on_adapter(None, 1));
    }

    #[test]
    fn cpu_power_prefers_the_package_reading() {
        assert!(cpu_power_entry_is_package("CPU power", Some(u32::MAX)));
        assert!(cpu_power_entry_is_package("CPU Package Power", Some(u32::MAX)));
        assert!(cpu_power_entry_is_package("CPU power", None));
        assert!(!cpu_power_entry_is_package("CPU1 power", Some(0)));
        assert!(!cpu_power_entry_is_package("CPU2 power", Some(1)));
    }
}
