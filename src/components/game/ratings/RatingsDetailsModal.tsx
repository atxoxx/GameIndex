import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  Game,
  MetacriticScore,
  SteamGameReviews,
} from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import { IconExternalLink, IconInfo } from "../icons";
import RatingsDetailsContent from "./RatingsDetailsContent";
import { steamStoreUrl } from "./ratingsShared";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface RatingsDetailsModalProps {
  game: Game;
  metacritic: MetacriticScore | null;
  steam?: SteamGameReviews | null;
  onClose: () => void;
}

/**
 * Desktop ratings sheet. The content owns the hero, score strip and tabs;
 * this shell adds the portal, focus containment, Escape handling and the
 * per-source external links.
 */
export default function RatingsDetailsModal({
  game,
  metacritic,
  steam,
  onClose,
}: RatingsDetailsModalProps) {
  const { t } = useLanguage();
  const headingId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const hltbUrl = game.timeToBeat?.hltb?.url ?? null;
  const steamUrl = steamStoreUrl(game.steamAppId);
  const metacriticUrl = metacritic?.url ?? null;

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
        (node) => node.offsetParent !== null || node === document.activeElement,
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

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        ref={modalRef}
        className="modal rt-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <RatingsDetailsContent
          game={game}
          metacritic={metacritic}
          steam={steam}
          variant="tabbed"
          headingId={headingId}
          onClose={onClose}
          closeButtonRef={closeRef}
        />

        <div className="modal-footer rt-footer">
          <span className="rt-footer__source">
            <IconInfo size={12} />
            {t("ratings.sourceNote")}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            {metacriticUrl && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<IconExternalLink size={14} />}
                onClick={() => {
                  void openUrl(metacriticUrl);
                }}
              >
                {t("ratings.metacritic")}
              </Button>
            )}
            {steamUrl && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<IconExternalLink size={14} />}
                onClick={() => {
                  void openUrl(steamUrl);
                }}
              >
                {t("ratings.steam")}
              </Button>
            )}
            {hltbUrl && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<IconExternalLink size={14} />}
                onClick={() => {
                  void openUrl(hltbUrl);
                }}
              >
                {t("gameInfo.hltb")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
