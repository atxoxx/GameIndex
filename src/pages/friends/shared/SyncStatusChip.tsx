import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import {
  getNostrShareScope,
  setNostrShareScope,
  type NostrShareScope,
} from "../../friendsStorage";

interface SyncStatusChipProps {
  isSyncing: boolean;
  lastSyncedTime: string;
  lastMessage?: string;
  onSyncNow: () => void;
  onOpenDiagnostics: () => void;
}

const SCOPES: { value: NostrShareScope; labelKey: string }[] = [
  { value: "off", labelKey: "friendsPage.nostrScopeOff" },
  { value: "core", labelKey: "friendsPage.nostrScopeCore" },
  { value: "full", labelKey: "friendsPage.nostrScopeFull" },
];

/**
 * One honest sync control. The old toolbar carried two icon buttons and a
 * status line; this chip keeps the same information one click away and
 * surfaces the share scope where the sync actually happens.
 */
export function SyncStatusChip({
  isSyncing,
  lastSyncedTime,
  lastMessage,
  onSyncNow,
  onOpenDiagnostics,
}: SyncStatusChipProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<NostrShareScope>(() => getNostrShareScope());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setScope(getNostrShareScope());
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

  const handleScope = (next: NostrShareScope) => {
    if (next === scope) return;
    setScope(next);
    setNostrShareScope(next);
    window.dispatchEvent(new Event("gamelib:nostr-share-scope-changed"));
    showToast(
      next === "off" ? t("friendsPage.nostrPublishOffToast") : t("friendsPage.nostrPublishOnToast"),
      "info"
    );
  };

  const status = isSyncing
    ? t("friends.syncing")
    : lastSyncedTime
    ? t("friends.synced", { time: lastSyncedTime })
    : t("friendsPage.lastSyncedNever");

  return (
    <div className="friends-sync" ref={rootRef}>
      <button
        type="button"
        className={["friends-sync__chip", isSyncing ? "is-syncing" : ""].filter(Boolean).join(" ")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={t("friendsPage.syncAndSharing")}
      >
        <span className={`friends-sync__dot${isSyncing ? " is-syncing" : ""}`} aria-hidden="true" />
        <span className="friends-sync__label">{status}</span>
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
              <span>{lastMessage || t("friendsPage.noSyncActivityRecorded")}</span>
            </div>
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
            <button type="button" className="friends-sync__action is-primary" onClick={onSyncNow} disabled={isSyncing}>
              <RefreshCw size={13} className={isSyncing ? "friends-spin" : ""} aria-hidden="true" />
              {t("friends.syncNow")}
            </button>
            <button type="button" className="friends-sync__action" onClick={onOpenDiagnostics}>
              {t("friendsPage.diagnostics")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SyncStatusChip;
