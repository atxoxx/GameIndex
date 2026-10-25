export interface GameTabChipItem<T extends string = string> {
  id: T;
  label: string;
  count?: number | null;
  tone?: "default" | "warning" | "success";
}

export interface GameTabChipsProps<T extends string = string> {
  items: GameTabChipItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
}

/** Filter chips — a filter is a mode, not a navigation tab. */
export default function GameTabChips<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: GameTabChipsProps<T>) {
  return (
    <div
      className={["game-tab-chips", className ?? ""].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            className={[
              "game-tab-chip",
              active ? "is-active" : "",
              item.tone ? `game-tab-chip--${item.tone}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={active}
            onClick={() => onChange(item.id)}
          >
            <span>{item.label}</span>
            {item.count !== undefined && item.count !== null && item.count > 0 && (
              <span className="game-tab-chip__count">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
