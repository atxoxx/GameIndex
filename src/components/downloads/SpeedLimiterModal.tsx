import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { formatBytesPerSecond } from "../../types/download";
import { Button } from "../ui";
import { SlidersIcon } from "./DownloadIcons";

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
  const { speedLimits, setSpeedLimits, setSeedConfig, seedAfterComplete } = useDownloads();
  const { showToast } = useToast();
  const { t, language } = useLanguage();
  const { unit: speedUnit } = useSpeedUnit();

  const [dlLimit, setDlLimit] = useState<number>(0);
  const [ulLimit, setUlLimit] = useState<number>(0);
  const [disableUpload, setDisableUpload] = useState<boolean>(false);
  const [seedingEnabled, setSeedingEnabled] = useState<boolean>(seedAfterComplete);
  const [saving, setSaving] = useState(false);
  // Custom-limit inputs (MB/s as text) — empty when the current value
  // matches a preset or is unlimited/disabled.
  const [dlCustom, setDlCustom] = useState<string>("");
  const [ulCustom, setUlCustom] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setDlLimit(speedLimits.downloadEnabled && speedLimits.downloadValue > 0 ? speedLimits.downloadValue : 0);
    setDisableUpload(speedLimits.disableUpload);
    setUlLimit(
      speedLimits.disableUpload
        ? -1
        : speedLimits.uploadEnabled && speedLimits.uploadValue > 0
        ? speedLimits.uploadValue
        : 0,
    );
    setSeedingEnabled(seedAfterComplete);
    setDlCustom(
      speedLimits.downloadEnabled && speedLimits.downloadValue > 0
        ? DL_PRESETS.some((p) => p.value === speedLimits.downloadValue)
          ? ""
          : String(speedLimits.downloadValue / 1024)
        : "",
    );
    setUlCustom(
      !speedLimits.disableUpload && speedLimits.uploadEnabled && speedLimits.uploadValue > 0
        ? UL_PRESETS.some((p) => p.value === speedLimits.uploadValue)
          ? ""
          : String(speedLimits.uploadValue / 1024)
        : "",
    );
  }, [open, speedLimits, seedAfterComplete]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, saving, onClose]);

  if (!open) return null;

  // MB/s text input -> kbps limit (0/empty = unlimited).
  const applyDlCustom = (v: string) => {
    setDlCustom(v);
    const num = parseFloat(v);
    setDlLimit(Number.isFinite(num) && num > 0 ? Math.round(num * 1024) : 0);
  };

  const applyUlCustom = (v: string) => {
    setUlCustom(v);
    const num = parseFloat(v);
    if (Number.isFinite(num) && num > 0) {
      setDisableUpload(false);
      setUlLimit(Math.round(num * 1024));
    } else {
      setUlLimit(0);
    }
  };

  const handleApply = async () => {
    setSaving(true);
    try {
      const isDlLimited = dlLimit > 0;
      const isUlDisabled = disableUpload || ulLimit === -1;
      const isUlLimited = !isUlDisabled && ulLimit > 0;

      await setSpeedLimits({
        downloadEnabled: isDlLimited,
        downloadValue: dlLimit,
        uploadEnabled: isUlLimited,
        uploadValue: ulLimit,
        disableUpload: isUlDisabled,
      });
      await setSeedConfig(seedingEnabled);

      showToast(t("downloads.limitsApplied"), "success");
      onClose();
    } catch (err) {
      showToast(t("downloadRow.mirrorFailed", { error: String(err) }), "error");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="dl-speed-modal-title">
      <div className="modal dl-speed-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-icon">
            <SlidersIcon style={{ width: 18, height: 18 }} />
          </div>
          <div className="modal-header-text">
            <h2 id="dl-speed-modal-title" className="modal-title">{t("downloads.speedLimiterTitle")}</h2>
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
                {dlLimit === 0 ? t("downloads.unlimited") : formatBytesPerSecond(dlLimit * 1024, speedUnit)}
              </span>
            </div>
            <div className="dl-speed-presets">
              {DL_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`dl-speed-preset-btn${dlLimit === p.value ? " active" : ""}`}
                  onClick={() => {
                    setDlLimit(p.value);
                    setDlCustom("");
                  }}
                >
                  {p.value === 0 ? t("downloads.unlimited") : formatBytesPerSecond(p.value * 1024, speedUnit)}
                </button>
              ))}
            </div>
            <div className="dl-speed-custom-row">
              <span className="dl-speed-custom-label">{t("downloads.custom")}</span>
              <input
                type="number"
                min="0"
                step="0.5"
                className="dl-speed-custom-input"
                placeholder={t("downloads.unlimited")}
                value={dlCustom}
                aria-label={`${t("downloads.downloadLimit")} (${t("downloads.custom")})`}
                onChange={(e) => applyDlCustom(e.target.value)}
              />
              <span className="dl-speed-custom-unit">{language === "fr" ? "Mo/s" : "MB/s"}</span>
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
                  : formatBytesPerSecond(ulLimit * 1024, speedUnit)}
              </span>
            </div>
            <div className="dl-speed-presets">
              {UL_PRESETS.map((p) => {
                const isSelected =
                  p.value === -1 ? disableUpload || ulLimit === -1 : !disableUpload && ulLimit === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    className={`dl-speed-preset-btn${isSelected ? " active" : ""}`}
                    onClick={() => {
                      setUlCustom("");
                      if (p.value === -1) {
                        setDisableUpload(true);
                        setUlLimit(-1);
                      } else {
                        setDisableUpload(false);
                        setUlLimit(p.value);
                      }
                    }}
                  >
                    {p.value === -1 ? t("downloads.disableUpload") : p.value === 0 ? t("downloads.unlimited") : formatBytesPerSecond(p.value * 1024, speedUnit)}
                  </button>
                );
              })}
            </div>
            <div className="dl-speed-custom-row">
              <span className="dl-speed-custom-label">{t("downloads.custom")}</span>
              <input
                type="number"
                min="0"
                step="0.5"
                className="dl-speed-custom-input"
                placeholder={t("downloads.disableUpload")}
                value={ulCustom}
                aria-label={`${t("downloads.uploadLimit")} (${t("downloads.custom")})`}
                onChange={(e) => applyUlCustom(e.target.value)}
              />
              <span className="dl-speed-custom-unit">{language === "fr" ? "Mo/s" : "MB/s"}</span>
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
    </div>,
    document.body
  );
}
