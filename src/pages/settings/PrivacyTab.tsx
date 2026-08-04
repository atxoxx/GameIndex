import { useCallback, useEffect, useState } from "react";
import { Button, ConfirmModal } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import { TrashIcon } from "./settingsIcons";

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

/**
 * PrivacyTab — review everything GameIndex keeps in localStorage and
 * wipe individual keys or everything at once. Confirmation goes through
 * the shared ConfirmModal, matching the rest of the app.
 */
export default function PrivacyTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [items, setItems] = useState<{ key: string; value: string; size: number }[]>([]);
  const [wipeAllOpen, setWipeAllOpen] = useState(false);
  const [wipeKeyOpen, setWipeKeyOpen] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const next: { key: string; value: string; size: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key) ?? "";
      const size = new Blob([value]).size;
      next.push({ key, value, size });
    }
    next.sort((a, b) => a.key.localeCompare(b.key));
    setItems(next);
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      setWipeAllOpen(false);
      setWipeKeyOpen(null);
    };
  }, [refresh]);

  const wipeKey = (key: string) => {
    localStorage.removeItem(key);
    refresh();
    showToast(t("settings.wipe.removed", { key }), "success");
    setWipeKeyOpen(null);
  };

  const wipeAll = () => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    refresh();
    showToast(t("settings.wipe.allRemoved"), "success");
    setWipeAllOpen(false);
  };

  return (
    <SettingsSection
      icon={<TrashIcon />}
      title={t("settings.section.wipeData")}
      desc={t("settings.wipe.desc")}
    >
      <div className="settings-wipe-toolbar">
        <span className="settings-wipe-count">
          {t("settings.wipe.itemCount", { count: items.length })}
        </span>
        <div className="settings-wipe-actions">
          <Button variant="ghost" size="sm" onClick={refresh}>
            {t("settings.wipe.refresh")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setWipeAllOpen(true)}
            disabled={items.length === 0}
          >
            {t("settings.wipe.wipeAll")}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="settings-wipe-empty">{t("settings.wipe.empty")}</p>
      ) : (
        <ul className="settings-wipe-list">
          {items.map((item) => {
            const preview = item.value.length > 160
              ? `${item.value.slice(0, 160)}…`
              : item.value || t("settings.wipe.noValue");
            return (
              <li className="settings-wipe-item" key={item.key}>
                <div className="settings-wipe-item-info">
                  <code className="settings-wipe-key">{item.key}</code>
                  <span className="settings-wipe-size">
                    {t("settings.wipe.size", { size: formatStorageBytes(item.size) })}
                  </span>
                  <pre className="settings-wipe-value" title={item.value}>{preview}</pre>
                </div>
                <div className="settings-wipe-item-action">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setWipeKeyOpen(item.key)}
                  >
                    {t("settings.wipe.remove")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        open={wipeAllOpen}
        title={t("settings.wipe.wipeAll")}
        message={t("settings.wipe.wipeAllConfirm", { count: items.length })}
        confirmLabel={t("settings.wipe.wipeAllConfirmBtn")}
        cancelLabel={t("settings.wipe.cancel")}
        onConfirm={wipeAll}
        onCancel={() => setWipeAllOpen(false)}
      />

      <ConfirmModal
        open={wipeKeyOpen !== null}
        title={t("settings.wipe.remove")}
        message={t("settings.wipe.removeConfirm")}
        confirmLabel={t("settings.wipe.remove")}
        cancelLabel={t("settings.wipe.cancel")}
        onConfirm={() => wipeKeyOpen !== null && wipeKey(wipeKeyOpen)}
        onCancel={() => setWipeKeyOpen(null)}
      />
    </SettingsSection>
  );
}
