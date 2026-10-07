import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { ModSourceInfo } from "../../types/mods";

/**
 * Sources whose access is a user-managed API key. Steam Workshop is
 * excluded: it authenticates through the connected Steam account, so it is
 * surfaced as a note instead of a key field.
 */
function usesApiKey(source: ModSourceInfo): boolean {
  return source.requiresCredential && source.id !== "workshop";
}

/**
 * ModSitesSettings — API-key management for every mod site, hosted in
 * Settings → Connections. Keys are validated implicitly on first use and
 * stored in the OS keychain by the Rust backend.
 */
export default function ModSitesSettings() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [sources, setSources] = useState<ModSourceInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      invoke<ModSourceInfo[]>("mods_source_status")
        .then(setSources)
        .catch(() => setSources([]))
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = async (id: string, key: string) => {
    setSaving(id);
    try {
      await invoke("mods_source_set_credential", { source: id, key });
      setDrafts((d) => ({ ...d, [id]: "" }));
      await refresh();
      showToast(
        key.trim() ? t("mods.source.keySaved") : t("mods.source.keyCleared"),
        "success",
      );
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <p className="settings-helper-text">{t("common.loading")}</p>;
  }

  const keySources = sources.filter(usesApiKey);
  const workshop = sources.find((s) => s.id === "workshop");

  return (
    <div className="mod-sites-settings">
      {keySources.map((source) => {
        const draft = drafts[source.id] ?? "";
        const isSaving = saving === source.id;
        return (
          <div className="mod-sites-settings__row" key={source.id}>
            <div className="settings-label-row">
              <span className="settings-label">{source.name}</span>
              <span className="mod-sites-settings__meta">
                <a
                  href={source.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-link"
                >
                  {source.homepage.replace(/^https?:\/\//, "")}
                </a>
                <span
                  className={`settings-source-badge${
                    source.hasCredential ? " is-ready" : " is-missing"
                  }`}
                >
                  {t(
                    source.hasCredential
                      ? "mods.source.keySavedBadge"
                      : "mods.source.statusNeedsKey",
                  )}
                </span>
              </span>
            </div>
            <div className="settings-input-group">
              <input
                type="password"
                className="settings-input"
                value={draft}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [source.id]: e.target.value }))
                }
                autoComplete="off"
                placeholder={
                  source.hasCredential
                    ? "••••••••••••••••"
                    : t("mods.source.apiKeyPlaceholder")
                }
                aria-label={`${source.name} ${t("mods.source.apiKey")}`}
                disabled={isSaving}
              />
              <Button
                variant="primary"
                size="sm"
                isLoading={isSaving}
                aria-label={`${t("mods.source.save")} ${source.name}`}
                onClick={() => void handleSave(source.id, draft)}
              >
                {t("mods.source.save")}
              </Button>
              {source.hasCredential && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isSaving}
                  aria-label={`${t("mods.source.clear")} ${source.name}`}
                  onClick={() => void handleSave(source.id, "")}
                >
                  {t("mods.source.clear")}
                </Button>
              )}
            </div>
          </div>
        );
      })}

      {workshop && (
        <div className="mod-sites-settings__row">
          <div className="settings-label-row">
            <span className="settings-label">{workshop.name}</span>
          </div>
          <p className="settings-helper-text">
            {t("mods.source.steamWorkshopNote")}
          </p>
        </div>
      )}
    </div>
  );
}
