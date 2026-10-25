import { FolderOpen, Settings2 } from "lucide-react";
import { Button } from "../../../ui";
import { Field, FieldGrid, SectionHeader, SettingCard } from "../EditFields";
import { GlobalSettingHint, TriStateCard } from "../CompatibilityShared";
import { useEditGame } from "../EditGameContext";

export function RunnerSection() {
  const {
    t,
    globalCompatSettings,
    availableRunners,
    availablePrefixes,
    runnerSelectValue,
    compatCustomRunner,
    setCompatCustomRunner,
    setCompatRunnerType,
    handlePickRunner,
    compatPrefixOverride,
    defaultPrefixPath,
    defaultPrefixDisplay,
    hasUnknownPrefix,
    setCompatPrefix,
    handlePickPrefix,
    compatArch,
    setCompatArch,
    compatWorkingDir,
    setCompatWorkingDir,
    handlePickWorkingDir,
    compatWayland,
    setCompatWayland,
    compatWow64,
    setCompatWow64,
    compatLargeAddress,
    setCompatLargeAddress,
    compatAudioDriver,
    setCompatAudioDriver,
    compatWineDebug,
    setCompatWineDebug,
    globalRunnerLabel,
    globalAudioDriverLabel,
    globalWineDebugLabel,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-runner">
      <SectionHeader
        id="edit-section-runner"
        title={t("edit.section.runner")}
        description={t("edit.section.runnerDesc")}
        changed={dirtyBySection.runner}
        onReset={() => resetSection("runner")}
      />

      <SettingCard
        id="compat-runner"
        icon={<Settings2 size={17} aria-hidden="true" />}
        title={t("gameEdit.compatibility.runnerSelection")}
        description={t("gameEdit.compatibility.runnerSelectionDesc")}
        actions={<GlobalSettingHint value={globalCompatSettings ? globalRunnerLabel : undefined} />}
      >
        <Field>
          <select
            className="edit-input"
            value={runnerSelectValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "default") {
                setCompatRunnerType("default");
                setCompatCustomRunner("");
              } else if (value === "custom") {
                setCompatRunnerType("custom");
              } else {
                setCompatRunnerType("custom");
                setCompatCustomRunner(value);
              }
            }}
            aria-label={t("gameEdit.compatibility.runnerSelection")}
          >
            <option value="default">
              {t("gameEdit.compatibility.runnerGlobal")}
            </option>
            {availableRunners.map((runner) => (
              <option key={runner.id} value={runner.path}>
                {runner.name} ({runner.kind})
              </option>
            ))}
            <option value="custom">{t("gameEdit.compatibility.runnerCustom")}</option>
          </select>
        </Field>

        {runnerSelectValue !== "default" && (
          <div className="edit-inline-row">
            <input
              type="text"
              className="edit-input edit-input--mono"
              value={compatCustomRunner}
              onChange={(event) => setCompatCustomRunner(event.target.value)}
              placeholder={t("edit.placeholder.runnerPath")}
              aria-label={t("gameEdit.compatibility.runnerCustom")}
            />
            <Button variant="secondary" size="sm" onClick={handlePickRunner}>
              {t("edit.browse")}
            </Button>
          </div>
        )}
      </SettingCard>

      <SettingCard
        id="compat-prefix"
        icon={<FolderOpen size={17} aria-hidden="true" />}
        title={t("gameEdit.compatibility.winePrefix")}
        description={t("gameEdit.compatibility.winePrefixDesc")}
      >
        <div className="edit-inline-row">
          <select
            className="edit-input"
            value={compatPrefixOverride}
            onChange={(event) => setCompatPrefix(event.target.value)}
            aria-label={t("gameEdit.compatibility.winePrefix")}
          >
            <option value="">
              {defaultPrefixPath
                ? t("gameEdit.compatibility.prefixGlobal", { path: defaultPrefixDisplay })
                : t("gameEdit.compatibility.prefixIsolated")}
            </option>
            {hasUnknownPrefix && (
              <option value={compatPrefixOverride}>
                {t("gameEdit.compatibility.prefixCustom", { path: compatPrefixOverride })}
              </option>
            )}
            {availablePrefixes.map((prefix) => (
              <option key={prefix.path} value={prefix.path}>
                {prefix.name} ({prefix.path})
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={handlePickPrefix}>
            {t("edit.browse")}
          </Button>
        </div>
      </SettingCard>

      <FieldGrid>
        <SettingCard
          title={t("gameEdit.compatibility.architecture")}
          description={t("gameEdit.compatibility.architectureDesc")}
        >
          <select
            className="edit-input"
            value={compatArch}
            onChange={(event) =>
              setCompatArch(event.target.value as "win64" | "win32")
            }
            aria-label={t("gameEdit.compatibility.architecture")}
          >
            <option value="win64">{t("edit.arch.win64")}</option>
            <option value="win32">{t("edit.arch.win32")}</option>
          </select>
        </SettingCard>

        <SettingCard
          id="compat-working-dir"
          title={t("gameEdit.compatibility.workingDir")}
          description={t("gameEdit.compatibility.workingDirDesc")}
        >
          <div className="edit-inline-row">
            <input
              type="text"
              className="edit-input edit-input--mono"
              value={compatWorkingDir}
              onChange={(event) => setCompatWorkingDir(event.target.value)}
              placeholder={t("edit.placeholder.workingDir")}
              aria-label={t("gameEdit.compatibility.workingDir")}
            />
            <Button variant="secondary" size="sm" onClick={handlePickWorkingDir}>
              {t("edit.browse")}
            </Button>
          </div>
        </SettingCard>
      </FieldGrid>

      <TriStateCard
        title={t("gameEdit.compatibility.waylandTitle")}
        desc={t("gameEdit.compatibility.waylandDesc")}
        value={compatWayland}
        onChange={setCompatWayland}
        globalValue={globalCompatSettings?.enableWayland}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.wow64Title")}
        desc={t("gameEdit.compatibility.wow64Desc")}
        value={compatWow64}
        onChange={setCompatWow64}
        globalValue={globalCompatSettings?.enableWow64}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.largeAddressTitle")}
        desc={t("gameEdit.compatibility.largeAddressDesc")}
        value={compatLargeAddress}
        onChange={setCompatLargeAddress}
        globalValue={globalCompatSettings?.enableLargeAddressAware}
      />

      <FieldGrid>
        <SettingCard
          title={t("gameEdit.compatibility.audioDriver")}
          description={t("gameEdit.compatibility.audioDriverDesc")}
          actions={
            <GlobalSettingHint
              value={globalCompatSettings ? globalAudioDriverLabel : undefined}
            />
          }
        >
          <select
            className="edit-input"
            value={compatAudioDriver}
            onChange={(event) => setCompatAudioDriver(event.target.value)}
            aria-label={t("gameEdit.compatibility.audioDriver")}
          >
            <option value="">{t("gameEdit.compatibility.audioDriverGlobal")}</option>
            <option value="auto">{t("edit.audio.auto")}</option>
            <option value="pulse">PulseAudio</option>
            <option value="alsa">ALSA</option>
            <option value="oss">OSS</option>
          </select>
        </SettingCard>

        <SettingCard
          title={t("gameEdit.compatibility.wineDebug")}
          description={t("gameEdit.compatibility.wineDebugDesc")}
          actions={
            <GlobalSettingHint
              value={globalCompatSettings ? globalWineDebugLabel : undefined}
            />
          }
        >
          <input
            type="text"
            className="edit-input edit-input--mono"
            value={compatWineDebug}
            onChange={(event) => setCompatWineDebug(event.target.value)}
            placeholder={t("edit.placeholder.wineDebug")}
            aria-label={t("gameEdit.compatibility.wineDebug")}
          />
        </SettingCard>
      </FieldGrid>
    </section>
  );
}
