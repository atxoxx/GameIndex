import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { HltbStats } from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { Button } from "../../ui";
import { IconExternalLink, IconInfo, IconRefresh } from "../icons";
import HltbDetailsContent from "./HltbDetailsContent";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface HltbDetailsModalProps {
  stats: HltbStats;
  playTime?: string;
  onClose: () => void;
  /** Optional HLTB refetch, wired only where the game lives in the library. */
  onRefresh?: () => void | Promise<void>;
}

/**
 * Desktop HLTB sheet. The content owns the hero/tabs; this shell adds the
 * portal, focus containment, Escape handling and the refresh/external
 * actions so Big Screen can reuse the content without the desktop chrome.
 */
export default function HltbDetailsModal({
  stats,
  playTime,
  onClose,
  onRefresh,
}: HltbDetailsModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const headingId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Remember the opener and move focus into the sheet; restore on close.
  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => {
      window.clearTimeout(timer);
      openerRef.current?.focus();
    };
  }, []);

  // Escape closes, Tab stays inside the sheet.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = modalRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      showToast(t("hltb.refreshed"), "success");
    } catch {
      showToast(t("hltb.refreshFailed"), "error");
    } finally {
      setRefreshing(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        ref={modalRef}
        className="modal hltb-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <HltbDetailsContent
          stats={stats}
          playTime={playTime}
          variant="tabbed"
          headingId={headingId}
          onClose={onClose}
          closeButtonRef={closeRef}
        />

        <div className="modal-footer hltb-footer">
          <span className="hltb-footer__source">
            <IconInfo size={12} />
            {t("hltb.sourceNote")}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            {onRefresh && (
              <Button
                variant="secondary"
                leftIcon={<IconRefresh size={14} />}
                isLoading={refreshing}
                onClick={() => void handleRefresh()}
              >
                {t("hltb.refresh")}
              </Button>
            )}
            {stats.url && (
              <Button
                variant="primary"
                leftIcon={<IconExternalLink size={14} />}
                onClick={() => {
                  void openUrl(stats.url as string);
                }}
              >
                {t("hltb.openOnHltb")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
