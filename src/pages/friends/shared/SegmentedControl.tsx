import type { ComponentType, ReactNode } from "react";

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
  return (
    <div className={["friends-segmented", className ?? ""].filter(Boolean).join(" ")}>
      <div className="friends-segmented__group" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
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
