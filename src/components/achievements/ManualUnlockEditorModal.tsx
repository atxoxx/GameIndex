// ManualUnlockEditorModal — checkbox + date picker per achievement for a
// game that has a manual Steam link. Loads the public schema via
// fetchManualSchema, seeds the current unlock state from the cache
// payload, and persists via saveManualUnlocks.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAchievements } from "../../context/AchievementContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Achievement, AchievementLink } from "../../types/game";
import { Button } from "../ui";

interface ManualUnlockEditorModalProps {
  gameId: string;
  link: AchievementLink;
  onClose: () => void;
}

/** Unix-seconds timestamp → `YYYY-MM-DD` (local time) for `<input type="date">`. */
function epochToDateInput(ts: number): string {
  if (ts <= 0) return "";
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM-DD` → unix-seconds timestamp (local midnight). */
function dateInputToEpoch(value: string): number {
  if (!value) return 0;
  return Math.floor(new Date(`${value}T00:00:00`).getTime() / 1000);
}

export default function ManualUnlockEditorModal({
  gameId,
  link,
  onClose,
}: ManualUnlockEditorModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { fetchManualSchema, getGameAchievements, saveManualUnlocks } =
    useAchievements();

  const [schema, setSchema] = useState<Achievement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // apiName → unix-seconds unlock time (0 = still locked).
  const [unlocks, setUnlocks] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Load the schema on open, seeding unlock state from the cache payload.
  useEffect(() => {
    const appid = Number(link.providerId);
    if (!Number.isFinite(appid) || appid <= 0) {
      setLoadError(String(link.providerId ?? "invalid appid"));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchManualSchema(appid);
        if (cancelled) return;
        const cached = getGameAchievements(gameId)?.achievements ?? [];
        const seed: Record<string, number> = {};
        for (const a of list) {
          const existing = cached.find((c) => c.apiName === a.apiName);
          seed[a.apiName] =
            existing?.achieved && existing.unlockTime > 0 ? existing.unlockTime : 0;
        }
        setSchema(list);
        setUnlocks(seed);
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchManualSchema, getGameAchievements, gameId, link.providerId]);

  // Close on Escape (but not mid-save, so an in-flight write isn't orphaned).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const unlockedCount = useMemo(
    () => Object.values(unlocks).filter((v) => v > 0).length,
    [unlocks],
  );

  function toggleAchievement(apiName: string, achieved: boolean) {
    setUnlocks((prev) => ({
      ...prev,
      // Default a freshly-checked achievement to "now".
      [apiName]: achieved ? Math.floor(Date.now() / 1000) : 0,
    }));
  }

  function setDate(apiName: string, value: string) {
    setUnlocks((prev) => ({
      ...prev,
      [apiName]: dateInputToEpoch(value) || Math.floor(Date.now() / 1000),
    }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const payload = Object.entries(unlocks)
        .filter(([, ts]) => ts > 0)
        .map(([apiName, unlockTime]) => ({ apiName, unlockTime }));
      await saveManualUnlocks(gameId, payload);
      showToast(t("achievements.manualEditor.saved"), "success");
      onClose();
    } catch (err) {
      showToast(t("achievements.manualEditor.saveFailed", { error: String(err) }), "error");
      setSaving(false);
    }
  }

  const linkedName = link.displayName ?? link.providerId ?? "";

  return createPortal(
    <div className="modal-backdrop" onMouseDown={saving ? undefined : onClose}>
      <div
        className="modal ach-modal ach-modal--editor"
        role="dialog"
        aria-modal="true"
        aria-label={t("achievements.manualEditor.title")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">{t("achievements.manualEditor.title")}</h2>
            <p className="modal-subtitle">
              {t("achievements.manualLink.linkedAs", { name: linkedName })}
            </p>
          </div>
          <button
            className="modal-close ach-modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
            disabled={saving}
          >
            ×
          </button>
        </div>

        <div className="modal-body ach-modal-body">
          {loadError ? (
            <p className="ach-modal-error">
              {t("achievements.manualEditor.loadFailed", { error: loadError })}
            </p>
          ) : !schema ? (
            <p className="ach-modal-hint ach-modal-hint--center">
              {t("achievements.manualEditor.loading")}
            </p>
          ) : schema.length === 0 ? (
            <p className="ach-modal-empty">{t("achievements.manualEditor.empty")}</p>
          ) : (
            <>
              <p className="ach-modal-counter">
                {t("achievements.manualEditor.count", {
                  unlocked: unlockedCount,
                  total: schema.length,
                })}
              </p>
              <ul className="ach-editor-list">
                {schema.map((a) => {
                  const ts = unlocks[a.apiName] ?? 0;
                  const achieved = ts > 0;
                  return (
                    <li
                      key={a.apiName}
                      className={`ach-editor-row${achieved ? " unlocked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="ach-editor-check"
                        checked={achieved}
                        onChange={(e) => toggleAchievement(a.apiName, e.target.checked)}
                      />
                      <img
                        className="ach-editor-icon"
                        src={achieved ? a.icon : a.iconGray}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <div className="ach-editor-text">
                        <span className="ach-editor-name">{a.displayName}</span>
                        {a.description && (
                          <span className="ach-editor-desc">{a.description}</span>
                        )}
                      </div>
                      {achieved && (
                        <label className="ach-editor-date">
                          <span className="ach-editor-date-label">
                            {t("achievements.manualEditor.unlockDate")}
                          </span>
                          <input
                            type="date"
                            className="ach-editor-date-input"
                            value={epochToDateInput(ts)}
                            onChange={(e) => setDate(a.apiName, e.target.value)}
                          />
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {schema ? t("achievements.manualEditor.count", { unlocked: unlockedCount, total: schema.length }) : ""}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              isLoading={saving}
              disabled={!schema || schema.length === 0}
            >
              {t("achievements.manualEditor.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
