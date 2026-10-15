import { RefreshCw } from "lucide-react";
import { useActivity } from "../../../context/ActivityContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { Button } from "../../ui";
import { SetupOptionCard, SetupSection, SetupToggle } from "../SetupControls";

/**
 * Sixth step: pick the GPU used for telemetry and opt into metric
 * recording. The GPU choice matters on systems with virtual display
 * adapters, where the first adapter is often not the real GPU.
 */
export default function HardwareStep() {
  const { t } = useLanguage();
  const { availableGpus, selectedGpu, setSelectedGpu, refreshGpus } = useActivity();
  const { hardwareMonitoringEnabled, setHardwareMonitoringEnabled } = useSettings();

  return (
    <div className="setup-step">
      <SetupSection
        title={t("setup.hardware.gpu")}
        desc={t("setup.hardware.body")}
        tip={t("setup.hardware.gpuTip")}
      >
        {availableGpus.length === 0 ? (
          <p className="setup-section__note">{t("setup.hardware.gpuNone")}</p>
        ) : (
          <div className="setup-option-grid">
            <SetupOptionCard
              title={t("setup.hardware.gpuAuto")}
              selected={selectedGpu === null}
              onSelect={() => setSelectedGpu(null)}
            />
            {availableGpus.map((gpu) => (
              <SetupOptionCard
                key={gpu.id}
                title={gpu.name}
                desc={gpu.vendor}
                selected={selectedGpu?.id === gpu.id}
                onSelect={() => setSelectedGpu(gpu)}
              />
            ))}
          </div>
        )}
        <div className="setup-inline-actions">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            onClick={() => void refreshGpus()}
          >
            {t("setup.hardware.refresh")}
          </Button>
        </div>
      </SetupSection>

      <SetupSection title={t("setup.hardware.monitoring")}>
        <div className="setup-toggle-list">
          <SetupToggle
            title={t("setup.features.hardware")}
            tip={t("setup.hardware.monitoringTip")}
            checked={hardwareMonitoringEnabled}
            onChange={setHardwareMonitoringEnabled}
          />
        </div>
      </SetupSection>
    </div>
  );
}
