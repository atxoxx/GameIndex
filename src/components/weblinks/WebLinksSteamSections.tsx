import React, { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { STEAM_SECTIONS } from "./sources";
import { LockIcon } from "./WebLinksIcons";
import type { SteamSectionKey } from "./types";

interface WebLinksSteamSectionsProps {
  activeSection: SteamSectionKey;
  onSelectSection: (section: SteamSectionKey) => void;
  appId: string | null;
  onAttachAppId?: (appId: string) => void;
}

export default function WebLinksSteamSections({
  activeSection,
  onSelectSection,
  appId,
  onAttachAppId,
}: WebLinksSteamSectionsProps) {
  const { t } = useLanguage();
  const [showAttachInput, setShowAttachInput] = useState(false);
  const [inputVal, setInputVal] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    );
    if (tabs.length === 0) return;
    const current = tabs.findIndex((tab) => tab.tabIndex === 0);
    let next = current;

    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;

    e.preventDefault();
    const target = tabs[next];
    if (target && !target.disabled) {
      target.click();
      target.focus();
    }
  };

  const handleApplyAppId = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim();
    if (!trimmed) return;

    // Check if user entered a full Steam URL (e.g., https://store.steampowered.com/app/1091500/...)
    const urlMatch = trimmed.match(/store\.steampowered\.com\/app\/(\d+)/i);
    const parsedId = urlMatch ? urlMatch[1] : trimmed.replace(/[^0-9]/g, "");

    if (parsedId && onAttachAppId) {
      onAttachAppId(parsedId);
      setShowAttachInput(false);
      setInputVal("");
    }
  };

  return (
    <div className="wl-steam-container">
      <div
        className="wl-steam-subtabs"
        role="tablist"
        aria-label="Steam sections"
        onKeyDown={handleKeyDown}
      >
        {STEAM_SECTIONS.map((sec) => {
          const isActive = activeSection === sec.key;
          const disabled = !!sec.requiresAppId && !appId;

          return (
            <button
              key={sec.key}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-disabled={disabled}
              disabled={disabled}
              className={`wl-steam-subtab${isActive ? " active" : ""}${
                disabled ? " disabled" : ""
              }`}
              onClick={() => !disabled && onSelectSection(sec.key)}
              title={disabled ? t("weblinks.steamAppIdNotDetected") : undefined}
            >
              <span className="wl-steam-subtab-icon">{sec.icon}</span>
              <span>{t(sec.i18nKey)}</span>
              {disabled && (
                <span className="wl-steam-subtab-lock" aria-hidden="true">
                  <LockIcon />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!appId && onAttachAppId && (
        <div className="wl-appid-quick-bar">
          {!showAttachInput ? (
            <button
              type="button"
              className="wl-appid-quick-btn"
              onClick={() => setShowAttachInput(true)}
            >
              {t("weblinks.linkAppId")}
            </button>
          ) : (
            <form className="wl-appid-quick-form" onSubmit={handleApplyAppId}>
              <input
                type="text"
                className="wl-appid-quick-input"
                placeholder={t("weblinks.linkAppIdPlaceholder")}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                autoFocus
              />
              <button type="submit" className="wl-appid-quick-submit" disabled={!inputVal.trim()}>
                {t("weblinks.linkAppIdSubmit")}
              </button>
              <button
                type="button"
                className="wl-appid-quick-cancel"
                onClick={() => {
                  setShowAttachInput(false);
                  setInputVal("");
                }}
              >
                {t("weblinks.cancel")}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
