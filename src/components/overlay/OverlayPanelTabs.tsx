/** One selectable section in the expanded overlay panel. */
export interface OverlayPanelTab {
  id: string;
  label: string;
}

export interface OverlayPanelTabsProps {
  tabs: OverlayPanelTab[];
  active: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
}

/**
 * Tab bar for the expanded panel. Sits below the draggable header, so every
 * button opts out of the drag region to stay clickable. Each tab is
 * individually focusable and activated with Enter/Space.
 */
export default function OverlayPanelTabs({
  tabs,
  active,
  onSelect,
  ariaLabel,
}: OverlayPanelTabsProps) {
  return (
    <div
      className="overlay-panel__tabs"
      role="tablist"
      aria-label={ariaLabel}
      data-tauri-drag-region="false"
      data-testid="overlay-panel-tabs"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`overlay-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`overlay-tabpanel-${tab.id}`}
            className={[
              "overlay-panel__tab",
              selected ? "overlay-panel__tab--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-tauri-drag-region="false"
            data-testid={`overlay-panel-tab-${tab.id}`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
