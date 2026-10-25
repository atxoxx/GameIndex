import { Field, FieldGrid, SectionHeader, SettingCard } from "../EditFields";
import { GlobalSettingHint, TriStateCard } from "../CompatibilityShared";
import { useEditGame } from "../EditGameContext";

export function ToolsSection() {
  const {
    t,
    globalCompatSettings,
    mangohudActive,
    compatMangoHud,
    setCompatMangoHud,
    compatMangoHudHidden,
    setCompatMangoHudHidden,
    compatUmu,
    setCompatUmu,
    compatController,
    setCompatController,
    compatAnticheat,
    setCompatAnticheat,
    compatGameMode,
    setCompatGameMode,
    compatPrime,
    setCompatPrime,
    compatGamescope,
    setCompatGamescope,
    compatGamescopeArgs,
    setCompatGamescopeArgs,
    compatGamescopeMode,
    setCompatGamescopeMode,
    compatGamescopeGameWidth,
    setCompatGamescopeGameWidth,
    compatGamescopeGameHeight,
    setCompatGamescopeGameHeight,
    compatGamescopeWindowWidth,
    setCompatGamescopeWindowWidth,
    compatGamescopeWindowHeight,
    setCompatGamescopeWindowHeight,
    compatGamescopeFilter,
    setCompatGamescopeFilter,
    compatGamescopeFsrSharpness,
    setCompatGamescopeFsrSharpness,
    compatGamescopeFpsLimit,
    setCompatGamescopeFpsLimit,
    compatGamescopeRefreshRate,
    setCompatGamescopeRefreshRate,
    compatGamescopeAdaptiveSync,
    setCompatGamescopeAdaptiveSync,
    compatGamescopeHdr,
    setCompatGamescopeHdr,
    compatGamescopeStretch,
    setCompatGamescopeStretch,
    compatGamescopeForceWindowsFullscreen,
    setCompatGamescopeForceWindowsFullscreen,
    globalGamescopeModeLabel,
    globalGamescopeFilterLabel,
    globalGameResLabel,
    globalOutputResLabel,
    globalGamescopeArgsLabel,
    globalFsrSharpnessLabel,
    globalFpsLimitLabel,
    globalRefreshRateLabel,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-tools">
      <SectionHeader
        id="edit-section-tools"
        title={t("edit.section.tools")}
        description={t("edit.section.toolsDesc")}
        changed={dirtyBySection.tools}
        onReset={() => resetSection("tools")}
      />

      <TriStateCard
        id="compat-mangohud"
        title={t("gameEdit.compatibility.mangohudTitle")}
        desc={t("gameEdit.compatibility.mangohudDesc")}
        value={compatMangoHud}
        onChange={setCompatMangoHud}
        globalValue={globalCompatSettings?.enableMangoHud}
      />
      {mangohudActive && (
        <TriStateCard
          title={t("gameEdit.compatibility.mangohudHiddenTitle")}
          desc={t("gameEdit.compatibility.mangohudHiddenDesc")}
          value={compatMangoHudHidden}
          onChange={setCompatMangoHudHidden}
          globalValue={globalCompatSettings?.mangohudHidden}
        />
      )}
      <TriStateCard
        title={t("gameEdit.compatibility.umuTitle")}
        desc={t("gameEdit.compatibility.umuDesc")}
        value={compatUmu}
        onChange={setCompatUmu}
        globalValue={globalCompatSettings?.enableUmuLauncher}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.controllerTitle")}
        desc={t("gameEdit.compatibility.controllerDesc")}
        value={compatController}
        onChange={setCompatController}
        globalValue={globalCompatSettings?.enableControllerSupport}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.anticheatTitle")}
        desc={t("gameEdit.compatibility.anticheatDesc")}
        value={compatAnticheat}
        onChange={setCompatAnticheat}
        globalValue={globalCompatSettings?.enableAnticheatSupport}
      />
      <TriStateCard
        id="compat-gamemode"
        title={t("gameEdit.compatibility.gamemodeTitle")}
        desc={t("gameEdit.compatibility.gamemodeDesc")}
        value={compatGameMode}
        onChange={setCompatGameMode}
        globalValue={globalCompatSettings?.enableGameMode}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.primeTitle")}
        desc={t("gameEdit.compatibility.primeDesc")}
        value={compatPrime}
        onChange={setCompatPrime}
        globalValue={globalCompatSettings?.primeRenderOffload}
      />
      <TriStateCard
        id="compat-gamescope"
        title={t("gameEdit.compatibility.gamescopeTitle")}
        desc={t("gameEdit.compatibility.gamescopeDesc")}
        value={compatGamescope}
        onChange={setCompatGamescope}
        globalValue={globalCompatSettings?.enableGamescope}
      />

      {compatGamescope !== false && (
        <div className="edit-subsection">
          <h3 className="edit-subheading">{t("edit.gamescope.title")}</h3>

          <FieldGrid>
            <SettingCard
              title={t("gameEdit.compatibility.gamescopeWindowMode")}
              description={t("gameEdit.compatibility.gamescopeWindowModeDesc")}
              actions={
                <GlobalSettingHint
                  value={globalCompatSettings ? globalGamescopeModeLabel : undefined}
                />
              }
            >
              <select
                className="edit-input"
                value={compatGamescopeMode}
                onChange={(event) =>
                  setCompatGamescopeMode(
                    event.target.value as "fullscreen" | "borderless" | "windowed" | "",
                  )
                }
                aria-label={t("gameEdit.compatibility.gamescopeWindowMode")}
              >
                <option value="">{t("gameEdit.compatibility.globalDefault")}</option>
                <option value="fullscreen">{t("edit.gamescope.mode.fullscreen")}</option>
                <option value="borderless">{t("edit.gamescope.mode.borderless")}</option>
                <option value="windowed">{t("edit.gamescope.mode.windowed")}</option>
              </select>
            </SettingCard>

            <SettingCard
              title={t("gameEdit.compatibility.upscalingFilter")}
              description={t("gameEdit.compatibility.upscalingFilterDesc")}
              actions={
                <GlobalSettingHint
                  value={globalCompatSettings ? globalGamescopeFilterLabel : undefined}
                />
              }
            >
              <select
                className="edit-input"
                value={compatGamescopeFilter}
                onChange={(event) =>
                  setCompatGamescopeFilter(
                    event.target.value as
                      | "fsr"
                      | "nis"
                      | "linear"
                      | "nearest"
                      | "integer"
                      | "",
                  )
                }
                aria-label={t("gameEdit.compatibility.upscalingFilter")}
              >
                <option value="">{t("gameEdit.compatibility.globalDefault")}</option>
                <option value="auto">{t("edit.gamescope.filter.auto")}</option>
                <option value="fsr">{t("edit.gamescope.filter.fsr")}</option>
                <option value="nis">{t("edit.gamescope.filter.nis")}</option>
                <option value="linear">{t("edit.gamescope.filter.linear")}</option>
                <option value="nearest">{t("edit.gamescope.filter.nearest")}</option>
                <option value="integer">{t("edit.gamescope.filter.integer")}</option>
              </select>
            </SettingCard>
          </FieldGrid>

          <FieldGrid>
            <SettingCard
              title={t("gameEdit.compatibility.renderRes")}
              description={t("gameEdit.compatibility.renderResDesc")}
              actions={
                <GlobalSettingHint
                  value={globalCompatSettings ? globalGameResLabel : undefined}
                />
              }
            >
              <div className="edit-res-row">
                <input
                  type="number"
                  className="edit-input"
                  placeholder={t("edit.placeholder.width")}
                  value={compatGamescopeGameWidth ?? ""}
                  onChange={(event) =>
                    setCompatGamescopeGameWidth(
                      event.target.value ? Number(event.target.value) : undefined,
                    )
                  }
                  aria-label={t("edit.placeholder.width")}
                />
                <input
                  type="number"
                  className="edit-input"
                  placeholder={t("edit.placeholder.height")}
                  value={compatGamescopeGameHeight ?? ""}
                  onChange={(event) =>
                    setCompatGamescopeGameHeight(
                      event.target.value ? Number(event.target.value) : undefined,
                    )
                  }
                  aria-label={t("edit.placeholder.height")}
                />
              </div>
              <div className="edit-chip-row">
                {[
                  { label: "720p", w: 1280, h: 720 },
                  { label: "900p", w: 1600, h: 900 },
                  { label: "1080p", w: 1920, h: 1080 },
                  { label: "1440p", w: 2560, h: 1440 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="edit-chip edit-chip--button"
                    onClick={() => {
                      setCompatGamescopeGameWidth(preset.w);
                      setCompatGamescopeGameHeight(preset.h);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </SettingCard>

            <SettingCard
              title={t("gameEdit.compatibility.outputRes")}
              description={t("gameEdit.compatibility.outputResDesc")}
              actions={
                <GlobalSettingHint
                  value={globalCompatSettings ? globalOutputResLabel : undefined}
                />
              }
            >
              <div className="edit-res-row">
                <input
                  type="number"
                  className="edit-input"
                  placeholder={t("edit.placeholder.width")}
                  value={compatGamescopeWindowWidth ?? ""}
                  onChange={(event) =>
                    setCompatGamescopeWindowWidth(
                      event.target.value ? Number(event.target.value) : undefined,
                    )
                  }
                  aria-label={t("edit.placeholder.width")}
                />
                <input
                  type="number"
                  className="edit-input"
                  placeholder={t("edit.placeholder.height")}
                  value={compatGamescopeWindowHeight ?? ""}
                  onChange={(event) =>
                    setCompatGamescopeWindowHeight(
                      event.target.value ? Number(event.target.value) : undefined,
                    )
                  }
                  aria-label={t("edit.placeholder.height")}
                />
              </div>
              <div className="edit-chip-row">
                {[
                  { label: "1080p", w: 1920, h: 1080 },
                  { label: "1440p", w: 2560, h: 1440 },
                  { label: "4K", w: 3840, h: 2160 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="edit-chip edit-chip--button"
                    onClick={() => {
                      setCompatGamescopeWindowWidth(preset.w);
                      setCompatGamescopeWindowHeight(preset.h);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </SettingCard>
          </FieldGrid>

          <FieldGrid>
            <SettingCard
              title={t("gameEdit.compatibility.fsrSharpness")}
              description={t("gameEdit.compatibility.fsrSharpnessDesc")}
              actions={
                <GlobalSettingHint
                  value={globalCompatSettings ? globalFsrSharpnessLabel : undefined}
                />
              }
            >
              <div className="edit-range-row">
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={compatGamescopeFsrSharpness ?? 5}
                  onChange={(event) =>
                    setCompatGamescopeFsrSharpness(Number(event.target.value))
                  }
                  aria-label={t("gameEdit.compatibility.fsrSharpness")}
                />
                <span className="edit-range-value">
                  {compatGamescopeFsrSharpness ?? 5}
                </span>
              </div>
            </SettingCard>

            <SettingCard
              title={t("gameEdit.compatibility.fpsLimiter")}
              description={t("gameEdit.compatibility.fpsLimiterDesc")}
              actions={
                <GlobalSettingHint
                  value={globalCompatSettings ? globalFpsLimitLabel : undefined}
                />
              }
            >
              <div className="edit-inline-row">
                <input
                  type="number"
                  className="edit-input"
                  placeholder={t("edit.placeholder.fps")}
                  value={compatGamescopeFpsLimit ?? ""}
                  onChange={(event) =>
                    setCompatGamescopeFpsLimit(
                      event.target.value ? Number(event.target.value) : undefined,
                    )
                  }
                  aria-label={t("gameEdit.compatibility.fpsLimiter")}
                />
              </div>
              <div className="edit-chip-row">
                {[30, 60, 90, 120, 144, 165].map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    className={`edit-chip edit-chip--button${compatGamescopeFpsLimit === fps ? " is-active" : ""}`}
                    onClick={() => setCompatGamescopeFpsLimit(fps)}
                    aria-pressed={compatGamescopeFpsLimit === fps}
                  >
                    {fps}
                  </button>
                ))}
              </div>
            </SettingCard>
          </FieldGrid>

          <SettingCard
            title={t("gameEdit.compatibility.refreshRate")}
            description={t("gameEdit.compatibility.refreshRateDesc")}
            actions={
              <GlobalSettingHint
                value={globalCompatSettings ? globalRefreshRateLabel : undefined}
              />
            }
          >
            <div className="edit-inline-row">
              <input
                type="number"
                className="edit-input"
                placeholder={t("edit.placeholder.refreshRate")}
                value={compatGamescopeRefreshRate ?? ""}
                onChange={(event) =>
                  setCompatGamescopeRefreshRate(
                    event.target.value ? Number(event.target.value) : undefined,
                  )
                }
                aria-label={t("gameEdit.compatibility.refreshRate")}
              />
            </div>
            <div className="edit-chip-row">
              {[60, 120, 144, 165, 240].map((hz) => (
                <button
                  key={hz}
                  type="button"
                  className={`edit-chip edit-chip--button${compatGamescopeRefreshRate === hz ? " is-active" : ""}`}
                  onClick={() => setCompatGamescopeRefreshRate(hz)}
                  aria-pressed={compatGamescopeRefreshRate === hz}
                >
                  {hz}Hz
                </button>
              ))}
            </div>
          </SettingCard>

          <TriStateCard
            title={t("gameEdit.compatibility.vrrTitle")}
            desc={t("gameEdit.compatibility.vrrDesc")}
            value={compatGamescopeAdaptiveSync}
            onChange={setCompatGamescopeAdaptiveSync}
            globalValue={globalCompatSettings?.gamescopeAdaptiveSync}
          />
          <TriStateCard
            title={t("gameEdit.compatibility.hdrTitle")}
            desc={t("gameEdit.compatibility.hdrDesc")}
            value={compatGamescopeHdr}
            onChange={setCompatGamescopeHdr}
            globalValue={globalCompatSettings?.gamescopeHdr}
          />
          <TriStateCard
            title={t("gameEdit.compatibility.stretchTitle")}
            desc={t("gameEdit.compatibility.stretchDesc")}
            value={compatGamescopeStretch}
            onChange={setCompatGamescopeStretch}
            globalValue={globalCompatSettings?.gamescopeStretch}
          />
          <TriStateCard
            title={t("gameEdit.compatibility.forceFullscreenTitle")}
            desc={t("gameEdit.compatibility.forceFullscreenDesc")}
            value={compatGamescopeForceWindowsFullscreen}
            onChange={setCompatGamescopeForceWindowsFullscreen}
            globalValue={globalCompatSettings?.gamescopeForceWindowsFullscreen}
          />

          <SettingCard
            title={t("gameEdit.compatibility.gamescopeArgs")}
            description={t("gameEdit.compatibility.gamescopeArgsDesc")}
            actions={
              <GlobalSettingHint
                value={globalCompatSettings ? globalGamescopeArgsLabel : undefined}
              />
            }
          >
            <Field htmlFor="compat-gamescope-args">
              <input
                id="compat-gamescope-args"
                type="text"
                className="edit-input edit-input--mono"
                value={compatGamescopeArgs}
                onChange={(event) => setCompatGamescopeArgs(event.target.value)}
                placeholder="-w 1920 -h 1080 -F fsr -f"
              />
            </Field>
          </SettingCard>
        </div>
      )}
    </section>
  );
}
