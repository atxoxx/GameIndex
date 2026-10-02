import { ArrowLeft, ArrowRight, Cookie, ExternalLink, Home, RotateCw } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import "../../styles/webview-controls.css";

interface WebviewControlsProps {
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  onReload?: () => void;
  onHome?: () => void;
  /** Re-runs the consent-banner dismissal inside the embedded page. */
  onDismissCookies?: () => void;
  onOpenExternal?: () => void;
  className?: string;
}

/**
 * Compact browser-style toolbar shared by every embedded preview webview
 * (Map tab, WebLinks, News full page). The native webviews have no browser
 * chrome of their own, so the common commands live here.
 */
export default function WebviewControls({
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
  onReload,
  onHome,
  onDismissCookies,
  onOpenExternal,
  className,
}: WebviewControlsProps) {
  const { t } = useLanguage();

  return (
    <div className={`wv-controls${className ? ` ${className}` : ""}`}>
      {onBack && (
        <button
          type="button"
          className="wv-controls__btn"
          onClick={onBack}
          disabled={!canGoBack}
          title={t("weblinks.goBack")}
          aria-label={t("weblinks.goBack")}
        >
          <ArrowLeft size={15} />
        </button>
      )}
      {onForward && (
        <button
          type="button"
          className="wv-controls__btn"
          onClick={onForward}
          disabled={!canGoForward}
          title={t("weblinks.goForward")}
          aria-label={t("weblinks.goForward")}
        >
          <ArrowRight size={15} />
        </button>
      )}
      {onReload && (
        <button
          type="button"
          className="wv-controls__btn"
          onClick={onReload}
          title={t("weblinks.reloadPreview")}
          aria-label={t("weblinks.reload")}
        >
          <RotateCw size={15} />
        </button>
      )}
      {onHome && (
        <button
          type="button"
          className="wv-controls__btn"
          onClick={onHome}
          title={t("weblinks.homeTooltip")}
          aria-label={t("weblinks.home")}
        >
          <Home size={15} />
        </button>
      )}
      {onDismissCookies && (
        <>
          <span className="wv-controls__divider" aria-hidden />
          <button
            type="button"
            className="wv-controls__btn"
            onClick={onDismissCookies}
            title={t("weblinks.dismissCookies")}
            aria-label={t("weblinks.dismissCookies")}
          >
            <Cookie size={15} />
          </button>
        </>
      )}
      {onOpenExternal && (
        <button
          type="button"
          className="wv-controls__btn"
          onClick={onOpenExternal}
          title={t("weblinks.openInBrowser")}
          aria-label={t("weblinks.openInBrowser")}
        >
          <ExternalLink size={15} />
        </button>
      )}
    </div>
  );
}
