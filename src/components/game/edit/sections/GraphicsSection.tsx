import { Field, SectionHeader, SettingCard } from "../EditFields";
import { GlobalSettingHint, TriStateCard } from "../CompatibilityShared";
import { useEditGame } from "../EditGameContext";

export function GraphicsSection() {
  const {
    t,
    globalCompatSettings,
    compatDxvk,
    setCompatDxvk,
    compatVkd3d,
    setCompatVkd3d,
    compatVkd3dDescriptorHeap,
    setCompatVkd3dDescriptorHeap,
    compatDxvkAsync,
    setCompatDxvkAsync,
    compatNtsync,
    setCompatNtsync,
    compatEsync,
    setCompatEsync,
    compatFsync,
    setCompatFsync,
    compatNvapi,
    setCompatNvapi,
    compatUseSpecificGpu,
    setCompatUseSpecificGpu,
    compatDxvkHud,
    setCompatDxvkHud,
    compatVirtualDesktop,
    setCompatVirtualDesktop,
    compatVirtualDesktopRes,
    setCompatVirtualDesktopRes,
    globalVirtualDesktopResLabel,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-graphics">
      <SectionHeader
        id="edit-section-graphics"
        title={t("edit.section.graphics")}
        description={t("edit.section.graphicsDesc")}
        changed={dirtyBySection.graphics}
        onReset={() => resetSection("graphics")}
      />

      <TriStateCard
        id="compat-dxvk"
        title={t("gameEdit.compatibility.dxvkTitle")}
        desc={t("gameEdit.compatibility.dxvkDesc")}
        value={compatDxvk}
        onChange={setCompatDxvk}
        globalValue={globalCompatSettings?.enableDxvk}
      />
      <TriStateCard
        id="compat-vkd3d"
        title={t("gameEdit.compatibility.vkd3dTitle")}
        desc={t("gameEdit.compatibility.vkd3dDesc")}
        value={compatVkd3d}
        onChange={setCompatVkd3d}
        globalValue={globalCompatSettings?.enableVkd3d}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.vkd3dDescriptorHeapTitle")}
        desc={t("gameEdit.compatibility.vkd3dDescriptorHeapDesc")}
        value={compatVkd3dDescriptorHeap}
        onChange={setCompatVkd3dDescriptorHeap}
        globalValue={globalCompatSettings?.enableVkd3dDescriptorHeap}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.dxvkAsyncTitle")}
        desc={t("gameEdit.compatibility.dxvkAsyncDesc")}
        value={compatDxvkAsync}
        onChange={setCompatDxvkAsync}
        globalValue={globalCompatSettings?.enableDxvkAsync}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.ntsyncTitle")}
        desc={t("gameEdit.compatibility.ntsyncDesc")}
        value={compatNtsync}
        onChange={setCompatNtsync}
        globalValue={globalCompatSettings?.enableNtsync}
      />
      <TriStateCard
        id="compat-esync"
        title={t("gameEdit.compatibility.esyncTitle")}
        desc={t("gameEdit.compatibility.esyncDesc")}
        value={compatEsync}
        onChange={setCompatEsync}
        globalValue={globalCompatSettings?.enableEsync}
      />
      <TriStateCard
        id="compat-fsync"
        title={t("gameEdit.compatibility.fsyncTitle")}
        desc={t("gameEdit.compatibility.fsyncDesc")}
        value={compatFsync}
        onChange={setCompatFsync}
        globalValue={globalCompatSettings?.enableFsync}
      />
      <TriStateCard
        title={t("gameEdit.compatibility.nvapiTitle")}
        desc={t("gameEdit.compatibility.nvapiDesc")}
        value={compatNvapi}
        onChange={setCompatNvapi}
        globalValue={globalCompatSettings?.enableDxvkNvapi}
      />
      <TriStateCard
        id="compat-specific-gpu"
        title={t("gameEdit.compatibility.specificGpuTitle")}
        desc={t("gameEdit.compatibility.specificGpuDesc")}
        value={compatUseSpecificGpu}
        onChange={setCompatUseSpecificGpu}
        globalValue={globalCompatSettings?.useSpecificGpu}
      />

      <SettingCard
        id="compat-dxvk-hud"
        title={t("gameEdit.compatibility.dxvkHud")}
        description={t("gameEdit.compatibility.dxvkHudDesc")}
      >
        <Field htmlFor="compat-dxvk-hud-input">
          <div className="edit-inline-row">
            <input
              id="compat-dxvk-hud-input"
              type="text"
              className="edit-input edit-input--mono"
              value={compatDxvkHud}
              onChange={(event) => setCompatDxvkHud(event.target.value)}
              placeholder={t("edit.placeholder.dxvkHud")}
            />
          </div>
        </Field>
        <div className="edit-chip-row">
          {["fps", "devinfo", "fps,devinfo", "full"].map((preset) => (
            <button
              key={preset}
              type="button"
              className={`edit-chip edit-chip--button${compatDxvkHud === preset ? " is-active" : ""}`}
              onClick={() => setCompatDxvkHud(preset)}
              aria-pressed={compatDxvkHud === preset}
            >
              {preset}
            </button>
          ))}
        </div>
      </SettingCard>

      <TriStateCard
        title={t("gameEdit.compatibility.virtualDesktopTitle")}
        desc={t("gameEdit.compatibility.virtualDesktopDesc")}
        value={compatVirtualDesktop}
        onChange={setCompatVirtualDesktop}
        globalValue={globalCompatSettings?.virtualDesktop}
      />

      {compatVirtualDesktop === true && (
        <SettingCard
          title={t("gameEdit.compatibility.virtualDesktopRes")}
          description={t("gameEdit.compatibility.virtualDesktopResDesc")}
          actions={
            <GlobalSettingHint
              value={globalCompatSettings ? globalVirtualDesktopResLabel : undefined}
            />
          }
        >
          <Field htmlFor="compat-virtual-desktop-res">
            <input
              id="compat-virtual-desktop-res"
              type="text"
              className="edit-input edit-input--mono"
              value={compatVirtualDesktopRes}
              onChange={(event) => setCompatVirtualDesktopRes(event.target.value)}
              placeholder="1920x1080"
            />
          </Field>
          <div className="edit-chip-row">
            {["1280x720", "1920x1080", "2560x1440", "3840x2160"].map((resolution) => (
              <button
                key={resolution}
                type="button"
                className={`edit-chip edit-chip--button${compatVirtualDesktopRes === resolution ? " is-active" : ""}`}
                onClick={() => setCompatVirtualDesktopRes(resolution)}
                aria-pressed={compatVirtualDesktopRes === resolution}
              >
                {resolution}
              </button>
            ))}
          </div>
        </SettingCard>
      )}
    </section>
  );
}
