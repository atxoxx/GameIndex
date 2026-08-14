import React, { useRef } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { CustomLinkIcon } from "./WebLinksIcons";
import { MY_LINKS_KEY } from "./sources";
import type { SourceDef } from "./types";

interface WebLinksSourceStripProps {
  sources: SourceDef[];
  activeSourceKey: string;
  onSelectSource: (key: string) => void;
  customLinksCount: number;
  showMyLinksTab?: boolean;
}

export default function WebLinksSourceStrip({
  sources,
  activeSourceKey,
  onSelectSource,
  customLinksCount,
  showMyLinksTab = true,
}: WebLinksSourceStripProps) {
  const { t } = useLanguage();
  const stripRef = useRef<HTMLDivElement>(null);

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
    tabs[next]?.click();
    tabs[next]?.focus();
  };

  const isMyLinksActive = activeSourceKey === MY_LINKS_KEY;

  return (
    <div
      ref={stripRef}
      className="wl-source-tabs"
      role="tablist"
      aria-label="Web sources"
      onKeyDown={handleKeyDown}
    >
      {sources.map((src) => {
        const isActive = activeSourceKey === src.key;
        return (
          <button
            key={src.key}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            className={`wl-source-tab${isActive ? " active" : ""}`}
            onClick={() => onSelectSource(src.key)}
            style={
              isActive
                ? {
                    color: src.accent,
                    borderBottomColor: src.accent,
                    background: `linear-gradient(180deg, ${src.iconBg}44, transparent)`,
                  }
                : undefined
            }
          >
            <span
              className="wl-source-tab-icon"
              style={{
                background: isActive ? src.iconBg : "var(--color-bg-tertiary)",
                color: isActive ? src.accent : "inherit",
              }}
            >
              {src.icon}
            </span>
            <span className="wl-source-tab-label">{src.label}</span>
          </button>
        );
      })}

      {showMyLinksTab && (
        <button
          key={MY_LINKS_KEY}
          role="tab"
          tabIndex={isMyLinksActive ? 0 : -1}
          aria-selected={isMyLinksActive}
          className={`wl-source-tab mylinks${isMyLinksActive ? " active" : ""}`}
          onClick={() => onSelectSource(MY_LINKS_KEY)}
          style={
            isMyLinksActive
              ? {
                  color: "var(--color-accent)",
                  borderBottomColor: "var(--color-accent)",
                  background:
                    "linear-gradient(180deg, var(--color-accent-soft), transparent)",
                }
              : undefined
          }
        >
          <span className="wl-source-tab-icon">
            <CustomLinkIcon />
          </span>
          <span className="wl-source-tab-label">{t("weblinks.myLinks")}</span>
          {customLinksCount > 0 && (
            <span className="wl-source-tab-count">{customLinksCount}</span>
          )}
        </button>
      )}
    </div>
  );
}
