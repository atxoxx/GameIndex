import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import type { NewsArticle } from "../../hooks/useNewsFeeds";
import { formatArticleDate, estimateReadingTime } from "../../hooks/useNewsFeeds";
import { useLanguage } from "../../context/LanguageContext";

interface NewsArticlePreviewProps {
  article: NewsArticle | null;
  saved?: boolean;
  onClose: () => void;
  onToggleSave?: (article: NewsArticle) => void;
  onPrevArticle?: () => void;
  onNextArticle?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

type PreviewMode = "reader" | "full";
type FontSize = "sm" | "md" | "lg" | "xl";
type ReaderTheme = "dark" | "oled" | "sepia" | "slate";
type FontFamily = "sans" | "serif" | "mono";

export default function NewsArticlePreview({
  article,
  saved = false,
  onClose,
  onToggleSave,
  onPrevArticle,
  onNextArticle,
  hasPrev = false,
  hasNext = false,
}: NewsArticlePreviewProps) {
  const { t } = useLanguage();
  const placeholderRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState(false);
  const webviewInstRef = useRef<Webview | null>(null);

  const [shareCopied, setShareCopied] = useState(false);
  const [markdownCopied, setMarkdownCopied] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("reader");
  const [fontSize, setFontSize] = useState<FontSize>("md");
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("dark");
  const [fontFamily, setFontFamily] = useState<FontFamily>("sans");
  const [readProgress, setReadProgress] = useState(0);

  // Text-To-Speech (TTS) states
  const [ttsState, setTtsState] = useState<"idle" | "playing" | "paused">("idle");
  const [ttsSpeed, setTtsSpeed] = useState<number>(1.0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const readTimeMinutes = useMemo(() => {
    if (!article) return 1;
    const text = (article.content || article.description || "") + " " + article.title;
    return estimateReadingTime(text);
  }, [article]);

  const wordCount = useMemo(() => {
    if (!article) return 0;
    const text = article.content || article.description || "";
    return text.trim().split(/\s+/).filter(Boolean).length;
  }, [article]);

  // Clean plain text for TTS and Markdown copy
  const plainTextContent = useMemo(() => {
    if (!article) return "";
    const raw = article.content || article.description || "";
    return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }, [article]);

  // Stop speech when closing or changing article
  const stopTts = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setTtsState("idle");
  }, []);

  useEffect(() => {
    return () => {
      stopTts();
    };
  }, [article, stopTts]);

  const handleToggleTts = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !article) {
      return;
    }

    if (ttsState === "playing") {
      window.speechSynthesis.pause();
      setTtsState("paused");
      return;
    }

    if (ttsState === "paused") {
      window.speechSynthesis.resume();
      setTtsState("playing");
      return;
    }

    // Start new speech
    window.speechSynthesis.cancel();
    const textToRead = `${article.title}. Published by ${article.sourceName}. ${plainTextContent}`;
    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = ttsSpeed;

    utterance.onend = () => setTtsState("idle");
    utterance.onerror = () => setTtsState("idle");

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setTtsState("playing");
  }, [article, plainTextContent, ttsSpeed, ttsState]);

  const handleSpeedChange = (speed: number) => {
    setTtsSpeed(speed);
    if (ttsState === "playing") {
      stopTts();
      setTimeout(() => handleToggleTts(), 50);
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && hasPrev && onPrevArticle) {
        stopTts();
        onPrevArticle();
      } else if (e.key === "ArrowRight" && hasNext && onNextArticle) {
        stopTts();
        onNextArticle();
      }
    },
    [hasNext, hasPrev, onClose, onNextArticle, onPrevArticle, stopTts]
  );

  const handleShare = useCallback(async () => {
    if (!article) return;
    const shareData = { title: article.title, text: article.title, url: article.link };
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(article.link);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    } catch {
      /* ignore */
    }
  }, [article]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!article) return;
    const dateStr = article.pubDate ? new Date(article.pubDate).toLocaleDateString() : "";
    const md = `### [${article.title}](${article.link})\n**Source:** ${article.sourceName}${dateStr ? ` (${dateStr})` : ""}\n\n> ${article.description || plainTextContent}\n`;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(md);
        setMarkdownCopied(true);
        setTimeout(() => setMarkdownCopied(false), 2000);
      }
    } catch {
      /* ignore */
    }
  }, [article, plainTextContent]);

  // Track scroll progress for reader mode
  const handleScroll = () => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    const total = el.scrollHeight - el.clientHeight;
    if (total <= 0) {
      setReadProgress(100);
      return;
    }
    const current = Math.min(100, Math.max(0, (el.scrollTop / total) * 100));
    setReadProgress(current);
  };

  // Webview lifecycle
  useEffect(() => {
    if (!article) return;

    let active = true;
    setWebviewReady(false);
    setWebviewError(false);

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    const raf = requestAnimationFrame(() => {
      if (previewMode !== "full") return;

      void (async () => {
        if (!active || !placeholderRef.current) return;

        try {
          const allWebviews = await Webview.getAll();
          for (const wv of allWebviews) {
            if (wv.label.startsWith("news-preview-")) {
              await wv.close();
            }
          }
        } catch { /* ignore */ }

        if (!active || !placeholderRef.current) return;

        const rect = placeholderRef.current.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const uniqueLabel = "news-preview-" + Math.random().toString(36).substring(2, 9);

        try {
          const appWindow = getCurrentWindow();
          const webview = new Webview(appWindow, uniqueLabel, {
            url: article.link,
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          });

          if (!active) {
            webview.close().catch(() => {});
            return;
          }

          webviewInstRef.current = webview;
          setWebviewReady(true);

          webview.once("tauri://error", (e) => {
            console.error("[News] Webview error:", e);
            if (active) setWebviewError(true);
          });
        } catch (err) {
          console.warn("[News] Native webview unavailable, using inline reader:", err);
          if (active) setWebviewError(true);
        }
      })().catch((err) => {
        console.warn("[News] Webview lifecycle failed gracefully:", err);
        if (active) setWebviewError(true);
      });
    });

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";

      const wv = webviewInstRef.current;
      webviewInstRef.current = null;
      if (wv) {
        wv.close().catch(() => {});
      } else {
        Webview.getAll().then((all) => {
          for (const w of all) {
            if (w.label.startsWith("news-preview-")) {
              w.close().catch(() => {});
            }
          }
        }).catch(() => {});
      }
    };
  }, [article, handleKeyDown, previewMode]);

  // Geometry sync
  useEffect(() => {
    if (!placeholderRef.current || !webviewInstRef.current) return;

    const syncGeometry = () => {
      const el = placeholderRef.current;
      const wv = webviewInstRef.current;
      if (!el || !wv) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      wv.setPosition(new LogicalPosition(rect.left, rect.top)).catch(() => {});
      wv.setSize(new LogicalSize(rect.width, rect.height)).catch(() => {});
    };

    syncGeometry();

    const observer = new ResizeObserver(() => syncGeometry());
    observer.observe(placeholderRef.current);
    window.addEventListener("resize", syncGeometry);
    window.addEventListener("scroll", syncGeometry, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncGeometry);
      window.removeEventListener("scroll", syncGeometry, true);
    };
  }, [webviewReady]);

  if (!article) return null;

  const handleOpenInBrowser = () => {
    openUrl(article.link).catch(() => {
      window.open(article.link, "_blank", "noopener,noreferrer");
    });
  };

  // Rendered through a portal onto document.body so the `position: fixed`
  // backdrop is ALWAYS anchored to the viewport — page-level entrance
  // animations that leave a transform/filter on .page would otherwise turn
  // the page into the modal's containing block, centering it on the whole
  // scrollable page instead of the current scroll position.
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopTts();
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("news.articleLabel", { title: article.title })}
    >
      <div className={`modal news-preview-modal theme-${readerTheme}`}>
        {/* Reading progress bar */}
        {previewMode === "reader" && (
          <div className="news-preview-progress-track">
            <div
              className="news-preview-progress-bar"
              style={{ width: `${readProgress}%` }}
            />
          </div>
        )}

        {/* Header with Navigation Controls */}
        <div className="news-preview-header">
          <div className="news-preview-header-main">
            <div className="news-preview-header-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div className="news-preview-header-text">
              <h2 className="news-preview-title">{article.title}</h2>
              <div className="news-preview-meta">
                <span className="news-preview-source">{article.sourceName}</span>
                {article.pubDate && (
                  <>
                    <span className="news-preview-meta-dot" aria-hidden="true" />
                    <span>{formatArticleDate(article.pubDate)}</span>
                  </>
                )}
                <span className="news-preview-meta-dot" aria-hidden="true" />
                <span>⏱ {readTimeMinutes} min read ({wordCount} words)</span>
              </div>
            </div>
          </div>

          {/* Previous / Next Article Navigation */}
          <div className="news-preview-cycle-nav">
            <button
              type="button"
              className="news-preview-cycle-btn"
              onClick={() => {
                stopTts();
                onPrevArticle?.();
              }}
              disabled={!hasPrev}
              title={t("news.prevArticle")}
              aria-label={t("news.prevArticle")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              className="news-preview-cycle-btn"
              onClick={() => {
                stopTts();
                onNextArticle?.();
              }}
              disabled={!hasNext}
              title={t("news.nextArticle")}
              aria-label={t("news.nextArticle")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Controls Bar: Mode switch + TTS narration + Themes + Font size */}
        <div className="news-preview-controls-bar">
          <div className="news-preview-controls-left">
            <div className="news-preview-switch" role="tablist" aria-label={t("news.previewMode")}>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "reader"}
                className={`news-preview-switch-btn${previewMode === "reader" ? " active" : ""}`}
                onClick={() => setPreviewMode("reader")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                {t("news.previewReader")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "full"}
                className={`news-preview-switch-btn${previewMode === "full" ? " active" : ""}`}
                onClick={() => {
                  stopTts();
                  setPreviewMode("full");
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                </svg>
                {t("news.previewFullPage")}
              </button>
            </div>

            {/* Text-to-Speech (TTS) Narration Control */}
            {previewMode === "reader" && (
              <div className="news-preview-tts-group">
                <button
                  type="button"
                  className={`news-preview-tts-btn ${ttsState !== "idle" ? "speaking" : ""}`}
                  onClick={handleToggleTts}
                  title={
                    ttsState === "playing"
                      ? t("news.pauseAudio")
                      : ttsState === "paused"
                        ? t("news.resumeAudio")
                        : t("news.listenArticle")
                  }
                  aria-label={t("news.listenArticle")}
                >
                  {ttsState === "playing" ? (
                    <>
                      <div className="news-audio-waves" aria-hidden="true">
                        <span /><span /><span />
                      </div>
                      <span>{t("news.pauseAudio")}</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                      <span>{t("news.listenArticle")}</span>
                    </>
                  )}
                </button>

                {ttsState !== "idle" && (
                  <div className="news-preview-tts-speed-picker">
                    {[1.0, 1.25, 1.5].map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        className={`news-preview-speed-btn ${ttsSpeed === speed ? "active" : ""}`}
                        onClick={() => handleSpeedChange(speed)}
                      >
                        {speed}x
                      </button>
                    ))}
                    <button
                      type="button"
                      className="news-preview-speed-btn stop"
                      onClick={stopTts}
                      title="Stop audio"
                    >
                      ⏹
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reader Appearance Controls */}
          {previewMode === "reader" && (
            <div className="news-preview-controls-right">
              {/* Reader Theme Picker */}
              <div className="news-preview-theme-picker" aria-label="Reader theme">
                <button
                  type="button"
                  className={`news-preview-theme-btn dark ${readerTheme === "dark" ? "active" : ""}`}
                  onClick={() => setReaderTheme("dark")}
                  title="Dark theme"
                />
                <button
                  type="button"
                  className={`news-preview-theme-btn oled ${readerTheme === "oled" ? "active" : ""}`}
                  onClick={() => setReaderTheme("oled")}
                  title="Midnight OLED theme"
                />
                <button
                  type="button"
                  className={`news-preview-theme-btn sepia ${readerTheme === "sepia" ? "active" : ""}`}
                  onClick={() => setReaderTheme("sepia")}
                  title="Warm Sepia theme"
                />
                <button
                  type="button"
                  className={`news-preview-theme-btn slate ${readerTheme === "slate" ? "active" : ""}`}
                  onClick={() => setReaderTheme("slate")}
                  title="Slate Blue theme"
                />
              </div>

              {/* Font Family Switcher */}
              <div className="news-preview-font-family-picker" aria-label="Font family">
                <button
                  type="button"
                  className={`news-preview-ff-btn ${fontFamily === "sans" ? "active" : ""}`}
                  onClick={() => setFontFamily("sans")}
                  title="Sans-serif"
                >
                  Sans
                </button>
                <button
                  type="button"
                  className={`news-preview-ff-btn serif ${fontFamily === "serif" ? "active" : ""}`}
                  onClick={() => setFontFamily("serif")}
                  title="Serif Editorial"
                >
                  Serif
                </button>
                <button
                  type="button"
                  className={`news-preview-ff-btn mono ${fontFamily === "mono" ? "active" : ""}`}
                  onClick={() => setFontFamily("mono")}
                  title="Monospace"
                >
                  Mono
                </button>
              </div>

              {/* Font Size Adjuster */}
              <div className="news-preview-font-controls" aria-label="Font size">
                <button
                  type="button"
                  className={`news-preview-font-btn ${fontSize === "sm" ? "active" : ""}`}
                  onClick={() => setFontSize("sm")}
                  title="Small text"
                >
                  A-
                </button>
                <button
                  type="button"
                  className={`news-preview-font-btn ${fontSize === "md" ? "active" : ""}`}
                  onClick={() => setFontSize("md")}
                  title="Standard text"
                >
                  A
                </button>
                <button
                  type="button"
                  className={`news-preview-font-btn ${fontSize === "lg" ? "active" : ""}`}
                  onClick={() => setFontSize("lg")}
                  title="Large text"
                >
                  A+
                </button>
                <button
                  type="button"
                  className={`news-preview-font-btn ${fontSize === "xl" ? "active" : ""}`}
                  onClick={() => setFontSize("xl")}
                  title="Extra large text"
                >
                  A++
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        {previewMode === "reader" ? (
          <div
            ref={bodyRef}
            onScroll={handleScroll}
            className={`news-preview-body font-size-${fontSize} font-family-${fontFamily}`}
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(article.content || article.description),
            }}
          />
        ) : (
          <div className="news-preview-webview">
            <div className="news-preview-webview-bar">
              <span className="news-preview-webview-url" title={article.link}>
                {article.link}
              </span>
            </div>
            <div
              ref={placeholderRef}
              className={
                "news-preview-webview-placeholder" +
                (webviewError ? " news-preview-webview-error" : "")
              }
            >
              {!webviewReady && !webviewError && (
                <div className="news-preview-webview-loading">
                  <div className="news-preview-webview-spinner" />
                  <span>{t("news.previewLoading")}</span>
                </div>
              )}
              {webviewError && (
                <span className="news-preview-webview-error-msg">
                  {t("news.previewWebviewError")}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="news-preview-footer">
          <button
            type="button"
            className="edit-btn edit-btn-ghost"
            onClick={() => {
              stopTts();
              onClose();
            }}
          >
            {t("newsArticle.close")}
          </button>

          <div className="news-preview-footer-actions">
            {onToggleSave && (
              <button
                type="button"
                className={`news-preview-action-btn${saved ? " is-saved" : ""}`}
                onClick={() => onToggleSave(article)}
                title={saved ? t("news.removeBookmark") : t("news.saveForLater")}
                aria-label={saved ? t("news.removeBookmark") : t("news.saveForLater")}
              >
                <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                {saved ? t("news.saved") : t("common.save")}
              </button>
            )}

            <button
              type="button"
              className="news-preview-action-btn"
              onClick={handleCopyMarkdown}
              title={t("news.copyMarkdown")}
              aria-label={t("news.copyMarkdown")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <polyline points="4 7 4 4 20 4 20 7" />
                <line x1="9" y1="20" x2="15" y2="20" />
                <line x1="12" y1="4" x2="12" y2="20" />
              </svg>
              {markdownCopied ? t("gameInfo.copied") : t("news.copyQuote")}
            </button>

            <button
              type="button"
              className="news-preview-action-btn"
              onClick={handleShare}
              title={t("news.shareArticle")}
              aria-label={t("news.shareArticle")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              {shareCopied ? t("gameInfo.copied") : t("news.share")}
            </button>

            <button
              type="button"
              className="news-preview-open-btn"
              onClick={handleOpenInBrowser}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {t("newsArticle.openInBrowser")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function sanitizeHtml(html: string): string {
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  cleaned = cleaned.replace(/\son\w+="[^"]*"/gi, "");
  cleaned = cleaned.replace(/\son\w+='[^']*'/gi, "");
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  cleaned = cleaned.replace(/href=["']javascript:[^"']*["']/gi, 'href="#"');
  return cleaned;
}
