import type { ComponentType } from "react";

export interface GameTabViewItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ComponentType<{ size?: number }>;
}

export interface GameTabViewSwitchProps<T extends string = string> {
  items: GameTabViewItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}

/** Compact segmented view switch used in the command row. */
export default function GameTabViewSwitch<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
}: GameTabViewSwitchProps<T>) {
  return (
    <div className="game-tab-views" role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            className={`game-tab-views__btn${active ? " is-active" : ""}`}
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            title={item.label}
          >
            {Icon && <Icon size={14} />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
