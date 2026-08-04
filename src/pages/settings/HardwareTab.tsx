import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useActivity } from "../../context/ActivityContext";
import { useSettings } from "../../context/SettingsContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui";
import type { SizeUnit } from "../../types/game";
import { CpuIcon, GaugeIcon, GpuIcon, HardwareIcon, MemoryIcon, RefreshIcon } from "./settingsIcons";

/**
 * HardwareTab — detected-hardware summary (CPU / RAM / GPU chips), the
 * telemetry capture toggles + sampling interval, and the display-unit
 * preferences (temperature + storage size).
 */
export default function HardwareTab() {
  const { availableGpus, selectedGpu, setSelectedGpu, refreshGpus } = useActivity();
  const {
    hardwareMonitoringEnabled,
    setHardwareMonitoringEnabled,
    metricCapture,
    setMetricCapture,
    samplingIntervalSec,
    setSamplingIntervalSec,
    tempUnit,
    setTempUnit,
  } = useSettings();
  const { unit: sizeUnit, setUnit: setSizeUnit } = useSizeUnit();
  const { t } = useLanguage();
  const { showToast } = useToast();

  // System summary (CPU / RAM / all GPUs). Fetched once on mount; the
  // Rust side reads real hardware via WMI.
  const [systemInfo, setSystemInfo] = useState<{
    cpuName: string;
    ramGb: number;
    gpus: { id: string; name: string; vendor: string; vramMb: number }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const info = await invoke<{
          cpuName: string;
          ramGb: number;
          gpus: { id: string; name: string; vendor: string; vramMb: number }[];
        }>("get_system_info");
        setSystemInfo(info);
      } catch (e) {
        console.warn("[SettingsPage] get_system_info failed:", e);
      }
    })();
  }, []);

  // The Rust telemetry config wants milliseconds.
  const samplingIntervalMs = Math.round(samplingIntervalSec * 1000);

  // Push telemetry config to the Rust watcher whenever the master
  // toggle, per-metric capture flags, or sampling interval change.
  useEffect(() => {
    (async () => {
      try {
        await invoke("set_metrics_config", {
          config: {
            enabled: hardwareMonitoringEnabled,
            intervalMs: samplingIntervalMs,
            captureFps: metricCapture.fps,
            captureCpu: metricCapture.cpu,
            captureGpu: metricCapture.gpu,
            captureRam: metricCapture.ram,
            captureCpuTemp: metricCapture.cpuTemp,
            captureGpuTemp: metricCapture.gpuTemp,
          },
        });
      } catch (e) {
        console.warn("[SettingsPage] set_metrics_config failed:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardwareMonitoringEnabled, metricCapture, samplingIntervalMs]);

  return (
    <section className="settings-section hw">
      {/* Header — title + master monitoring switch */}
      <header className="hw-head">
        <div className="hw-head-text">
          <span className="hw-head-icon" aria-hidden>
            <HardwareIcon />
          </span>
          <div className="hw-head-titles">
            <h2 className="hw-title">{t("settings.section.hardwareMonitoring")}</h2>
            <p className="hw-subtitle">{t("settings.hardware.sectionDesc")}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hardwareMonitoringEnabled}
          aria-label={t("settings.label.enableMonitoring")}
          className="hw-master"
          data-on={hardwareMonitoringEnabled}
          onClick={() => setHardwareMonitoringEnabled(!hardwareMonitoringEnabled)}
        >
          <span className="hw-master-state" data-on={hardwareMonitoringEnabled} aria-hidden>
            {hardwareMonitoringEnabled ? t("settingsPage.active") : t("settings.hardware.inactive")}
          </span>
          <span className="hw-switch" aria-hidden>
            <span className="hw-switch-knob" />
          </span>
        </button>
      </header>

      {/* ── Detected hardware ───────────────────────────────────── */}
      <div id="hw-detected" className="hw-pane">
        <div className="hw-pane-head">
          <h3 className="hw-pane-title">{t("settings.hardware.subsectionDetected")}</h3>
          <p className="hw-pane-desc">{t("settings.label.systemSummary")}</p>
        </div>

        <div className="hw-specs">
          {/* CPU */}
          <div className="hw-spec">
            <span className="hw-spec-icon hw-spec-icon--cpu" aria-hidden><CpuIcon /></span>
            <div className="hw-spec-body">
              <span className="hw-spec-label">{t("settingsPage.cpu")}</span>
              <span className="hw-spec-value">
                {systemInfo?.cpuName ?? t("settings.hardware.detecting")}
              </span>
            </div>
          </div>

          {/* Memory */}
          <div className="hw-spec">
            <span className="hw-spec-icon hw-spec-icon--memory" aria-hidden><MemoryIcon /></span>
            <div className="hw-spec-body">
              <span className="hw-spec-label">{t("settingsPage.memory")}</span>
              <span className="hw-spec-value">{systemInfo ? `${systemInfo.ramGb} GB` : "—"}</span>
              <span className="hw-spec-sub">{t("settings.hardware.ramSub")}</span>
            </div>
          </div>

          {/* GPU(s) — every adapter is a clickable chip */}
          <div className="hw-spec hw-spec--gpu">
            <span className="hw-spec-icon hw-spec-icon--gpu" aria-hidden><GpuIcon /></span>
            <div className="hw-spec-body">
              <span className="hw-spec-label">
                {t("settingsPage.gpus")}
                {systemInfo && systemInfo.gpus.length > 0 && (
                  <span className="hw-spec-count">{systemInfo.gpus.length}</span>
                )}
              </span>

              {(!systemInfo || systemInfo.gpus.length === 0) && (
                <span className="hw-spec-empty">{t("settings.hardware.noGpus")}</span>
              )}

              {systemInfo && systemInfo.gpus.length > 0 && (
                <div className="hw-gpu-chips" role="listbox" aria-label={t("settings.hardware.gpuListAria")}>
                  {systemInfo.gpus.map((g) => {
                    const isActive = selectedGpu?.id === g.id;
                    const vram =
                      g.vramMb >= 1024
                        ? `${(g.vramMb / 1024).toFixed(g.vramMb % 1024 === 0 ? 0 : 1)} GB`
                        : `${g.vramMb} MB`;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={"hw-gpu-chip" + (isActive ? " active" : "")}
                        data-active={isActive ? "true" : "false"}
                        title={`${g.name} · ${vram}`}
                        onClick={() => {
                          setSelectedGpu(g);
                          showToast(t("settings.hardware.gpuSelected", { name: g.name }), "success");
                        }}
                      >
                        <span className="hw-gpu-chip-dot" aria-hidden />
                        <span className="hw-gpu-chip-name">{g.name}</span>
                        <span className="hw-gpu-chip-vram">{vram}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Telemetry / monitoring ─────────────────────────────── */}
      <div id="hw-monitor" className={"hw-pane" + (hardwareMonitoringEnabled ? "" : " is-disabled")}>
        <div className="hw-pane-head">
          <h3 className="hw-pane-title">{t("settings.hardware.subsectionTelemetry")}</h3>
          <p className="hw-pane-desc">{t("settings.hardware.metricsDesc")}</p>
        </div>

        <div className="hw-metric-grid">
          {([
            ["fps", "FPS", GaugeIcon],
            ["cpu", t("settingsPage.cpu") + " Load", CpuIcon],
            ["gpu", t("settingsPage.gpus") + " Load", GpuIcon],
            ["ram", t("settingsPage.memory") + " Usage", MemoryIcon],
            ["cpuTemp", t("settingsPage.cpu") + " Temp", CpuIcon],
            ["gpuTemp", t("settingsPage.gpus") + " Temp", GpuIcon],
          ] as const).map(([key, label, Icon]) => (
            <label
              key={key}
              className={"hw-metric" + (metricCapture[key] ? " on" : "")}
              data-on={metricCapture[key]}
            >
              <span className="hw-metric-icon" aria-hidden><Icon /></span>
              <span className="hw-metric-label">{label}</span>
              <span className="hw-metric-switch" aria-hidden>
                <input
                  type="checkbox"
                  checked={metricCapture[key]}
                  disabled={!hardwareMonitoringEnabled}
                  onChange={(e) => setMetricCapture({ ...metricCapture, [key]: e.target.checked })}
                />
                <span className="hw-metric-knob" />
              </span>
            </label>
          ))}
        </div>

        <div className="hw-duo">
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">{t("settings.label.samplingInterval")}</label>
              <span className="hw-card-value">{samplingIntervalSec} s</span>
            </div>
            <p className="hw-card-help">{t("settings.hardware.samplingDesc")}</p>
            <input
              type="range"
              className="hw-range"
              min={0.25}
              max={60}
              step={0.25}
              value={samplingIntervalSec}
              disabled={!hardwareMonitoringEnabled}
              onChange={(e) => setSamplingIntervalSec(Number(e.target.value))}
              aria-label={t("settings.aria.samplingInterval")}
            />
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">{t("settings.label.gpu")}</label>
              <Button variant="secondary" size="sm" onClick={refreshGpus} leftIcon={<RefreshIcon />}>
                {t("settings.refresh")}
              </Button>
            </div>
            <p className="hw-card-help">{t("settings.hardware.gpuDesc")}</p>
            <select
              className="settings-select hw-select"
              value={selectedGpu?.id || ""}
              onChange={(e) => {
                const gpu = availableGpus.find((g) => g.id === e.target.value);
                setSelectedGpu(gpu || null);
                showToast(
                  gpu
                    ? t("settings.hardware.gpuSelected", { name: gpu.name })
                    : t("settings.hardware.gpuCleared"),
                  "success",
                );
              }}
              aria-label={t("settings.label.gpu")}
            >
              <option value="">{t("settings.gpuPlaceholder")}</option>
              {availableGpus.map((gpu) => (
                <option key={gpu.id} value={gpu.id}>
                  {gpu.name} ({gpu.vramMb} MB)
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Display preferences ────────────────────────────────── */}
      <div id="hw-display" className="hw-pane">
        <div className="hw-pane-head">
          <h3 className="hw-pane-title">{t("settings.hardware.subsectionDisplay")}</h3>
          <p className="hw-pane-desc">{t("settingsPage.sizeUnitHelp")}</p>
        </div>

        <div className="hw-duo">
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">{t("settings.label.tempUnit")}</label>
            </div>
            <p className="hw-card-help">{t("settings.hardware.tempUnitDesc")}</p>
            <div className="settings-segmented hw-seg" role="group" aria-label={t("settings.aria.tempUnit")}>
              <button type="button" className={tempUnit === "c" ? "active" : ""} onClick={() => setTempUnit("c")}>°C</button>
              <button type="button" className={tempUnit === "f" ? "active" : ""} onClick={() => setTempUnit("f")}>°F</button>
            </div>
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">{t("settings.label.sizeUnit")}</label>
            </div>
            <p className="hw-card-help">
              <strong>GB</strong> {t("settingsPage.sizeUnitGbDesc")}
              <strong> GiB</strong> {t("settingsPage.sizeUnitGibDesc")}
            </p>
            <select
              className="settings-select hw-select"
              value={sizeUnit}
              onChange={(e) => {
                const next = e.target.value as SizeUnit;
                setSizeUnit(next);
                showToast(next === "gb" ? t("settings.storage.sizeNowGB") : t("settings.storage.sizeNowGiB"), "success");
              }}
              aria-label={t("settings.label.sizeUnit")}
            >
              <option value="gb">{t("settingsPage.gbDecimal")}</option>
              <option value="gib">{t("settingsPage.gibBinary")}</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}
