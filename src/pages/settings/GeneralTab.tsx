import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useAppVersion } from "../../hooks/useAppVersion";
import { useUpdate, formatBytes } from "../../context/UpdateContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { FlagIcon, Button } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { CompatibilityIcon, GamepadIcon, GlobeIcon, RefreshIcon } from "./settingsIcons";

/**
 * GeneralTab — app-wide preferences. Hosts the display
 * language listbox picker and application update controls.
 */
export default function GeneralTab() {
  const { language, setLanguage, languages, t } = useLanguage();
  const { showToast } = useToast();
  const version = useAppVersion();
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

  const currentLanguage =
    languages.find((l) => l.code === language) ?? languages[0];

  const modeLabel =
    installMode === "portable"
      ? t("updater.modePortable")
      : installMode === "nsis"
        ? t("updater.modeInstalled")
        : t("updater.modeDev");

  const lastCheckedTime = (() => {
    if (!lastCheckedAt) return null;
    const date = new Date(lastCheckedAt);
    if (Number.isNaN(date.getTime())) return null;
    return t("updater.lastChecked", { time: date.toLocaleTimeString() });
  })();

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
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <SettingsSection
        id="general-language"
        icon={<GlobeIcon />}
        title={t("settings.language")}
        desc={t("settingsPage.languageDesc")}
      >
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
                    onMouseEnter={() =>
                      setLanguagePickerHoverIdx(idx)
                    }
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
      </SettingsSection>

      <SettingsSection
        id="general-updates"
        icon={<RefreshIcon />}
        title={t("updater.title")}
        desc={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            {t("updater.autoCheckDesc")}
            <span
              style={{
                background: "var(--bg-tertiary, var(--color-bg-tertiary))",
                border: "1px solid var(--border-subtle, var(--color-border))",
                color: "var(--text-muted, var(--color-text-muted))",
                fontSize: "11px",
                fontWeight: 500,
                padding: "2px 8px",
                borderRadius: "12px",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
              }}
            >
              {modeLabel}
            </span>
          </span>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <SettingsToggleCard
            title={t("updater.autoCheck")}
            desc={t("updater.autoCheckDesc")}
            checked={autoCheckUpdates}
            onChange={(checked) => setAutoCheckUpdates(checked)}
          />

          <div
            className="settings-behavior-card"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "14px",
                  marginBottom: "4px",
                  color:
                    status === "error"
                      ? "rgba(248, 113, 113, 0.85)"
                      : undefined,
                }}
              >
                {status === "checking"
                  ? t("updater.checking")
                  : status === "available"
                  ? t("updater.newVersionAvailable", { version: updateInfo?.version ?? "" })
                  : status === "up-to-date"
                  ? t("updater.upToDate")
                  : status === "downloading"
                  ? `${t("updater.downloading")} (${progress.percent}%)`
                  : status === "ready"
                  ? t("updater.readyToRestart")
                  : status === "restarting"
                  ? t("updater.restarting")
                  : status === "error"
                  ? (error || t("updater.errorGeneric"))
                  : t("updater.title")}
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-muted, var(--color-text-muted))" }}>
                {status === "available"
                  ? t("updater.newVersionAvailableDesc")
                  : status === "downloading" && progress.speedBytesPerSec > 0
                  ? t("updater.speed", { speed: formatBytes(progress.speedBytesPerSec) })
                  : `GameIndex v${version} · GitHub Releases (atxoxx/GameIndex)`}
              </div>
              {lastCheckedTime && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-muted, var(--color-text-muted))",
                    marginTop: "2px",
                  }}
                >
                  {lastCheckedTime}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              {status === "available" ? (
                <>
                  <Button variant="primary" onClick={() => void installUpdate()}>
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
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="general-gamepad"
        icon={<GamepadIcon />}
        title={t("settings.section.gamepad")}
        desc={t("settings.gamepad.desc")}
      >
        <div className="hw-duo">
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">{t("settings.gamepad.leftDeadzone")}</label>
              <span className="hw-card-value">
                {gamepadLeftDeadzone === null
                  ? t("settings.gamepad.auto")
                  : `${Math.round(gamepadLeftDeadzone * 100)}%`}
              </span>
            </div>
            <p className="hw-card-help">{t("settings.gamepad.deadzoneDesc")}</p>
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
            <Button
              variant="ghost"
              size="sm"
              disabled={gamepadLeftDeadzone === null}
              onClick={() => setGamepadLeftDeadzone(null)}
            >
              {t("settings.gamepad.auto")}
            </Button>
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">{t("settings.gamepad.rightDeadzone")}</label>
              <span className="hw-card-value">
                {gamepadRightDeadzone === null
                  ? t("settings.gamepad.auto")
                  : `${Math.round(gamepadRightDeadzone * 100)}%`}
              </span>
            </div>
            <p className="hw-card-help">{t("settings.gamepad.deadzoneDesc")}</p>
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
            <Button
              variant="ghost"
              size="sm"
              disabled={gamepadRightDeadzone === null}
              onClick={() => setGamepadRightDeadzone(null)}
            >
              {t("settings.gamepad.auto")}
            </Button>
          </div>
        </div>
      </SettingsSection>

      {/* ── Linux & Steam Deck Support ────────────────────────── */}
      <SettingsSection
        id="general-linux"
        icon={<CompatibilityIcon />}
        title={t("settings.linux.title")}
        desc={t("settings.linux.desc")}
      >
        {isLinuxHost ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
              className="settings-behavior-card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "16px 20px",
              }}
            >
              <span style={{ fontSize: "20px" }}>🐧</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "2px" }}>
                  {t("settings.linux.modeFull")}
                </div>
                <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  {t("settings.linux.nativeLinuxNotice")}
                </div>
              </div>
            </div>

            <div
              className="settings-behavior-card"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "16px 20px",
              }}
            >
              <span style={{ fontSize: "20px" }}>🕹️</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>
                  {t("settings.linux.emulatorsTitle")}
                </div>
                <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  {t("settings.linux.emulatorsDesc")}
                </div>
                <code
                  style={{
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-secondary)",
                    overflowWrap: "anywhere",
                  }}
                >
                  flatpak run org.libretro.RetroArch "%ROM%"
                </code>
                <code
                  style={{
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-secondary)",
                    overflowWrap: "anywhere",
                  }}
                >
                  snap run retroarch "%ROM%"
                </code>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  {t("settings.linux.emulatorsPaths")}: /usr/bin · /usr/local/bin ·
                  /var/lib/flatpak/exports/bin · /snap/bin · ~/Applications · ~/AppImages
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <SettingsToggleCard
              title={t("settings.linux.enableTitle")}
              desc={t("settings.linux.enableDesc")}
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
            />

            {linuxSupportLevel !== "disabled" && (
              <div className="hw-duo">
                {/* Choice 1: Show Proton / Steam Deck verified */}
                <div
                  className={`hw-card ${linuxSupportLevel === "deck_verified" ? "active" : ""}`}
                  role="button"
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
                  style={{
                    cursor: "pointer",
                    borderColor:
                      linuxSupportLevel === "deck_verified"
                        ? "var(--color-accent)"
                        : undefined,
                    background:
                      linuxSupportLevel === "deck_verified"
                        ? "color-mix(in srgb, var(--color-accent) 8%, var(--color-surface))"
                        : undefined,
                  }}
                >
                  <div className="hw-card-head">
                    <span className="hw-card-label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          border: `2px solid ${linuxSupportLevel === "deck_verified" ? "var(--color-accent)" : "var(--color-border)"}`,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {linuxSupportLevel === "deck_verified" && (
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: "var(--color-accent)",
                            }}
                          />
                        )}
                      </span>
                      {t("settings.linux.modeDeckVerified")}
                    </span>
                    <span className="hw-card-value">
                      {t("settings.linux.badgeDeck")}
                    </span>
                  </div>
                  <p className="hw-card-help">
                    {t("settings.linux.modeDeckVerifiedDesc")}
                  </p>
                </div>

                {/* Choice 2: Full Linux-related UI */}
                <div
                  className={`hw-card ${linuxSupportLevel === "full" ? "active" : ""}`}
                  role="button"
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
                  style={{
                    cursor: "pointer",
                    borderColor:
                      linuxSupportLevel === "full"
                        ? "var(--color-accent)"
                        : undefined,
                    background:
                      linuxSupportLevel === "full"
                        ? "color-mix(in srgb, var(--color-accent) 8%, var(--color-surface))"
                        : undefined,
                  }}
                >
                  <div className="hw-card-head">
                    <span className="hw-card-label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          border: `2px solid ${linuxSupportLevel === "full" ? "var(--color-accent)" : "var(--color-border)"}`,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {linuxSupportLevel === "full" && (
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: "var(--color-accent)",
                            }}
                          />
                        )}
                      </span>
                      {t("settings.linux.modeFull")}
                    </span>
                    <span className="hw-card-value">
                      {t("settings.linux.badgeFull")}
                    </span>
                  </div>
                  <p className="hw-card-help">
                    {t("settings.linux.modeFullDesc")}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
