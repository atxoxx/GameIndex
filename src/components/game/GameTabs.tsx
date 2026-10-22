import type { ComponentType, ReactNode } from "react";
import { SubTabs } from "../ui/SubTabs";

export interface GameTabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  count?: number | null;
  /** Optional status indicator rendered after the label. */
  badge?: ReactNode;
}

export interface GameTabsProps<T extends string = string> {
  tabs: GameTabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  className?: string;
  ariaLabel?: string;
}

/**
 * GameTabs — thin adapter over the shared `SubTabs` primitive.
 *
 * All detail pages now ride the same undelimited strip (labels in the page
 * flow, one sliding accent underline), so this keeps the historic
 * `tabs`/`activeTab` prop names without a second implementation of the
 * scroll-centering and keyboard logic.
 */
export default function GameTabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  className,
  ariaLabel = "Game navigation tabs",
}: GameTabsProps<T>) {
  return (
    <SubTabs
      items={tabs}
      value={activeTab}
      onChange={onChange}
      ariaLabel={ariaLabel}
      sticky
      className={["game-tabs", className ?? ""].filter(Boolean).join(" ")}
    />
  );
}
