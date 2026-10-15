import { Check, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "../ui";

/**
 * Small building blocks shared by every setup-wizard step. Keeping the
 * toggle/option chrome here means each step only describes *what* it
 * offers, and the info affordances stay consistent: every row and card
 * carries an "i" that explains precisely what enabling it does.
 */

/** The little info icon + tooltip used to describe an item precisely. */
export function SetupInfo({ tip }: { tip: ReactNode }) {
  return (
    <Tooltip content={tip} placement="top" maxWidth={300}>
      <span
        className="setup-info"
        role="img"
        tabIndex={-1}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Info size={14} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

interface SetupSectionProps {
  title: string;
  desc?: ReactNode;
  tip?: ReactNode;
  children: ReactNode;
}

export function SetupSection({ title, desc, tip, children }: SetupSectionProps) {
  return (
    <section className="setup-section">
      <h3 className="setup-section__title">
        {title}
        {tip && <SetupInfo tip={tip} />}
      </h3>
      {desc && <p className="setup-section__desc">{desc}</p>}
      <div className="setup-section__body">{children}</div>
    </section>
  );
}

interface SetupToggleProps {
  title: ReactNode;
  desc?: ReactNode;
  tip?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function SetupToggle({
  title,
  desc,
  tip,
  checked,
  disabled,
  onChange,
}: SetupToggleProps) {
  return (
    <div className={`setup-toggle${disabled ? " is-disabled" : ""}`}>
      <div className="setup-toggle__text">
        <span className="setup-toggle__title">
          {title}
          {tip && <SetupInfo tip={tip} />}
        </span>
        {desc && <span className="setup-toggle__desc">{desc}</span>}
      </div>
      <label className="setup-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="setup-switch__track" aria-hidden="true" />
      </label>
    </div>
  );
}

interface SetupOptionCardProps {
  title: ReactNode;
  desc?: ReactNode;
  badge?: ReactNode;
  tip?: ReactNode;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A selectable card (single-choice) with an optional badge + info icon. */
export function SetupOptionCard({
  title,
  desc,
  badge,
  tip,
  selected,
  disabled,
  onSelect,
}: SetupOptionCardProps) {
  return (
    <button
      type="button"
      className={`setup-option${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="setup-option__head">
        <span className="setup-option__title">
          {title}
          {tip && <SetupInfo tip={tip} />}
        </span>
        {badge && <span className="setup-option__badge">{badge}</span>}
      </span>
      {desc && <span className="setup-option__desc">{desc}</span>}
      {selected && (
        <span className="setup-option__check" aria-hidden="true">
          <Check size={14} />
        </span>
      )}
    </button>
  );
}
