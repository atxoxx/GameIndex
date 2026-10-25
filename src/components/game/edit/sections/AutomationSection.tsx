import { MonitorCog, Plus, Trash2, Workflow } from "lucide-react";
import { Button } from "../../../ui";
import { EmptyState, SectionHeader, SettingCard } from "../EditFields";
import { LaunchScriptCard } from "../LaunchScriptCard";
import { useEditGame } from "../EditGameContext";

export function AutomationSection() {
  const {
    t,
    isWindowsHost,
    editPreLaunchScript,
    setEditPreLaunchScript,
    editPreLaunchAdmin,
    setEditPreLaunchAdmin,
    editPostExitScript,
    setEditPostExitScript,
    editPostExitAdmin,
    setEditPostExitAdmin,
    handlePickScript,
    editCompanionApps,
    addCompanionApp,
    updateCompanionApp,
    removeCompanionApp,
    handlePickCompanion,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-automation">
      <SectionHeader
        id="edit-section-automation"
        title={t("edit.section.automation")}
        description={t("edit.section.automationDesc")}
        changed={dirtyBySection.automation}
        onReset={() => resetSection("automation")}
      />

      <SettingCard
        icon={<Workflow size={17} aria-hidden="true" />}
        title={t("edit.tab.scripts")}
        description={t("edit.scriptsDesc")}
      >
        <div className="edit-script-grid">
          <LaunchScriptCard
            type="pre"
            label={t("edit.preLaunchScript")}
            tag={t("edit.scriptTag.blocking")}
            hint={t("edit.preLaunchScriptHint")}
            value={editPreLaunchScript}
            admin={editPreLaunchAdmin}
            onPick={() =>
              handlePickScript(setEditPreLaunchScript, t("edit.pickPreLaunchScript"))
            }
            onChange={setEditPreLaunchScript}
            onAdminChange={setEditPreLaunchAdmin}
          />
          <LaunchScriptCard
            type="post"
            label={t("edit.postExitScript")}
            tag={t("edit.scriptTag.cleanup")}
            hint={t("edit.postExitScriptHint")}
            value={editPostExitScript}
            admin={editPostExitAdmin}
            onPick={() =>
              handlePickScript(setEditPostExitScript, t("edit.pickPostExitScript"))
            }
            onChange={setEditPostExitScript}
            onAdminChange={setEditPostExitAdmin}
          />
        </div>
      </SettingCard>

      <SettingCard
        id="edit-companion-apps"
        icon={<MonitorCog size={17} aria-hidden="true" />}
        title={t("edit.tab.companionApps")}
        description={t("edit.companionAppsDesc")}
        meta={
          editCompanionApps.length > 0 ? (
            <span className="edit-count-badge">{editCompanionApps.length}</span>
          ) : undefined
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={addCompanionApp}
            leftIcon={<Plus size={14} />}
          >
            {t("edit.addCompanionApp")}
          </Button>
        }
      >
        {editCompanionApps.length === 0 ? (
          <EmptyState
            icon={<MonitorCog size={26} aria-hidden="true" />}
            text={t("edit.noCompanionApps")}
          />
        ) : (
          <div className="edit-list">
            {editCompanionApps.map((app, index) => (
              <div key={index} className="edit-list-item">
                <div className="edit-list-item-head">
                  <span className="edit-list-index">
                    {t("edit.companionAppIndex", { count: index + 1 })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={() => removeCompanionApp(index)}
                    aria-label={t("edit.removeCompanionApp")}
                    title={t("edit.removeCompanionApp")}
                    leftIcon={<Trash2 size={14} />}
                  />
                </div>
                <div className="edit-inline-row">
                  <input
                    className="edit-input edit-input--mono"
                    type="text"
                    value={app.path}
                    onChange={(event) =>
                      updateCompanionApp(index, { path: event.target.value })
                    }
                    placeholder={t("edit.placeholder.companionPath")}
                    aria-label={t("edit.placeholder.companionPath")}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePickCompanion(index)}
                  >
                    {t("edit.browse")}
                  </Button>
                </div>
                <div className="edit-list-grid edit-list-grid--companion">
                  <label className="edit-mini-field">
                    <span>{t("edit.companionArguments")}</span>
                    <input
                      className="edit-input"
                      type="text"
                      value={app.arguments || ""}
                      onChange={(event) =>
                        updateCompanionApp(index, { arguments: event.target.value })
                      }
                      placeholder={t("edit.placeholder.companionArguments")}
                    />
                  </label>
                  <label className="edit-mini-field">
                    <span>{t("edit.companionDelay")}</span>
                    <span className="edit-input-suffix">
                      <input
                        className="edit-input"
                        type="number"
                        min={0}
                        step={500}
                        value={app.delayMs || 0}
                        onChange={(event) =>
                          updateCompanionApp(index, {
                            delayMs: Math.max(0, Number(event.target.value)),
                          })
                        }
                        aria-label={t("edit.companionDelayAria")}
                      />
                      <span className="edit-input-suffix-text">ms</span>
                    </span>
                  </label>
                  {isWindowsHost && (
                    <label className="edit-checkbox-row">
                      <input
                        type="checkbox"
                        checked={app.runAsAdmin || false}
                        onChange={(event) =>
                          updateCompanionApp(index, { runAsAdmin: event.target.checked })
                        }
                      />
                      <span>{t("edit.companionAdmin")}</span>
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingCard>
    </section>
  );
}
