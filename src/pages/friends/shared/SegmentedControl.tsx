import type { ComponentType, KeyboardEvent, ReactNode } from "react";

export interface SegmentedItem<T extends string> {
  id: T;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
  trailing?: ReactNode;
}

/**
 * Nested navigation inside a hub tab (Play / Stats). Deliberately lighter
 * than SubTabs: a compact inset tray, so the page never reads as two
 * competing navigation bars.
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
  trailing,
}: SegmentedControlProps<T>) {
  // Same roving-tabindex keys as the shared SubTabs, so the nested Play / Stats
  // trays can be driven from the keyboard too.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    const index = items.findIndex((item) => item.id === value);
    if (index === -1) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = items[nextIndex];
    onChange(next.id);
    const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[nextIndex]?.focus();
  };

  return (
    <div className={["friends-segmented", className ?? ""].filter(Boolean).join(" ")}>
      <div
        className="friends-segmented__group"
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={["friends-segmented__item", active ? "is-active" : ""].filter(Boolean).join(" ")}
              onClick={() => onChange(item.id)}
            >
              {Icon && <Icon size={14} className="friends-segmented__icon" />}
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className="friends-segmented__count">{item.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {trailing && <div className="friends-segmented__trailing">{trailing}</div>}
    </div>
  );
}

export default SegmentedControl;
