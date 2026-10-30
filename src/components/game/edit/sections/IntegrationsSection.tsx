import { Boxes, Clock, FolderOpen } from "lucide-react";
import { Button } from "../../../ui";
import { SectionHeader, ToggleCard } from "../EditFields";
import { useEditGame } from "../EditGameContext";

function exeName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function IntegrationsSection() {
  const {
    t,
    game,
    mo2Instances,
    mo2InstanceError,
    mo2Resolving,
    browseMo2Instance,
    applyMo2InstancePath,
    activeMo2Instance,
    editMo2LaunchEnabled,
    setEditMo2LaunchEnabled,
    editMo2Profile,
    setEditMo2Profile,
    editMo2Executable,
    setEditMo2Executable,
    editMo2InstancePath,
    setEditMo2InstancePath,
    editUntracked,
    setEditUntracked,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  const showMo2 =
    mo2Instances.length > 0 ||
    Boolean(editMo2InstancePath) ||
    Boolean(game.mo2LaunchEnabled) ||
    editMo2LaunchEnabled;

  // Profiles and executables come from the instance the draft points at. A
  // value saved earlier stays selectable even when the instance no longer
  // lists it, so opening the modal never silently changes the launch target.
  const profileNames = activeMo2Instance?.profiles ?? [];
  const profileOptions =
    editMo2Profile && !profileNames.includes(editMo2Profile)
      ? [editMo2Profile, ...profileNames]
      : profileNames;

  const executableTitles = (activeMo2Instance?.customExecutables ?? []).map(
    (exe) => exe.title,
  );
  const executableOptions =
    editMo2Executable && !executableTitles.includes(editMo2Executable)
      ? [editMo2Executable, ...executableTitles]
      : executableTitles;
  const executableValue =
    editMo2Executable ||
    (executableOptions.length > 0 ? executableOptions[0] : game.path || "Default");
  const instanceValue = activeMo2Instance
    ? activeMo2Instance.instancePath
    : editMo2InstancePath;

  const commitInstancePath = (path: string) => {
    void applyMo2InstancePath(path);
  };

  return (
    <section className="edit-section" aria-labelledby="edit-section-integrations">
      <SectionHeader
        id="edit-section-integrations"
        title={t("edit.section.integrations")}
        description={t("edit.section.integrationsDesc")}
        changed={dirtyBySection.integrations}
        onReset={() => resetSection("integrations")}
      />

      {showMo2 && (
        <ToggleCard
          id="edit-mo2-launch"
          icon={<Boxes size={17} aria-hidden="true" />}
          title={t("edit.mo2LaunchTitle")}
          description={t("edit.mo2LaunchHint")}
          checked={editMo2LaunchEnabled}
          onChange={setEditMo2LaunchEnabled}
          badge={
            <span className={`edit-badge${editMo2LaunchEnabled ? " is-on" : ""}`}>
              {editMo2LaunchEnabled ? t("edit.badgeMo2Active") : t("edit.badgeMo2Disabled")}
            </span>
          }
        >
          {editMo2LaunchEnabled && (
            <>
              <div className="edit-mini-field">
                <label htmlFor="edit-mo2-instance-path">{t("edit.mo2Instance")}</label>
                {(mo2Instances.length >= 1 || Boolean(editMo2InstancePath)) && (
                  <div className="edit-inline-row">
                    <select
                      className="edit-input"
                      value={instanceValue}
                      aria-label={t("edit.mo2Instance")}
                      onChange={(event) => commitInstancePath(event.target.value)}
                    >
                      {editMo2InstancePath && !activeMo2Instance && (
                        <option value={editMo2InstancePath}>{editMo2InstancePath}</option>
                      )}
                      {mo2Instances.map((instance) => (
                        <option key={instance.id} value={instance.instancePath}>
                          {instance.name} ({instance.isPortable ? t("edit.mo2Portable") : t("edit.mo2Global")})
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={browseMo2Instance}
                      disabled={mo2Resolving}
                      leftIcon={<FolderOpen size={14} />}
                    >
                      {t("edit.mo2BrowseInstance")}
                    </Button>
                  </div>
                )}
                <input
                  id="edit-mo2-instance-path"
                  className="edit-input edit-input--mono"
                  type="text"
                  value={editMo2InstancePath}
                  aria-invalid={mo2InstanceError ? true : undefined}
                  onChange={(event) => setEditMo2InstancePath(event.target.value)}
                  onBlur={(event) => commitInstancePath(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    commitInstancePath(event.currentTarget.value);
                  }}
                />
                {mo2InstanceError && (
                  <span className="edit-field-hint edit-field-error" role="alert">
                    {mo2InstanceError}
                  </span>
                )}
              </div>

              <div className="edit-mo2-grid">
                <label className="edit-mini-field">
                  <span>{t("edit.mo2Profile")}</span>
                  <select
                    className="edit-input"
                    value={editMo2Profile}
                    disabled={profileOptions.length === 0}
                    onChange={(event) => setEditMo2Profile(event.target.value)}
                  >
                    {profileOptions.length === 0 ? (
                      <option value="" disabled>
                        {t("edit.notSet")}
                      </option>
                    ) : (
                      profileOptions.map((profile) => (
                        <option key={profile} value={profile}>
                          {profile}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="edit-mini-field">
                  <span>{t("edit.mo2Executable")}</span>
                  <select
                    className="edit-input"
                    value={executableValue}
                    onChange={(event) => setEditMo2Executable(event.target.value)}
                  >
                    {executableOptions.length > 0 ? (
                      executableOptions.map((title) => (
                        <option key={title} value={title}>
                          {title}
                        </option>
                      ))
                    ) : (
                      <option value={game.path || "Default"}>
                        {game.path ? exeName(game.path) : t("edit.mo2DefaultExecutable")}
                      </option>
                    )}
                  </select>
                </label>
              </div>
            </>
          )}
        </ToggleCard>
      )}

      <ToggleCard
        id="edit-untracked"
        icon={<Clock size={17} aria-hidden="true" />}
        title={t("edit.doNotTrack")}
        description={t("edit.doNotTrackHint")}
        checked={editUntracked}
        onChange={setEditUntracked}
        badge={
          <span className={`edit-badge${editUntracked ? " is-on" : ""}`}>
            {editUntracked ? t("edit.badgeUntracked") : t("edit.badgeTracked")}
          </span>
        }
      />
    </section>
  );
}
