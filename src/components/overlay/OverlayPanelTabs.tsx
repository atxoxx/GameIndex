import type { KeyboardEvent, ReactNode } from "react";

/** One selectable sub-view in a multi-widget panel section. */
export interface OverlayPanelTab {
  id: string;
  label: string;
  icon?: ReactNode;
}

export interface OverlayPanelTabsProps {
  tabs: OverlayPanelTab[];
  active: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
}

/**
 * Segmented sub-tabs for a panel section that owns several widgets
 * (Captures → Screenshots / Clips, Activity → Achievements / Downloads /
 * Notifications). The buttons opt out of the window drag region so they stay
 * clickable, and Arrow keys move between them.
 */
export default function OverlayPanelTabs({
  tabs,
  active,
  onSelect,
  ariaLabel,
}: OverlayPanelTabsProps) {
  const move = (event: KeyboardEvent<HTMLDivElement>, delta: number) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    if (index === -1) return;
    event.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    onSelect(next.id);
    const el = event.currentTarget.querySelector<HTMLButtonElement>(
      `[data-tab-id="${next.id}"]`,
    );
    el?.focus();
  };

  return (
    <div
      className="overlay-subtabs"
      role="tablist"
      aria-label={ariaLabel}
      data-tauri-drag-region="false"
      data-testid="overlay-panel-tabs"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") move(event, 1);
        if (event.key === "ArrowLeft") move(event, -1);
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`overlay-subtab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`overlay-subtabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            data-tab-id={tab.id}
            className={[
              "overlay-subtabs__tab",
              selected ? "overlay-subtabs__tab--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-tauri-drag-region="false"
            data-testid={`overlay-subtab-${tab.id}`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.icon && (
              <span className="overlay-subtabs__icon">{tab.icon}</span>
            )}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
