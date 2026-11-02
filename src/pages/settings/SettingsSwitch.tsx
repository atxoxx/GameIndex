interface SettingsSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name; also used as the tooltip when the row label is separate. */
  label: string;
  id?: string;
}

/**
 * SettingsSwitch — the compact on/off control used inside SettingsRow.
 *
 * It is a real checkbox with `role="switch"` (so assistive tech announces
 * on/off rather than checked/unchecked) drawn as a three-part track. The
 * visual states live in settings-ui.css.
 */
export default function SettingsSwitch({
  checked,
  onChange,
  disabled,
  label,
  id,
}: SettingsSwitchProps) {
  return (
    <label className="settings-switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settings-switch-track" aria-hidden>
        <span className="settings-switch-knob" />
      </span>
    </label>
  );
}
