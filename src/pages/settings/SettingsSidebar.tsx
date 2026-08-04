import { useEffect, useRef } from "react";
import { SettingsGearIcon } from "./settingsIcons";
import type { SettingsNavGroup, SettingsTab } from "./types";

interface SettingsSidebarProps {
  groups: SettingsNavGroup[];
  activeTab: SettingsTab;
  activeAnchor: string | null;
  navQuery: string;
  onQueryChange: (q: string) => void;
  onNavigate: (tab: SettingsTab, anchor?: string) => void;
  /** Connected integrations count badge for the connections group. */
  connectedIntegrations: number;
  /** anchor-id → connected map for the green status dots. */
  connectionStatus: Record<string, boolean>;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

/**
 * SettingsSidebar — the grouped, searchable left rail. A contained
 * glass panel with a brand top edge; every destination (tab or in-tab
 * anchor) is a row with an icon chip, and the connections group shows a
 * live connected-count pill plus green dots on linked stores. Pressing
 * `/` (or Ctrl/Cmd+K) focuses the search box.
 */
export default function SettingsSidebar({
  groups,
  activeTab,
  activeAnchor,
  navQuery,
  onQueryChange,
  onNavigate,
  connectedIntegrations,
  connectionStatus,
  t,
}: SettingsSidebarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  // `/` or Ctrl/Cmd+K focuses search (unless the user is typing in a
  // field, a modal is open, or the page is in big-screen mode).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
      // Don't steal the key while a dialog/modal is open.
      if (document.querySelector('[role="dialog"]')) return;
      const isSlash = e.code === "Slash" || e.key === "/";
      if (isSlash) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const normalizedQuery = navQuery.trim().toLowerCase();

  const groupMatches = (g: SettingsNavGroup) =>
    normalizedQuery === "" ||
    g.label.toLowerCase().includes(normalizedQuery) ||
    g.items.some(
      (it) =>
        it.label.toLowerCase().includes(normalizedQuery) ||
        it.keywords.toLowerCase().includes(normalizedQuery),
    );

  const itemMatches = (it: SettingsNavGroup["items"][number]) =>
    normalizedQuery === "" ||
    it.label.toLowerCase().includes(normalizedQuery) ||
    it.keywords.toLowerCase().includes(normalizedQuery);

  return (
    <aside className="settings-sidebar" aria-label={t("settings.sectionsAria")}>
      <div className="settings-sidebar-head">
        <span className="settings-sidebar-title">
          <SettingsGearIcon />
          {t("settings.title")}
        </span>
        {connectedIntegrations > 0 && (
          <span className="settings-sidebar-count" title={t("settings.connectedCount", { count: connectedIntegrations })}>
            <span className="settings-sidebar-count-dot" aria-hidden />
            {connectedIntegrations}
          </span>
        )}
      </div>

      <div className="settings-search">
        <svg
          className="settings-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          className="settings-search-input"
          placeholder={t("settings.navSearch")}
          value={navQuery}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label={t("settings.navSearch")}
        />
        {navQuery ? (
          <button
            type="button"
            className="settings-search-clear"
            onClick={() => onQueryChange("")}
            aria-label={t("common.clearSearch")}
          >
            ×
          </button>
        ) : (
          <kbd className="settings-search-kbd" aria-hidden>
            /
          </kbd>
        )}
      </div>

      <nav className="settings-nav" aria-label={t("settings.sectionsAria")}>
        {groups.filter(groupMatches).map((group) => {
          const items = group.items.filter(itemMatches);
          if (items.length === 0) return null;
          return (
            <div className="settings-nav-group" key={group.id}>
              <div className="settings-nav-group-label">{group.label}</div>
              {items.map((item) => {
                const isActive =
                  activeTab === item.tab && (item.anchor ?? null) === activeAnchor;
                return (
                  <button
                    key={`${item.tab}-${item.anchor ?? ""}`}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    className={`settings-nav-item${isActive ? " active" : ""}`}
                    onClick={() => onNavigate(item.tab, item.anchor)}
                  >
                    {item.icon ? (
                      <span className="settings-nav-item-icon">{item.icon}</span>
                    ) : (
                      <span className="settings-nav-item-bullet" aria-hidden />
                    )}
                    <span className="settings-nav-item-label">{item.label}</span>
                    {connectionStatus[item.anchor ?? ""] ? (
                      <span className="settings-nav-item-dot" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
        {normalizedQuery !== "" && groups.filter(groupMatches).length === 0 && (
          <p className="settings-nav-empty">{t("settings.navEmpty")}</p>
        )}
      </nav>
    </aside>
  );
}
