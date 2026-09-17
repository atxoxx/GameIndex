import type { ReactNode } from "react";
import { useFocusProps } from "./focusable";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

function SegmentedButton<T extends string>({
  option,
  active,
  onSelect,
}: {
  option: SegmentedOption<T>;
  active: boolean;
  onSelect: () => void;
}) {
  const focus = useFocusProps(onSelect);
  return (
    <button
      ref={focus.ref}
      tabIndex={focus.tabIndex}
      type="button"
      className={`act-seg__btn${active ? " act-seg__btn--active" : ""}`}
      aria-pressed={active}
      title={option.title}
      onClick={focus.onClick}
    >
      {option.label}
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div
      className={`act-seg act-seg--${size}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <SegmentedButton
          key={opt.value}
          option={opt}
          active={value === opt.value}
          onSelect={() => onChange(opt.value)}
        />
      ))}
    </div>
  );
}
