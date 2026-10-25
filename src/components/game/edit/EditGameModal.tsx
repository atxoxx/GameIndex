import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGames } from "../../../context/GameContext";
import { useSettings } from "../../../context/SettingsContext";
import { useLanguage } from "../../../context/LanguageContext";
import { ConfirmModal } from "../../ui";
import type { Game } from "../../../types/game";
import type { EditGameTab } from "../editGameTabs";
import { MediaFetchBrowser } from "../MediaFetchBrowser";
import { EditGameProvider, useEditGame } from "./EditGameContext";
import { EditGameHeader } from "./EditGameHeader";
import { EditGameRail } from "./EditGameRail";
import { EditGameFooter } from "./EditGameFooter";
import { EditGameLoading } from "./EditGameLoading";
import { EditMetadataDrawer } from "./EditMetadataDrawer";
import { useEditGameController } from "./useEditGameController";
import {
  AREA_FOR_SECTION,
  DEFAULT_SECTION,
  type EditAreaKey,
  type EditSectionKey,
} from "./draftKeys";
import { DetailsArea } from "./sections/DetailsArea";
import { MediaArea } from "./sections/MediaArea";
import { LaunchArea } from "./sections/LaunchArea";
import { CompatibilityArea } from "./sections/CompatibilityArea";
import "./EditGameModal.css";

export interface EditGameModalProps {
  game: Game;
  onClose: () => void;
  /** Section to show on mount, so callers can deep-link into one area. */
  initialTab?: EditGameTab;
  /** Optional field to scroll to and focus once the modal is open. */
  focusField?: "purchaseCost";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    element.isContentEditable
  );
}

function focusFieldById(fieldId?: string) {
  if (!fieldId) return;
  const host = document.getElementById(fieldId);
  if (!host) return;
  host.scrollIntoView?.({ block: "center", behavior: "smooth" });
  const focusable = host.matches(FOCUSABLE)
    ? (host as HTMLElement)
    : host.querySelector<HTMLElement>(FOCUSABLE);
  focusable?.focus({ preventScroll: true });
}

/**
 * Gate the editor on the full game record. The library holds lightweight
 * summaries, so the editor fetches the heavy record before mounting the form —
 * otherwise saving would clear columns the summary never carried.
 */
export function EditGameModal(props: EditGameModalProps) {
  const { loadGameDetail, isGameDetailLoaded } = useGames();
  const [ready, setReady] = useState(() => isGameDetailLoaded(props.game.id));

  useEffect(() => {
    let cancelled = false;
    if (isGameDetailLoaded(props.game.id)) {
      setReady(true);
      return;
    }
    setReady(false);
    void loadGameDetail(props.game.id).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [props.game.id, loadGameDetail, isGameDetailLoaded]);

  if (!ready) {
    return <EditGameLoading game={props.game} onClose={props.onClose} />;
  }
  return <EditGameEditor {...props} />;
}

function EditGameEditor({ game, onClose, initialTab, focusField }: EditGameModalProps) {
  const { showFullLinuxUi } = useSettings();
  const controller = useEditGameController({ game, onClose });
  return (
    <EditGameProvider controller={controller}>
      <EditGameShell
        game={game}
        onClose={onClose}
        initialTab={initialTab}
        focusField={focusField}
        showFullLinuxUi={showFullLinuxUi}
      />
    </EditGameProvider>
  );
}

function EditGameShell({
  game,
  onClose,
  initialTab,
  focusField,
  showFullLinuxUi,
}: {
  game: Game;
  onClose: () => void;
  initialTab?: EditGameTab;
  focusField?: "purchaseCost";
  showFullLinuxUi: boolean;
}) {
  const { t } = useLanguage();
  const {
    isDirty,
    dirtyCount,
    dirtyBySection,
    saveEdits,
    mediaFetchSlot,
    setMediaFetchSlot,
    editName,
    showMetadataPanel,
    handleFetchMetadata,
    handleApplyFetchedImage,
  } = useEditGame();

  const initialArea: EditAreaKey =
    initialTab && (initialTab !== "compatibility" || showFullLinuxUi)
      ? initialTab
      : "details";
  const initialSection: EditSectionKey =
    focusField === "purchaseCost" ? "storage" : DEFAULT_SECTION[initialArea];

  const [activeArea, setActiveArea] = useState<EditAreaKey>(initialArea);
  const [activeSection, setActiveSection] = useState<EditSectionKey>(initialSection);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const lastSectionRef = useRef<Record<EditAreaKey, EditSectionKey>>({
    ...DEFAULT_SECTION,
    [initialArea]: initialSection,
  });
  const pendingFocusRef = useRef<{ section: EditSectionKey; fieldId?: string } | null>(
    focusField === "purchaseCost"
      ? { section: "storage", fieldId: "edit-purchase-cost" }
      : null,
  );

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const childDialogOpenRef = useRef(false);
  childDialogOpenRef.current =
    closeConfirmOpen || showMetadataPanel || Boolean(mediaFetchSlot);

  const selectArea = useCallback((area: EditAreaKey) => {
    setActiveArea(area);
    setActiveSection(lastSectionRef.current[area] ?? DEFAULT_SECTION[area]);
  }, []);

  const selectSection = useCallback((section: EditSectionKey) => {
    const area = AREA_FOR_SECTION[section];
    setActiveArea(area);
    setActiveSection(section);
    lastSectionRef.current[area] = section;
  }, []);

  const jumpTo = useCallback(
    (section: EditSectionKey, fieldId?: string) => {
      if (!showFullLinuxUi && AREA_FOR_SECTION[section] === "compatibility") return;
      selectSection(section);
      if (section === activeSection) {
        window.setTimeout(() => focusFieldById(fieldId), 40);
      } else {
        pendingFocusRef.current = { section, fieldId };
      }
    },
    [activeSection, selectSection, showFullLinuxUi],
  );

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || pending.section !== activeSection) return;
    pendingFocusRef.current = null;
    const timer = window.setTimeout(() => focusFieldById(pending.fieldId), 80);
    return () => window.clearTimeout(timer);
  }, [activeSection]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeSection]);

  const requestClose = useCallback(() => {
    if (isDirty) setCloseConfirmOpen(true);
    else onClose();
  }, [isDirty, onClose]);

  // Focus return + scroll lock for the lifetime of the editor.
  useEffect(() => {
    const restoreFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      restoreFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mediaFetchSlot) {
        event.preventDefault();
        setMediaFetchSlot(null);
        return;
      }
      if (childDialogOpenRef.current) return;

      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (isDirty) saveEdits();
        return;
      }
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null || element === dialog);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDirty, mediaFetchSlot, requestClose, saveEdits, setMediaFetchSlot]);

  const title = editName.trim() || game.name;

  return createPortal(
    <div
      className="modal-backdrop edit-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal edit-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-modal-title"
        tabIndex={-1}
      >
        <EditGameHeader
          onRequestClose={requestClose}
          onFetchMetadata={handleFetchMetadata}
          searchInputRef={searchInputRef}
          onJump={jumpTo}
          showCompatibility={showFullLinuxUi}
        />

        <div className="edit-body">
          <EditGameRail
            activeArea={activeArea}
            activeSection={activeSection}
            onSelectArea={selectArea}
            onSelectSection={selectSection}
            showCompatibility={showFullLinuxUi}
            dirtyBySection={dirtyBySection}
          />

          <main
            ref={contentRef}
            className="edit-content"
            aria-labelledby={`edit-section-${activeSection}`}
          >
            <div className="edit-content-inner" key={activeSection}>
              {activeArea === "details" && <DetailsArea section={activeSection} />}
              {activeArea === "media" && <MediaArea section={activeSection} />}
              {activeArea === "launch" && <LaunchArea section={activeSection} />}
              {activeArea === "compatibility" && showFullLinuxUi && (
                <CompatibilityArea section={activeSection} />
              )}
            </div>
          </main>
        </div>

        <EditGameFooter onRequestClose={requestClose} />
        <EditMetadataDrawer />

        {mediaFetchSlot && (
          <MediaFetchBrowser
            slot={mediaFetchSlot}
            gameName={title}
            steamAppId={game.steamAppId}
            onApply={(url) => handleApplyFetchedImage(mediaFetchSlot, url)}
            onClose={() => setMediaFetchSlot(null)}
          />
        )}
      </div>

      {closeConfirmOpen && (
        <ConfirmModal
          open
          title={t("edit.discardTitle")}
          message={
            dirtyCount === 1
              ? t("edit.discardMessageOne")
              : t("edit.discardMessage", { count: dirtyCount })
          }
          confirmLabel={t("edit.discardChanges")}
          cancelLabel={t("edit.keepEditing")}
          confirmVariant="danger"
          onConfirm={() => {
            setCloseConfirmOpen(false);
            onClose();
          }}
          onCancel={() => setCloseConfirmOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}
