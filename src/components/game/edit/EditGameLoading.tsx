import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { Game } from "../../../types/game";
import { Button, Skeleton, SkeletonText } from "../../ui";

export function EditGameLoading({
  game,
  onClose,
}: {
  game: Game;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop edit-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal edit-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={t("gamePage.editGame", { name: game.name })}
      >
        <header className="edit-header modal-header">
          <div className="edit-identity">
            <span
              className="edit-identity-cover"
              style={
                game.coverArtUrl
                  ? { backgroundImage: `url(${game.coverArtUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : undefined
              }
            />
            <div className="edit-identity-text">
              <div className="edit-identity-title-row">
                <h1 className="edit-identity-title">
                  {t("gamePage.editGame", { name: game.name })}
                </h1>
              </div>
              <div className="edit-identity-meta">
                <span className="edit-identity-sub">{game.platform}</span>
              </div>
            </div>
          </div>
          <div className="edit-search">
            <Skeleton width="100%" height="34px" shape="rect" />
          </div>
          <div className="edit-header-actions">
            <Skeleton width="110px" height="30px" shape="rect" />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={onClose}
              aria-label={t("common.close")}
              title={t("common.close")}
              leftIcon={<X size={17} />}
            />
          </div>
        </header>
        <div className="edit-body">
          <div className="edit-rail">
            <div className="edit-rail-scroll">
              {[0, 1, 2, 3].map((item) => (
                <Skeleton key={item} width="160px" height="30px" shape="rect" />
              ))}
            </div>
          </div>
          <div className="edit-content">
            <div className="edit-content-inner">
              <Skeleton width="180px" height="1.2rem" />
              <Skeleton width="320px" height="0.85rem" />
              <div className="edit-skeleton-grid">
                {[0, 1, 2, 3, 4, 5].map((item) => (
                  <div key={item} className="edit-skeleton-field">
                    <Skeleton width="80px" height="0.7rem" />
                    <Skeleton width="100%" height="36px" shape="rect" />
                  </div>
                ))}
              </div>
              <SkeletonText lines={3} />
            </div>
          </div>
        </div>
        <footer className="edit-footer modal-footer">
          <Skeleton width="160px" height="0.8rem" />
          <div className="edit-footer-actions">
            <Skeleton width="80px" height="34px" shape="rect" />
            <Skeleton width="120px" height="34px" shape="rect" />
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
