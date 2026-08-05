interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}

/**
 * Shared two-line toggle (bold label + muted hint + pill switch) used by
 * both the Humble and Ubisoft integration tiles. `disabled` dims the
 * whole row and blocks interaction.
 *
 * The native checkbox stays in the DOM as an invisible, focusable hit
 * target layered over the CSS-drawn track/thumb so keyboard focus and
 * reduced-motion preferences keep working.
 */
function Toggle({ label, hint, checked, disabled, onChange }: ToggleProps) {
  return (
    <label className={`humble-toggle${disabled ? " disabled" : ""}`}>
      <span className="humble-toggle-text">
        <span className="humble-toggle-label">{label}</span>
        {hint && <span className="humble-toggle-hint">{hint}</span>}
      </span>
      <span className="humble-toggle-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="humble-toggle-track" aria-hidden>
          <span className="humble-toggle-thumb" />
        </span>
      </span>
    </label>
  );
}

export function HumbleToggle(props: ToggleProps) {
  return <Toggle {...props} />;
}

export function UplayToggle(props: ToggleProps) {
  return <Toggle {...props} />;
}
