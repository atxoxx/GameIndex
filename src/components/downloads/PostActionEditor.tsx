import { Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import type { PostAction, PostActionKind } from "../../types/download";

interface PostActionEditorProps {
  actions: PostAction[];
  onChange: (next: PostAction[]) => void;
}

/**
 * Compact editor for a list of post-download actions. Shared by the global
 * Settings → Downloads section and the per-download override in the add
 * modal. Order is execution order; each action can fire on success, on
 * failure, or both.
 */
export default function PostActionEditor({ actions, onChange }: PostActionEditorProps) {
  const { t } = useLanguage();

  const addAction = (kind: PostActionKind) => {
    onChange([
      ...actions,
      {
        id: `pa_${Math.random().toString(36).slice(2, 10)}`,
        kind,
        onSuccess: true,
        onFailure: false,
        path: null,
      },
    ]);
  };

  const updateAction = (id: string, partial: Partial<PostAction>) => {
    onChange(actions.map((a) => (a.id === id ? { ...a, ...partial } : a)));
  };

  const removeAction = (id: string) => {
    onChange(actions.filter((a) => a.id !== id));
  };

  return (
    <>
      {actions.length === 0 && (
        <p className="settings-helper-text">{t("settings.downloads.postActionsNone")}</p>
      )}
      {actions.map((action) => (
        <div className="settings-limit-row settings-limit-row--post-action" key={action.id}>
          <span className="settings-post-action-kind">
            {action.kind === "openFolder"
              ? t("settings.downloads.postAction.openFolder")
              : t("settings.downloads.postAction.launchInstaller")}
          </span>
          <label className="settings-checkbox-label settings-checkbox-label--inline">
            <input
              type="checkbox"
              checked={action.onSuccess}
              onChange={(e) => updateAction(action.id, { onSuccess: e.target.checked })}
            />
            <span>{t("settings.downloads.postAction.onSuccess")}</span>
          </label>
          <label className="settings-checkbox-label settings-checkbox-label--inline">
            <input
              type="checkbox"
              checked={action.onFailure}
              onChange={(e) => updateAction(action.id, { onFailure: e.target.checked })}
            />
            <span>{t("settings.downloads.postAction.onFailure")}</span>
          </label>
          <input
            type="text"
            className="settings-input"
            value={action.path ?? ""}
            onChange={(e) => updateAction(action.id, { path: e.target.value || null })}
            placeholder={t("settings.downloads.postAction.pathPlaceholder")}
          />
          <Button variant="ghost" size="sm" onClick={() => removeAction(action.id)}>
            {t("common.remove")}
          </Button>
        </div>
      ))}
      <div className="settings-debrid-row">
        <Button variant="secondary" size="sm" onClick={() => addAction("openFolder")}>
          {t("settings.downloads.postAction.addOpenFolder")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => addAction("launchInstaller")}>
          {t("settings.downloads.postAction.addLaunchInstaller")}
        </Button>
      </div>
    </>
  );
}
