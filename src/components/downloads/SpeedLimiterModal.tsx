import { useState, useEffect } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";

interface SpeedLimiterModalProps {
  open: boolean;
  onClose: () => void;
}

const DL_PRESETS = [
  { label: "Unlimited", value: 0 },
  { label: "100 MB/s", value: 102400 },
  { label: "50 MB/s", value: 51200 },
  { label: "25 MB/s", value: 25600 },
  { label: "10 MB/s", value: 10240 },
  { label: "5 MB/s", value: 5120 },
  { label: "2 MB/s", value: 2048 },
];

const UL_PRESETS = [
  { label: "Disabled", value: -1 },
  { label: "1 MB/s", value: 1024 },
  { label: "2 MB/s", value: 2048 },
  { label: "5 MB/s", value: 5120 },
  { label: "10 MB/s", value: 10240 },
  { label: "Unlimited", value: 0 },
];

export default function SpeedLimiterModal({ open, onClose }: SpeedLimiterModalProps) {
  const { updateSpeedLimits, setSeedConfig, seedAfterComplete } = useDownloads();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [dlLimit, setDlLimit] = useState<number>(0);
  const [ulLimit, setUlLimit] = useState<number>(0);
  const [disableUpload, setDisableUpload] = useState<boolean>(false);
  const [seedingEnabled, setSeedingEnabled] = useState<boolean>(seedAfterComplete);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const dlEnabled = localStorage.getItem("gamelib-dl-limit-download-enabled") === "true";
    const dlVal = parseInt(localStorage.getItem("gamelib-dl-limit-download-value") || "0", 10);
    const ulEnabled = localStorage.getItem("gamelib-dl-limit-upload-enabled") === "true";
    const ulVal = parseInt(localStorage.getItem("gamelib-dl-limit-upload-value") || "0", 10);
    const noUpload = localStorage.getItem("gamelib-dl-limit-disable-upload") === "true";

    setDlLimit(dlEnabled && dlVal > 0 ? dlVal : 0);
    setDisableUpload(noUpload);
    setUlLimit(noUpload ? -1 : ulEnabled && ulVal > 0 ? ulVal : 0);
    setSeedingEnabled(seedAfterComplete);
  }, [open, seedAfterComplete]);

  if (!open) return null;

  const handleApply = async () => {
    setSaving(true);
    try {
      const isDlLimited = dlLimit > 0;
      const isUlDisabled = disableUpload || ulLimit === -1;
      const isUlLimited = !isUlDisabled && ulLimit > 0;

      localStorage.setItem("gamelib-dl-limit-download-enabled", isDlLimited ? "true" : "false");
      localStorage.setItem("gamelib-dl-limit-download-value", dlLimit.toString());
      localStorage.setItem("gamelib-dl-limit-upload-enabled", isUlLimited ? "true" : "false");
      localStorage.setItem("gamelib-dl-limit-upload-value", isUlLimited ? ulLimit.toString() : "0");
      localStorage.setItem("gamelib-dl-limit-disable-upload", isUlDisabled ? "true" : "false");
      localStorage.setItem("gamelib-seed-after-complete", seedingEnabled ? "true" : "false");

      await updateSpeedLimits(
        isDlLimited ? dlLimit : null,
        isUlLimited ? ulLimit : null,
        isUlDisabled,
      );
      await setSeedConfig(seedingEnabled);

      showToast(t("downloads.limitsApplied"), "success");
      onClose();
    } catch (err) {
      showToast(t("downloadRow.mirrorFailed", { error: String(err) }), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dl-speed-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">{t("downloads.speedLimiterTitle")}</h2>
            <p className="modal-subtitle">{t("downloads.speedLimiterDesc")}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </div>

        <div className="modal-body dl-speed-body">
          {/* Download Speed Limit */}
          <div className="dl-speed-section">
            <div className="dl-speed-section-title">
              <span>{t("downloads.downloadLimit")}</span>
              <span className="dl-speed-current-val">
                {dlLimit === 0 ? t("downloads.unlimited") : `${(dlLimit / 1024).toFixed(0)} MB/s`}
              </span>
            </div>
            <div className="dl-speed-presets">
              {DL_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`dl-speed-preset-btn${dlLimit === p.value ? " active" : ""}`}
                  onClick={() => setDlLimit(p.value)}
                >
                  {p.value === 0 ? t("downloads.unlimited") : p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Upload Speed Limit */}
          <div className="dl-speed-section">
            <div className="dl-speed-section-title">
              <span>{t("downloads.uploadLimit")}</span>
              <span className="dl-speed-current-val">
                {disableUpload || ulLimit === -1
                  ? t("downloads.disableUpload")
                  : ulLimit === 0
                  ? t("downloads.unlimited")
                  : `${(ulLimit / 1024).toFixed(0)} MB/s`}
              </span>
            </div>
            <div className="dl-speed-presets">
              {UL_PRESETS.map((p) => {
                const isSelected = p.value === -1 ? (disableUpload || ulLimit === -1) : (!disableUpload && ulLimit === p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    className={`dl-speed-preset-btn${isSelected ? " active" : ""}`}
                    onClick={() => {
                      if (p.value === -1) {
                        setDisableUpload(true);
                        setUlLimit(-1);
                      } else {
                        setDisableUpload(false);
                        setUlLimit(p.value);
                      }
                    }}
                  >
                    {p.value === -1 ? t("downloads.disableUpload") : p.value === 0 ? t("downloads.unlimited") : p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Seeding Preferences */}
          <div className="dl-speed-section">
            <div className="dl-speed-section-title">
              <span>{t("downloads.seedingSettings")}</span>
            </div>
            <label className="dl-speed-toggle-row">
              <div className="dl-speed-toggle-info">
                <span className="dl-speed-toggle-title">{t("downloads.seedAfterCompletion")}</span>
              </div>
              <div className="dl-switch">
                <input
                  type="checkbox"
                  checked={seedingEnabled}
                  onChange={(e) => setSeedingEnabled(e.target.checked)}
                />
                <span className="dl-switch-track">
                  <span className="dl-switch-thumb" />
                </span>
              </div>
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleApply} isLoading={saving}>
            {t("downloads.applyLimits")}
          </Button>
        </div>
      </div>
    </div>
  );
}
