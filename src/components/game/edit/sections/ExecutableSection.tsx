import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../ui";
import {
  EmptyState,
  Field,
  SectionHeader,
  SettingCard,
} from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function ExecutableSection() {
  const {
    t,
    isWindowsHost,
    editPath,
    setEditPath,
    handlePickExecutable,
    editExtraExecutables,
    updateExtraExe,
    removeExtraExe,
    handlePickExtraExe,
    addExtraExe,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-executable">
      <SectionHeader
        id="edit-section-executable"
        title={t("edit.section.executable")}
        description={t("edit.section.executableDesc")}
        changed={dirtyBySection.executable}
        onReset={() => resetSection("executable")}
      />

      <SettingCard
        icon={<FolderOpen size={17} aria-hidden="true" />}
        title={t("edit.label.executablePath")}
        description={t("edit.executableDesc")}
      >
        <Field htmlFor="edit-path">
          <div className="edit-inline-row">
            <div className="edit-input-with-clear">
              <input
                id="edit-path"
                className="edit-input edit-input--mono"
                type="text"
                value={editPath}
                onChange={(event) => setEditPath(event.target.value)}
                placeholder={t("edit.placeholder.executable")}
              />
              {editPath && (
                <button
                  type="button"
                  className="edit-input-clear"
                  onClick={() => setEditPath("")}
                  title={t("edit.clearExecutable")}
                  aria-label={t("edit.clearExecutable")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePickExecutable}
              leftIcon={<FolderOpen size={14} />}
            >
              {t("edit.browse")}
            </Button>
          </div>
        </Field>
      </SettingCard>

      <SettingCard
        id="edit-extra-executables"
        icon={<Plus size={17} aria-hidden="true" />}
        title={t("edit.execExtrasTitle")}
        description={t("edit.execExtrasDesc")}
        meta={
          editExtraExecutables.length > 0 ? (
            <span className="edit-count-badge">{editExtraExecutables.length}</span>
          ) : undefined
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={addExtraExe}
            leftIcon={<Plus size={14} />}
          >
            {t("game.execExtras.add")}
          </Button>
        }
      >
        {editExtraExecutables.length === 0 ? (
          <EmptyState text={t("game.execExtras.empty")} />
        ) : (
          <div className="edit-list">
            {editExtraExecutables.map((exe, index) => (
              <div key={index} className="edit-list-item">
                <div className="edit-list-item-head">
                  <span className="edit-list-index">
                    {t("edit.extraExecutableIndex", { count: index + 1 })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={() => removeExtraExe(index)}
                    aria-label={t("game.execExtras.remove")}
                    title={t("game.execExtras.remove")}
                    leftIcon={<Trash2 size={14} />}
                  />
                </div>
                <div className="edit-inline-row">
                  <input
                    className="edit-input edit-input--mono"
                    type="text"
                    value={exe.path}
                    onChange={(event) =>
                      updateExtraExe(index, { path: event.target.value })
                    }
                    placeholder={t("edit.placeholder.extraExecutable")}
                    aria-label={t("edit.placeholder.extraExecutable")}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePickExtraExe(index)}
                  >
                    {t("edit.browse")}
                  </Button>
                </div>
                <div className="edit-list-grid">
                  <input
                    className="edit-input"
                    type="text"
                    value={exe.label || ""}
                    onChange={(event) =>
                      updateExtraExe(index, { label: event.target.value })
                    }
                    placeholder={t("game.execExtras.labelPlaceholder")}
                    aria-label={t("game.execExtras.labelPlaceholder")}
                  />
                  <input
                    className="edit-input"
                    type="text"
                    value={exe.arguments || ""}
                    onChange={(event) =>
                      updateExtraExe(index, { arguments: event.target.value })
                    }
                    placeholder={t("game.execExtras.argsPlaceholder")}
                    aria-label={t("game.execExtras.argsPlaceholder")}
                  />
                  {isWindowsHost && (
                    <label className="edit-checkbox-row">
                      <input
                        type="checkbox"
                        checked={exe.runAsAdmin || false}
                        onChange={(event) =>
                          updateExtraExe(index, { runAsAdmin: event.target.checked })
                        }
                      />
                      <span>{t("game.execExtras.runAsAdmin")}</span>
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
