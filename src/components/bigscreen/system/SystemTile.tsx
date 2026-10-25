// SystemTile — one card on the System hub's tile landing.
// Owns its focusable registration (rules-of-hooks safety) and
// navigates to the section's own route.

import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useFocusable } from "../../../hooks/useFocusable";

export default function SystemTile({
  path,
  label,
  icon,
}: {
  path: string;
  label: string;
  icon: ReactNode;
}) {
  const navigate = useNavigate();
  const focusProps = useFocusable(() => navigate(path));

  return (
    <button type="button" className="bigscreen-system-tile" {...focusProps}>
      <span className="bigscreen-system-tile-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="bigscreen-system-tile-label">{label}</span>
      <span className="bigscreen-system-tile-chevron" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}
