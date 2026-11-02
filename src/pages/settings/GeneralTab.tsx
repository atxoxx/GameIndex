import { useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSetupWizard } from "../../context/SetupWizardContext";
import {
  useUpdate,
  formatBytes,
  installModeLabelKey,
} from "../../context/UpdateContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { FlagIcon, Button, ChangelogModal } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import SettingsRow from "./SettingsRow";
import SettingsSwitch from "./SettingsSwitch";
import { CompatibilityIcon, GamepadIcon, GlobeIcon, RefreshIcon } from "./settingsIcons";

/**
 * GeneralTab — app-wide preferences. Hosts the display
 * language listbox picker and application update controls.
 */
export default function GeneralTab() {
  const { language, setLanguage, languages, t } = useLanguage();
  const { openWizard } = useSetupWizard();
  const { showToast } = useToast();
  const {
    autoCheckUpdates,
    setAutoCheckUpdates,
    installMode,
    status,
    updateInfo,
    error,
    progress,
    lastCheckedAt,
    checkForUpdates,
    installUpdate,
    applyUpdate,
    setShowModal,
  } = useUpdate();
  const {
    gamepadLeftDeadzone,
    setGamepadLeftDeadzone,
    gamepadRightDeadzone,
    setGamepadRightDeadzone,
    isLinuxHost,
    linuxSupportLevel,
    setLinuxSupportLevel,
  } = useSettings();

  // Custom-language-picker state. The native <select> was replaced with
  // a richer listbox-style picker, so we need an open/close flag plus a
  // "hovered option index" so ArrowUp/ArrowDown keyboard nav feels like
  // a real listbox.
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [languagePickerHoverIdx, setLanguagePickerHoverIdx] = useState(0);
  const languagePickerRef = useRef<HTMLDivElement>(null);
  const languagePickerTriggerRef = useRef<HTMLButtonElement>(null);
  const [showChangelog, setShowChangelog] = useState(false);

  const currentLanguage =
    languages.find((l) => l.code === language) ?? languages[0];

  const modeLabel = t(installModeLabelKey(installMode));

  const lastCheckedTime = (() => {
    if (!lastCheckedAt) return null;
    const date = new Date(lastCheckedAt);
    if (Number.isNaN(date.getTime())) return null;
    return t("updater.lastChecked", { time: date.toLocaleTimeString() });
  })();

  const statusTitle = (() => {
    switch (status) {
      case "checking":
        return t("updater.checking");
      case "available":
        return t("updater.newVersionAvailable", {
          version: updateInfo?.version ?? "",
        });
      case "up-to-date":
        return t("updater.upToDate");
      case "downloading":
        return `${t("updater.downloading")} (${progress.percent}%)`;
      case "ready":
        return t("updater.readyToRestart");
      case "restarting":
        return t("updater.restarting");
      case "error":
        return error || t("updater.errorGeneric");
      default:
        return t("updater.title");
    }
  })();

  const statusDetail =
    status === "available"
      ? t("updater.newVersionAvailableDesc")
      : status === "downloading" && progress.speedBytesPerSec > 0
        ? t("updater.speed", {
            speed: formatBytes(progress.speedBytesPerSec),
          })
        : null;

  const statusDesc = statusDetail
    ? lastCheckedTime
      ? `${statusDetail} · ${lastCheckedTime}`
      : statusDetail
    : (lastCheckedTime ?? undefined);

  // Auto deadzone: the value follows the pad's resting position, so the row
  // explains that instead of offering a reset that would do nothing.
  const leftDeadzoneAuto = gamepadLeftDeadzone === null;
  const rightDeadzoneAuto = gamepadRightDeadzone === null;

  const deadzoneValue = (value: number | null) =>
    value === null ? t("settings.gamepad.auto") : `${Math.round(value * 100)}%`;

  // Click-outside + keyboard navigation for the language picker.
  useEffect(() => {
    if (!languagePickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        languagePickerRef.current &&
        !languagePickerRef.current.contains(e.target as Node)
      ) {
        setLanguagePickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setLanguagePickerOpen(false);
        languagePickerTriggerRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setLanguagePickerHoverIdx((i) =>
          Math.min(i + 1, languages.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setLanguagePickerHoverIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const target = languages[languagePickerHoverIdx];
        if (target) {
          const pickedIdx = languages.findIndex((l) => l.code === target.code);
          void setLanguage(target.code);
          setLanguagePickerOpen(false);
          setLanguagePickerHoverIdx(pickedIdx >= 0 ? pickedIdx : 0);
          languagePickerTriggerRef.current?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [languagePickerOpen, languagePickerHoverIdx, languages, setLanguage]);

  return (
    <>
      <SettingsSection
        id="general-language"
        icon={<GlobeIcon />}
        title={t("common.language")}
        desc={t("settingsPage.languageDesc")}
      >
        <SettingsRow
          id="setting-language"
          layout="stacked"
          title={t("settings.language")}
          control={
            <div
              ref={languagePickerRef}
              className={`settings-language-picker${languagePickerOpen ? " open" : ""}`}
            >
              <button
                ref={languagePickerTriggerRef}
                type="button"
                className="language-trigger"
                aria-haspopup="listbox"
                aria-expanded={languagePickerOpen}
                aria-controls="settings-language-listbox"
                aria-activedescendant={
                  languagePickerOpen
                    ? `language-option-${languages[languagePickerHoverIdx]?.code ?? ""}`
                    : undefined
                }
                aria-label={t("settings.language")}
                onClick={() => {
                  setLanguagePickerOpen((wasOpen) => {
                    if (!wasOpen) {
                      const idx = languages.findIndex(
                        (l) => l.code === language,
                      );
                      setLanguagePickerHoverIdx(idx >= 0 ? idx : 0);
                    }
                    return !wasOpen;
                  });
                }}
              >
                <span className="language-trigger-flag" aria-hidden="true">
                  <FlagIcon code={currentLanguage.flag} size={22} />
                </span>
                <span className="language-trigger-info">
                  <span className="language-trigger-label">
                    {currentLanguage.label}
                  </span>
                  <span className="language-trigger-code">
                    {currentLanguage.code.toUpperCase()}
                  </span>
                </span>
                <svg
                  className="language-trigger-chevron"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 15 12 9 18 15" />
                </svg>
              </button>
              {languagePickerOpen && (
                <div
                  id="settings-language-listbox"
                  className="language-panel"
                  role="listbox"
                  aria-label={t("settings.language")}
                >
                  {languages.map((l, idx) => {
                    const isActive = l.code === language;
                    const isHovered = idx === languagePickerHoverIdx;
                    return (
                      <button
                        key={l.code}
                        type="button"
                        id={`language-option-${l.code}`}
                        role="option"
                        aria-selected={isActive}
                        className={`language-option${isActive ? " active" : ""}${isHovered ? " hovered" : ""}`}
                        onClick={() => {
                          void setLanguage(l.code);
                          setLanguagePickerOpen(false);
                        }}
                        onMouseEnter={() => setLanguagePickerHoverIdx(idx)}
                      >
                        <span
                          className="language-option-flag"
                          aria-hidden="true"
                        >
                          <FlagIcon code={l.flag} size={18} />
                        </span>
                        <span className="language-option-text">
                          <span className="language-option-label">
                            {l.label}
                          </span>
                          <span className="language-option-native">
                            {l.code.toUpperCase()}
                          </span>
                        </span>
                        {isActive && (
                          <svg
                            className="language-option-check"
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection
        id="general-setup"
        icon={<Sparkles />}
        title={t("settingsPage.setupTitle")}
        desc={t("settingsPage.setupDesc")}
      >
        <div className="settings-field">
          <Button variant="secondary" onClick={openWizard}>
            {t("settings.runSetup")}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        id="general-updates"
        icon={<RefreshIcon />}
        title={t("updater.title")}
      >
        <SettingsRow
          id="setting-auto-check-updates"
          title={t("updater.autoCheck")}
          desc={t("updater.autoCheckDesc")}
          control={
            <SettingsSwitch
              checked={autoCheckUpdates}
              onChange={(checked) => setAutoCheckUpdates(checked)}
              label={t("updater.autoCheck")}
            />
          }
        />

        <SettingsRow
          id="setting-check-updates"
          title={statusTitle}
          desc={statusDesc}
          badge={modeLabel}
          control={
            <>
              <Button
                id="setting-changelog"
                variant="ghost"
                onClick={() => setShowChangelog(true)}
              >
                {t("updater.changelog")}
              </Button>
              {status === "available" ? (
                <>
                  <Button
                    variant="primary"
                    onClick={() => void installUpdate()}
                  >
                    {t("updater.installUpdate")}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowModal(true)}>
                    {t("common.details")}
                  </Button>
                </>
              ) : status === "downloading" ? (
                <Button variant="primary" disabled isLoading>
                  {progress.percent}%
                </Button>
              ) : status === "ready" ? (
                <Button variant="primary" onClick={() => void applyUpdate()}>
                  {t("updater.relaunchNow")}
                </Button>
              ) : status === "restarting" ? (
                <Button variant="secondary" disabled isLoading>
                  {t("updater.restarting")}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => void checkForUpdates(true)}
                  isLoading={status === "checking"}
                >
                  {t("updater.checkForUpdates")}
                </Button>
              )}
            </>
          }
        />
      </SettingsSection>

      <SettingsSection
        id="general-gamepad"
        icon={<GamepadIcon />}
        title={t("settings.section.gamepad")}
        desc={t("settings.gamepad.desc")}
        advanced
      >
        <SettingsRow
          id="setting-left-deadzone"
          layout="stacked"
          title={t("settings.gamepad.leftDeadzone")}
          badge={deadzoneValue(gamepadLeftDeadzone)}
          desc={t("settings.gamepad.deadzoneDesc")}
        >
          <input
            type="range"
            className="hw-range"
            min={0.1}
            max={0.5}
            step={0.01}
            value={gamepadLeftDeadzone ?? 0.2}
            onChange={(e) => setGamepadLeftDeadzone(Number(e.target.value))}
            aria-label={t("settings.gamepad.leftDeadzone")}
          />
          {!leftDeadzoneAuto && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGamepadLeftDeadzone(null)}
            >
              {t("settings.gamepad.auto")}
            </Button>
          )}
        </SettingsRow>

        <SettingsRow
          id="setting-right-deadzone"
          layout="stacked"
          title={t("settings.gamepad.rightDeadzone")}
          badge={deadzoneValue(gamepadRightDeadzone)}
          desc={t("settings.gamepad.deadzoneDesc")}
        >
          <input
            type="range"
            className="hw-range"
            min={0.1}
            max={0.5}
            step={0.01}
            value={gamepadRightDeadzone ?? 0.2}
            onChange={(e) => setGamepadRightDeadzone(Number(e.target.value))}
            aria-label={t("settings.gamepad.rightDeadzone")}
          />
          {!rightDeadzoneAuto && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGamepadRightDeadzone(null)}
            >
              {t("settings.gamepad.auto")}
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>

      {/* ── Linux & Steam Deck Support ────────────────────────── */}
      <SettingsSection
        id="general-linux"
        icon={<CompatibilityIcon />}
        title={t("settings.linux.title")}
        desc={t("settings.linux.desc")}
        advanced
      >
        {isLinuxHost ? (
          <div className="settings-row">
            <div className="settings-behavior-card">
              <span className="settings-label">
                🐧 {t("settings.linux.modeFull")}
              </span>
              <p className="settings-helper-lead">
                {t("settings.linux.nativeLinuxNotice")}
              </p>
            </div>

            <div className="settings-behavior-card">
              <span className="settings-label">
                🕹️ {t("settings.linux.emulatorsTitle")}
              </span>
              <p className="settings-helper-lead">
                {t("settings.linux.emulatorsDesc")}
              </p>
              <p className="settings-helper-lead">
                <code>flatpak run org.libretro.RetroArch "%ROM%"</code>
              </p>
              <p className="settings-helper-lead">
                <code>snap run retroarch "%ROM%"</code>
              </p>
              <p className="settings-helper-text">
                {t("settings.linux.emulatorsPaths")}: /usr/bin · /usr/local/bin
                · /var/lib/flatpak/exports/bin · /snap/bin · ~/Applications ·
                ~/AppImages
              </p>
            </div>
          </div>
        ) : (
          <>
            <div
              className="settings-behavior-card settings-behavior-card--warn"
              role="note"
            >
              <span className="settings-label">
                {t("settings.linux.windowsWarningTitle")}
              </span>
              <p className="settings-helper-lead">
                {t("settings.linux.windowsWarningDesc")}
              </p>
            </div>

            <SettingsRow
              title={t("settings.linux.enableTitle")}
              desc={t("settings.linux.enableDesc")}
              control={
                <SettingsSwitch
                  checked={linuxSupportLevel !== "disabled"}
                  onChange={(checked) => {
                    const nextLevel = checked ? "deck_verified" : "disabled";
                    setLinuxSupportLevel(nextLevel);
                    showToast(
                      t("settings.linux.levelChanged", {
                        mode: checked
                          ? t("settings.linux.modeDeckVerified")
                          : t("settings.linux.modeDisabled"),
                      }),
                      "info",
                    );
                  }}
                  label={t("settings.linux.enableTitle")}
                />
              }
            />

            {linuxSupportLevel !== "disabled" && (
              <div
                className="hw-duo"
                role="radiogroup"
                aria-label={t("settings.linux.enableTitle")}
              >
                {/* Choice 1: Show Proton / Steam Deck verified */}
                <div
                  className={`hw-card${linuxSupportLevel === "deck_verified" ? " active" : ""}`}
                  role="radio"
                  aria-checked={linuxSupportLevel === "deck_verified"}
                  tabIndex={0}
                  onClick={() => {
                    setLinuxSupportLevel("deck_verified");
                    showToast(
                      t("settings.linux.levelChanged", {
                        mode: t("settings.linux.modeDeckVerified"),
                      }),
                      "success",
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLinuxSupportLevel("deck_verified");
                    }
                  }}
                >
                  <div className="hw-card-head">
                    <span className="hw-card-label">
                      {t("settings.linux.modeDeckVerified")}
                    </span>
                    <span className="hw-card-value">
                      {t("settings.linux.badgeDeck")}
                    </span>
                    {linuxSupportLevel === "deck_verified" && (
                      <Check size={14} aria-hidden />
                    )}
                  </div>
                  <p className="hw-card-help">
                    {t("settings.linux.modeDeckVerifiedDesc")}
                  </p>
                </div>

                {/* Choice 2: Full Linux-related UI */}
                <div
                  className={`hw-card${linuxSupportLevel === "full" ? " active" : ""}`}
                  role="radio"
                  aria-checked={linuxSupportLevel === "full"}
                  tabIndex={0}
                  onClick={() => {
                    setLinuxSupportLevel("full");
                    showToast(
                      t("settings.linux.levelChanged", {
                        mode: t("settings.linux.modeFull"),
                      }),
                      "success",
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLinuxSupportLevel("full");
                    }
                  }}
                >
                  <div className="hw-card-head">
                    <span className="hw-card-label">
                      {t("settings.linux.modeFull")}
                    </span>
                    <span className="hw-card-value">
                      {t("settings.linux.badgeFull")}
                    </span>
                    {linuxSupportLevel === "full" && (
                      <Check size={14} aria-hidden />
                    )}
                  </div>
                  <p className="hw-card-help">
                    {t("settings.linux.modeFullDesc")}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </SettingsSection>

      <ChangelogModal
        open={showChangelog}
        onClose={() => setShowChangelog(false)}
      />
    </>
  );
}
