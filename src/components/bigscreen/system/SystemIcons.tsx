// SystemIcons — inline-SVG glyphs for the System hub's left menu.
// Repo convention: inline SVG only. Paths mirror the shell registry
// sections (src/bigscreen/registry.tsx) so the hub menu stays
// visually consistent with the header strip.

import type { ReactNode } from "react";

function SystemIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export type SystemSectionId =
  | "downloads"
  | "storage"
  | "achievements"
  | "settings"
  | "mods"
  | "emulators"
  | "docs";

export const SYSTEM_ICONS: Record<SystemSectionId, ReactNode> = {
  downloads: <SystemIcon><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></SystemIcon>,
  storage: <SystemIcon><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></SystemIcon>,
  achievements: <SystemIcon><circle cx="12" cy="8" r="5" /><path d="m8.5 12.5-1 8 4.5-2.5 4.5 2.5-1-8" /></SystemIcon>,
  settings: <SystemIcon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.6 1Z" /></SystemIcon>,
  mods: <SystemIcon><path d="M8 5h8l2 4v10H6V9l2-4Z" /><path d="M9 5v4h6V5" /><path d="M9 13h6M9 16h4" /></SystemIcon>,
  emulators: <SystemIcon><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M8 12h4M10 10v4M16 11h.01M18 13h.01" /></SystemIcon>,
  docs: <SystemIcon><path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v4h4M8 11h8M8 15h8" /></SystemIcon>,
};
