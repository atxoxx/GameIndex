import { Boxes, Clock } from "lucide-react";
import { SectionHeader, ToggleCard } from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function IntegrationsSection() {
  const {
    t,
    game,
    mo2Instances,
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
            <div className="edit-mo2-grid">
              {mo2Instances.length > 1 && (
                <label className="edit-mini-field">
                  <span>{t("edit.mo2Instance")}</span>
                  <select
                    className="edit-input"
                    value={editMo2InstancePath}
                    onChange={(event) => {
                      const nextPath = event.target.value;
                      setEditMo2InstancePath(nextPath);
                      const instance = mo2Instances.find(
                        (item) => item.instancePath === nextPath,
                      );
                      if (instance) {
                        setEditMo2Profile(
                          instance.selectedProfile || instance.profiles[0] || "Default",
                        );
                        if (instance.customExecutables?.length) {
                          setEditMo2Executable(instance.customExecutables[0].title);
                        }
                      }
                    }}
                  >
                    {mo2Instances.map((instance) => (
                      <option key={instance.id} value={instance.instancePath}>
                        {instance.name} ({instance.isPortable ? t("edit.mo2Portable") : t("edit.mo2Global")})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="edit-mini-field">
                <span>{t("edit.mo2Profile")}</span>
                <select
                  className="edit-input"
                  value={editMo2Profile}
                  onChange={(event) => setEditMo2Profile(event.target.value)}
                >
                  {(activeMo2Instance?.profiles || [editMo2Profile || "Default"]).map(
                    (profile) => (
                      <option key={profile} value={profile}>
                        {profile}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label className="edit-mini-field">
                <span>{t("edit.mo2Executable")}</span>
                <select
                  className="edit-input"
                  value={editMo2Executable}
                  onChange={(event) => setEditMo2Executable(event.target.value)}
                >
                  {activeMo2Instance?.customExecutables?.length ? (
                    activeMo2Instance.customExecutables.map((exe) => (
                      <option key={exe.title} value={exe.title}>
                        {exe.title}
                      </option>
                    ))
                  ) : (
                    <option value={game.path || "Default"}>
                      {game.path ? game.path.split(/[\\/]/).pop() : t("edit.mo2DefaultExecutable")}
                    </option>
                  )}
                </select>
              </label>
            </div>
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
