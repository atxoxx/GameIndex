import { useEffect, useState, type RefObject } from "react";
import { Image as ImageIcon, Sparkles, X } from "lucide-react";
import { Button } from "../../ui";
import { PLAY_STATUS_DETAILS } from "../../../types/game";
import type { EditSectionKey } from "./draftKeys";
import { useEditGame } from "./EditGameContext";
import { EditGameSearch } from "./EditGameSearch";

export function EditGameHeader({
  onRequestClose,
  onFetchMetadata,
  searchInputRef,
  onJump,
  showCompatibility,
}: {
  onRequestClose: () => void;
  onFetchMetadata: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onJump: (section: EditSectionKey, fieldId?: string) => void;
  showCompatibility: boolean;
}) {
  const {
    game,
    t,
    editName,
    editDisplayName,
    editCover,
    editDeveloper,
    editPlatform,
    editPlayStatus,
    dirtyCount,
    fetchingMetadata,
  } = useEditGame();
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = editCover || game.coverArtUrl || "";
  const title = editDisplayName.trim() || editName.trim() || game.name;
  const subtitle = [editDeveloper, editPlatform].filter(Boolean).join(" · ");
  const status = PLAY_STATUS_DETAILS[editPlayStatus];
  const dirtyLabel =
    dirtyCount === 1
      ? t("edit.unsavedOne")
      : t("edit.unsavedCount", { count: dirtyCount });

  useEffect(() => {
    setCoverFailed(false);
  }, [cover]);

  return (
    <header className="edit-header modal-header">
      <div className="edit-identity">
        <span className="edit-identity-cover">
          {cover && !coverFailed ? (
            <img src={cover} alt="" onError={() => setCoverFailed(true)} />
          ) : (
            <ImageIcon size={18} aria-hidden="true" />
          )}
        </span>
        <div className="edit-identity-text">
          <div className="edit-identity-title-row">
            <h1 className="edit-identity-title" id="edit-modal-title">
              {t("gamePage.editGame", { name: title })}
            </h1>
            {dirtyCount > 0 && (
              <span
                className="edit-identity-dirty"
                title={dirtyLabel}
                aria-label={dirtyLabel}
              />
            )}
          </div>
          <div className="edit-identity-meta">
            {subtitle && <span className="edit-identity-sub">{subtitle}</span>}
            <span className={`edit-status-pill status-${editPlayStatus}`}>
              {t(status.labelKey)}
            </span>
          </div>
        </div>
      </div>

      <EditGameSearch
        inputRef={searchInputRef}
        onJump={onJump}
        showCompatibility={showCompatibility}
      />

      <div className="edit-header-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={onFetchMetadata}
          isLoading={fetchingMetadata}
          leftIcon={!fetchingMetadata ? <Sparkles size={15} /> : undefined}
          title={t("edit.fetchMetadata")}
          aria-label={t("edit.fetchMetadata")}
        >
          <span className="edit-header-btn-label">{t("edit.fetchMetadata")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onRequestClose}
          aria-label={t("common.close")}
          title={t("common.close")}
          leftIcon={<X size={17} />}
        />
      </div>
    </header>
  );
}
