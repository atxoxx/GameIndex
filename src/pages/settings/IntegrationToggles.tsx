interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}

/**
 * Shared two-line toggle (bold label + muted hint + checkbox) used by
 * both the Humble and Ubisoft integration tiles. `disabled` dims the
 * whole row and blocks interaction.
 */
function Toggle({ label, hint, checked, disabled, onChange }: ToggleProps) {
  return (
    <label className={`humble-toggle ${disabled ? "disabled" : ""}`}>
      <span className="humble-toggle-text">
        <span className="humble-toggle-label">{label}</span>
        {hint && <span className="humble-toggle-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function HumbleToggle(props: ToggleProps) {
  return <Toggle {...props} />;
}

export function UplayToggle(props: ToggleProps) {
  return <Toggle {...props} />;
}
