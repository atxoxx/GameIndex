import type { ComponentType } from "react";

export interface ActivityViewItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  /** Optional count rendered as a quiet badge after the label. */
  count?: number;
}

export interface ActivityViewSwitchProps<T extends string = string> {
  items: ActivityViewItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
}

/** Compact view switch used inside an Activity panel or tab. */
export function ActivityViewSwitch<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: ActivityViewSwitchProps<T>) {
  return (
    <div
      className={["activity-views", className ?? ""].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            className={`activity-views__btn${active ? " is-active" : ""}`}
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            title={item.label}
          >
            {Icon && <Icon size={14} />}
            <span>{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span className="activity-views__count">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default ActivityViewSwitch;
