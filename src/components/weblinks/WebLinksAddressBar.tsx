import React, { useState, useEffect } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  BackIcon,
  ForwardIcon,
  ReloadIcon,
  HomeIcon,
  SearchIcon,
  StarIcon,
  CopyIcon,
  CheckIcon,
  OpenExternalIcon,
  ZoomInIcon,
  ZoomOutIcon,
  MaximizeViewIcon,
  MinimizeViewIcon,
} from "./WebLinksIcons";
import type { SourceDef, ViewHeightMode } from "./types";

interface WebLinksAddressBarProps {
  currentUrl: string;
  activeSourceDef: SourceDef;
  navState: { back: boolean; forward: boolean };
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onNavigate: (url: string) => void;
  onOpenExternal: (url?: string) => void;
  onPinCustomLink?: (url: string) => void;
  isPinned?: boolean;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  heightMode: ViewHeightMode;
  onToggleHeightMode: () => void;
}

export default function WebLinksAddressBar({
  currentUrl,
  activeSourceDef,
  navState,
  onGoBack,
  onGoForward,
  onReload,
  onHome,
  onNavigate,
  onOpenExternal,
  onPinCustomLink,
  isPinned = false,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  heightMode,
  onToggleHeightMode,
}: WebLinksAddressBarProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [pinnedFlash, setPinnedFlash] = useState(false);
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setInputUrl(currentUrl);
    }
  }, [currentUrl, isEditing]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = currentUrl;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch {
        // ignore
      }
      document.body.removeChild(ta);
    }
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handlePin = () => {
    if (!onPinCustomLink || isPinned) return;
    onPinCustomLink(currentUrl);
    setPinnedFlash(true);
    window.setTimeout(() => setPinnedFlash(false), 1800);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed) return;

    let target = trimmed;
    if (!/^https?:\/\//i.test(target)) {
      if (target.includes(".") && !target.includes(" ")) {
        target = `https://${target}`;
      } else {
        // Search query
        target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      }
    }
    setIsEditing(false);
    onNavigate(target);
  };

  return (
    <div
      className="wl-urlbar"
      style={{
        borderLeftColor: activeSourceDef.accent,
      }}
    >
      {/* Navigation history controls */}
      <div className="wl-urlbar-nav">
        <button
          className={`wl-urlbar-btn${navState.back ? "" : " disabled"}`}
          onClick={onGoBack}
          type="button"
          disabled={!navState.back}
          title={t("weblinks.goBack")}
          aria-label={t("weblinks.goBack")}
        >
          <BackIcon />
        </button>
        <button
          className={`wl-urlbar-btn${navState.forward ? "" : " disabled"}`}
          onClick={onGoForward}
          type="button"
          disabled={!navState.forward}
          title={t("weblinks.goForward")}
          aria-label={t("weblinks.goForward")}
        >
          <ForwardIcon />
        </button>
        <button
          className="wl-urlbar-btn"
          onClick={onReload}
          type="button"
          title={t("weblinks.reloadPreview")}
          aria-label={t("weblinks.reload")}
        >
          <ReloadIcon />
        </button>
        <button
          className="wl-urlbar-btn"
          onClick={onHome}
          type="button"
          title={t("weblinks.homeTooltip")}
          aria-label={t("weblinks.home")}
        >
          <HomeIcon />
        </button>
      </div>

      {/* Active Source Chip */}
      <span
        className="wl-urlbar-source-chip"
        style={{
          background: activeSourceDef.iconBg,
          color: activeSourceDef.accent,
          borderColor: `${activeSourceDef.accent}66`,
        }}
      >
        {activeSourceDef.label}
      </span>

      {/* Interactive Address Bar / Search Input */}
      <form className="wl-urlbar-form" onSubmit={handleSubmit}>
        <span className="wl-urlbar-search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          type="text"
          className="wl-urlbar-input"
          value={inputUrl}
          placeholder={t("weblinks.addressPlaceholder")}
          onFocus={() => setIsEditing(true)}
          onBlur={() => setIsEditing(false)}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsEditing(false);
              setInputUrl(currentUrl);
            }
          }}
        />
        {isEditing && (
          <button type="submit" className="wl-urlbar-go-btn" title={t("weblinks.navigate")}>
            {t("weblinks.navigate")}
          </button>
        )}
      </form>

      {/* Toolbar actions */}
      <div className="wl-urlbar-actions">
        {/* Pin / Star to My Links */}
        {onPinCustomLink && (
          <button
            className={`wl-urlbar-btn${isPinned || pinnedFlash ? " active-pin" : ""}`}
            onClick={handlePin}
            type="button"
            title={
              pinnedFlash
                ? t("weblinks.pinned")
                : isPinned
                ? t("weblinks.pinned")
                : t("weblinks.pinLink")
            }
            aria-label={t("weblinks.pinLink")}
          >
            <StarIcon filled={isPinned || pinnedFlash} />
          </button>
        )}

        {/* Zoom controls */}
        <div className="wl-urlbar-zoom-group">
          <button
            className="wl-urlbar-btn icon-only"
            onClick={onZoomOut}
            type="button"
            title={t("weblinks.zoomOut")}
            aria-label={t("weblinks.zoomOut")}
          >
            <ZoomOutIcon />
          </button>
          <button
            className="wl-urlbar-btn zoom-indicator"
            onClick={onZoomReset}
            type="button"
            title={t("weblinks.zoomReset")}
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <button
            className="wl-urlbar-btn icon-only"
            onClick={onZoomIn}
            type="button"
            title={t("weblinks.zoomIn")}
            aria-label={t("weblinks.zoomIn")}
          >
            <ZoomInIcon />
          </button>
        </div>

        {/* Height mode toggle (Standard / Tall / Max) */}
        <button
          className={`wl-urlbar-btn icon-only${heightMode !== "standard" ? " active" : ""}`}
          onClick={onToggleHeightMode}
          type="button"
          title={
            heightMode === "standard"
              ? t("weblinks.heightTall")
              : heightMode === "tall"
              ? t("weblinks.heightMax")
              : t("weblinks.heightStandard")
          }
          aria-label="Toggle view height"
        >
          {heightMode === "max" ? <MinimizeViewIcon /> : <MaximizeViewIcon />}
        </button>

        {/* Copy URL */}
        <button
          className={`wl-urlbar-btn${copied ? " copied" : ""}`}
          onClick={handleCopy}
          type="button"
          title={t("weblinks.copyLink")}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? t("weblinks.copied") : t("weblinks.copy")}</span>
        </button>

        {/* Open in external default browser */}
        <button
          className="wl-urlbar-btn primary"
          onClick={() => onOpenExternal(currentUrl)}
          type="button"
          title={t("weblinks.openInBrowser")}
        >
          <OpenExternalIcon />
          <span>{t("weblinks.openExternalShort")}</span>
        </button>
      </div>
    </div>
  );
}
