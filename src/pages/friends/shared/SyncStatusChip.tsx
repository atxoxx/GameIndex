import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { FriendsSyncPhase, ManualSyncState } from "../../../sync/friends/engine";
import { syncTone } from "../friendsSyncPresentation";
import {
  getNostrShareScope,
  setNostrShareScope,
  type NostrShareScope,
} from "../../friendsStorage";

interface SyncStatusChipProps {
  /** Engine phase; the chip never guesses from timers. */
  phase: FriendsSyncPhase;
  /** Outcome of the user's last explicit pass, when the controller knows it. */
  manualSync?: ManualSyncState;
  /** Local changes still queued for the next publish. */
  pendingPublish?: number;
  lastSyncedTime: string;
  /** What the state means, already translated by the controller. */
  lastMessage?: string;
  onSyncNow: () => void;
  onOpenDiagnostics: () => void;
}

const SCOPES: { value: Exclude<NostrShareScope, "off">; labelKey: string }[] = [
  { value: "core", labelKey: "friendsPage.nostrScopeCore" },
  { value: "full", labelKey: "friendsPage.nostrScopeFull" },
];

/** The engine always publishes; a stored legacy "off" means the reduced set. */
function normalizeScope(scope: NostrShareScope): Exclude<NostrShareScope, "off"> {
  return scope === "full" ? "full" : "core";
}

const PHASE_LABEL: Record<ReturnType<typeof syncTone>, string> = {
  idle: "friendsPage.syncPhaseIdle",
  connecting: "friendsPage.syncPhaseConnecting",
  online: "friendsPage.syncPhaseOnline",
  degraded: "friendsPage.syncPhaseDegraded",
  offline: "friendsPage.syncPhaseOffline",
};

const OUTCOME_TOAST: Partial<Record<ManualSyncState, { key: string; type: "success" | "info" | "error" }>> = {
  ok: { key: "friendsPage.syncNowToastOk", type: "success" },
  partial: { key: "friendsPage.syncNowToastPartial", type: "info" },
  failed: { key: "friendsPage.syncNowToastFailed", type: "error" },
};

/**
 * One honest sync control. The engine runs on its own, so this chip reports
 * its phase and lets the user ask for a pass; nothing here polls or fakes a
 * spinner. The share scope lives one click away because that is the only sync
 * decision the user actually makes.
 */
export function SyncStatusChip({
  phase,
  manualSync = "idle",
  pendingPublish = 0,
  lastSyncedTime,
  lastMessage,
  onSyncNow,
  onOpenDiagnostics,
}: SyncStatusChipProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Exclude<NostrShareScope, "off">>(() =>
    normalizeScope(getNostrShareScope())
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const previousManualSync = useRef<ManualSyncState | null>(null);

  const running = manualSync === "running";

  useEffect(() => {
    if (!open) return;
    setScope(normalizeScope(getNostrShareScope()));
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Only a pass this component watched go from "running" to a result toasts,
  // so remounting on an old "ok" stays quiet.
  useEffect(() => {
    const previous = previousManualSync.current;
    previousManualSync.current = manualSync;
    if (previous !== "running" || manualSync === "running") return;
    const outcome = OUTCOME_TOAST[manualSync];
    if (!outcome) return;
    showToast(t(outcome.key), outcome.type);
  }, [manualSync, showToast, t]);

  const handleScope = (next: Exclude<NostrShareScope, "off">) => {
    if (next === scope) return;
    setScope(next);
    setNostrShareScope(next);
    window.dispatchEvent(new Event("gamelib:nostr-share-scope-changed"));
    showToast(t("friendsPage.nostrPublishOnToast"), "info");
  };

  const tone = running ? "connecting" : syncTone(phase, pendingPublish);
  const status = t(PHASE_LABEL[tone]);

  const fallbackMessage = running
    ? t("friendsPage.syncStateRunning")
    : tone === "offline"
      ? t("friendsPage.syncStateOffline")
      : tone === "idle" && !lastSyncedTime
        ? t("friendsPage.syncStateNever")
        : t("friendsPage.syncStateUpToDate");

  return (
    <div className="friends-sync" ref={rootRef}>
      <button
        type="button"
        className={`friends-sync__chip is-${tone}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={t("friendsPage.syncAndSharing")}
      >
        <span className={`friends-sync__dot is-${tone}`} aria-hidden="true" />
        <span className="friends-sync__label">{status}</span>
        {pendingPublish > 0 && (
          <span className="friends-sync__pending" title={t("friendsPage.syncPendingPublish", { count: pendingPublish })}>
            {pendingPublish}
          </span>
        )}
        <ChevronDown size={13} className="friends-sync__chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="friends-sync__popover" role="dialog" aria-label={t("friendsPage.syncAndSharing")}>
          <div className="friends-sync__popover-head">
            <span className="friends-sync__popover-icon" aria-hidden="true">
              <ShieldCheck size={15} />
            </span>
            <div>
              <strong>{t("friendsPage.syncAndSharing")}</strong>
              <span className="friends-sync__subtitle">{lastMessage || fallbackMessage}</span>
            </div>
          </div>

          <div className="friends-sync__meta">
            <span className={`friends-sync__meta-dot is-${tone}`} aria-hidden="true" />
            <span>{status}</span>
            <span className="friends-sync__meta-sep" aria-hidden="true" />
            <span>
              {t("friendsPage.lastSynced")}: {lastSyncedTime || t("friendsPage.lastSyncedNever")}
            </span>
          </div>

          <div className="friends-sync__scope">
            <span className="friends-sync__scope-label">
              <SlidersHorizontal size={13} aria-hidden="true" />
              {t("friendsPage.nostrPublishToggle")}
            </span>
            <div className="friends-sync__scope-options" role="radiogroup" aria-label={t("friendsPage.nostrPublishToggle")}>
              {SCOPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={option.value === scope}
                  className={option.value === scope ? "is-active" : ""}
                  onClick={() => handleScope(option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="friends-sync__actions">
            <button
              type="button"
              className="friends-sync__action is-primary"
              onClick={onSyncNow}
              disabled={running}
            >
              <RefreshCw size={13} className={running ? "friends-spin" : ""} aria-hidden="true" />
              {t("friends.syncNow")}
            </button>
            <button type="button" className="friends-sync__action is-secondary" onClick={onOpenDiagnostics}>
              {t("friendsPage.diagnostics")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SyncStatusChip;
