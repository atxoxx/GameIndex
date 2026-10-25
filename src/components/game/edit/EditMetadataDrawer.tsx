import { useEffect, useRef } from "react";
import { ExternalLink, Sparkles, X } from "lucide-react";
import { Button } from "../../ui";
import { useEditGame } from "./EditGameContext";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function EditMetadataDrawer() {
  const {
    t,
    game,
    editName,
    showMetadataPanel,
    setShowMetadataPanel,
    metadataResults,
    fetchingMetadata,
    applyingMetadata,
    handleApplyMetadata,
  } = useEditGame();
  const panelRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!showMetadataPanel) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setShowMetadataPanel(false);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [showMetadataPanel, setShowMetadataPanel]);

  if (!showMetadataPanel) return null;

  return (
    <div className="edit-drawer-layer" role="presentation">
      <div
        className="edit-drawer-scrim"
        onClick={() => setShowMetadataPanel(false)}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className="edit-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-metadata-title"
        tabIndex={-1}
      >
        <header className="edit-drawer-header">
          <div>
            <h2 className="edit-drawer-title" id="edit-metadata-title">
              {t("edit.metadataSearchResults")}
            </h2>
            <p className="edit-drawer-sub">
              {t("edit.metadataResultsFor", { name: editName.trim() || game.name })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setShowMetadataPanel(false)}
            aria-label={t("common.close")}
            title={t("common.close")}
            leftIcon={<X size={16} />}
          />
        </header>

        <div className="edit-drawer-body">
          {fetchingMetadata ? (
            <div className="edit-drawer-loading">
              <span className="edit-spinner" aria-hidden="true" />
              <p>{t("edit.searchingFor", { name: editName.trim() || game.name })}</p>
            </div>
          ) : metadataResults.length === 0 ? (
            <div className="edit-drawer-empty">
              <Sparkles size={22} aria-hidden="true" />
              <p>{t("edit.noResults")}</p>
            </div>
          ) : (
            <div className="edit-metadata-list">
              {metadataResults.map((result, index) => (
                <article key={`${result.sourceUrl}-${index}`} className="edit-metadata-card">
                  <div className="edit-metadata-top">
                    <span className="edit-metadata-source">{result.sourceName}</span>
                    <a
                      href={result.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="edit-metadata-link"
                      title={t("edit.openSourcePage")}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  </div>
                  <h3 className="edit-metadata-title">{result.title}</h3>
                  {result.description && (
                    <p className="edit-metadata-desc">{result.description}</p>
                  )}
                  <dl className="edit-metadata-facts">
                    {result.developer && (
                      <div>
                        <dt>{t("edit.label.developer")}</dt>
                        <dd>{result.developer}</dd>
                      </div>
                    )}
                    {result.publisher && (
                      <div>
                        <dt>{t("edit.label.publisher")}</dt>
                        <dd>{result.publisher}</dd>
                      </div>
                    )}
                    {result.releaseDate && (
                      <div>
                        <dt>{t("edit.label.releaseDate")}</dt>
                        <dd>{result.releaseDate}</dd>
                      </div>
                    )}
                  </dl>
                  {result.genres.length > 0 && (
                    <div className="edit-metadata-genres">
                      {result.genres.map((genre) => (
                        <span key={genre} className="edit-chip">
                          {genre}
                        </span>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={applyingMetadata}
                    isLoading={applyingMetadata}
                    onClick={() => handleApplyMetadata(result)}
                  >
                    {t("edit.applyMetadata")}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
