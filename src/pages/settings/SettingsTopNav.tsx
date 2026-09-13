import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useUpdate } from "../../context/UpdateContext";
import { IntegrationsIcon, SettingsGearIcon } from "./settingsIcons";
import { getCategoryForTab } from "./settingsCatalog";
import type { SettingsNavGroup, SettingsSearchEntry, SettingsTab } from "./types";

interface SettingsTopNavProps {
  groups: SettingsNavGroup[];
  activeTab: SettingsTab;
  /** Flat index of every searchable destination (tabs + sections). */
  searchIndex: SettingsSearchEntry[];
  /** Connected integrations count badge on the Integrations tab. */
  connectedIntegrations: number;
  showSubtabs: boolean;
  onToggleSubtabs: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

const MAX_RESULTS = 8;

/** Rank matches: label prefix first, then label contains, then keywords. */
function matchScore(entry: SettingsSearchEntry, q: string): number {
  const label = entry.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  if (entry.keywords.toLowerCase().includes(q)) return 2;
  return -1;
}

function SubtabsLayoutIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      {collapsed ? (
        <path d="m9 14 3 3 3-3" />
      ) : (
        <path d="m15 16-3-3-3 3" />
      )}
    </svg>
  );
}

/**
 * SettingsTopNav — the top-level navigation shell for Settings.
 * Organizes settings into two responsive, dynamic tiers:
 *   1. Primary Category Tabs (Personalize, Connections, Downloads, System)
 *      with quick search command palette and status badges.
 *   2. Dynamic Secondary Subtabs for the active category, with
 *      interactive hide/show toggle and smooth animations.
 */
export default function SettingsTopNav({
  groups,
  activeTab,
  searchIndex,
  connectedIntegrations,
  showSubtabs,
  onToggleSubtabs,
  t,
}: SettingsTopNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { status: updateStatus } = useUpdate();
  const isUpdateAvailable = updateStatus === "available" || updateStatus === "ready";

  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const activeCategoryId = getCategoryForTab(activeTab);
  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeCategoryId) ?? groups[0],
    [groups, activeCategoryId],
  );

  const activeSubtabItem = useMemo(
    () => activeGroup?.items.find((item) => item.tab === activeTab),
    [activeGroup, activeTab],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (normalizedQuery.length === 0) return [];
    return searchIndex
      .map((entry) => ({ entry, score: matchScore(entry, normalizedQuery) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.entry);
  }, [searchIndex, normalizedQuery]);

  // `/` or Ctrl/Cmd+K focuses search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
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

  // Close the palette when the route changes and on outside clicks.
  useEffect(() => {
    setOpen(false);
    setActiveIdx(0);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = searchRef.current?.parentElement;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const jumpTo = (entry: SettingsSearchEntry) => {
    setQuery("");
    setOpen(false);
    searchRef.current?.blur();
    if (entry.kind === "tab") {
      navigate(`/settings/${entry.tab}`);
    } else {
      navigate(`/settings/${entry.tab}?section=${entry.id}`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[activeIdx] ?? results[0];
      if (pick) jumpTo(pick);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      setOpen(false);
    }
  };

  const handleSelectCategory = (groupId: string) => {
    if (groupId === activeCategoryId) return;
    const targetGroup = groups.find((g) => g.id === groupId);
    if (targetGroup && targetGroup.items.length > 0) {
      navigate(`/settings/${targetGroup.items[0].tab}`);
    }
  };

  return (
    <nav className="settings-topnav-bar" aria-label={t("settings.categoryAria")}>
      {/* Primary Row: Brand + Category Tabs + Search + Controls */}
      <div className="settings-topnav-primary">
        {/* Brand / Section title */}
        <div className="settings-topnav-brand">
          <SettingsGearIcon />
          <span>{t("settings.title")}</span>
        </div>

        {/* Categories Tablist */}
        <div
          className="settings-category-tabs"
          role="tablist"
          aria-label={t("settings.categoryAria")}
        >
          {groups.map((group) => {
            const isCategoryActive = group.id === activeCategoryId;
            const hasConnected =
              group.id === "connections" && connectedIntegrations > 0;
            const hasUpdate = group.id === "system" && isUpdateAvailable;

            return (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={isCategoryActive}
                className={`settings-category-tab${isCategoryActive ? " active" : ""}`}
                onClick={() => handleSelectCategory(group.id)}
              >
                {group.icon && (
                  <span className="settings-category-tab-icon" aria-hidden>
                    {group.icon}
                  </span>
                )}
                <span className="settings-category-tab-label">{group.label}</span>

                {hasConnected && (
                  <span
                    className="settings-category-tab-badge"
                    title={t("settings.connectedCount", { count: connectedIntegrations })}
                  >
                    {connectedIntegrations}
                  </span>
                )}
                {hasUpdate && (
                  <span
                    className="settings-category-tab-badge settings-category-tab-badge--highlight"
                    title={t("updater.newVersionAvailable", { version: "" })}
                  >
                    !
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right side cluster: Search + Subtabs Toggle */}
        <div className="settings-topnav-actions">
          {/* Search box with command palette */}
          <div className="settings-search" onKeyDown={onKeyDown}>
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
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(e.target.value.trim().length > 0);
                setActiveIdx(0);
              }}
              aria-label={t("settings.navSearch")}
              aria-expanded={open}
              role="combobox"
              aria-autocomplete="list"
              aria-controls="settings-search-results"
            />
            {query ? (
              <button
                type="button"
                className="settings-search-clear"
                onClick={() => {
                  setQuery("");
                  setOpen(false);
                  searchRef.current?.focus();
                }}
                aria-label={t("common.clearSearch")}
              >
                ×
              </button>
            ) : (
              <kbd
                className="settings-search-kbd"
                aria-hidden
                title="Press Ctrl+K or / to search"
              >
                Ctrl+K
              </kbd>
            )}

            {open && (
              <div
                id="settings-search-results"
                className="settings-search-results"
                role="listbox"
                aria-label={t("settings.navSearch")}
              >
                {results.length === 0 ? (
                  <div className="settings-search-empty-wrap">
                    <p className="settings-search-empty">{t("settings.navEmpty")}</p>
                    <p className="settings-search-tip">
                      Try searching for <em>theme</em>, <em>steam</em>, <em>language</em>, <em>bandwidth</em>, or <em>plugins</em>.
                    </p>
                  </div>
                ) : (
                  results.map((entry, idx) => {
                    const isActive = idx === activeIdx;
                    return (
                      <button
                        key={`${entry.tab}-${entry.id}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={`settings-search-result${isActive ? " active" : ""}`}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => jumpTo(entry)}
                      >
                        {entry.icon ? (
                          <span className="settings-search-result-icon" aria-hidden>
                            {entry.icon}
                          </span>
                        ) : (
                          <span className="settings-search-result-dot" aria-hidden />
                        )}
                        <span className="settings-search-result-text">
                          <span className="settings-search-result-label">
                            {entry.label}
                          </span>
                          <span className="settings-search-result-crumb">
                            {entry.crumb}
                          </span>
                        </span>
                        <span
                          className={`settings-search-result-kind settings-search-result-kind--${entry.kind}`}
                        >
                          {entry.kind === "tab" ? "Tab" : t("settings.onThisPage")}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Quick status pill if integrations connected */}
          {connectedIntegrations > 0 && (
            <NavLink
              to="/settings/integrations"
              className="settings-topnav-status-pill"
              title={t("settingsPage.connected")}
            >
              <IntegrationsIcon />
              <span className="settings-topnav-status-dot" aria-hidden />
              <span>{connectedIntegrations}</span>
            </NavLink>
          )}

          {/* Subtabs Hide/Show Toggle */}
          <button
            type="button"
            className={`settings-subtabs-toggle${showSubtabs ? " active" : ""}`}
            onClick={onToggleSubtabs}
            title={t(showSubtabs ? "settings.hideSubtabs" : "settings.showSubtabs")}
            aria-label={t(showSubtabs ? "settings.hideSubtabs" : "settings.showSubtabs")}
            aria-pressed={showSubtabs}
          >
            <SubtabsLayoutIcon collapsed={!showSubtabs} />
            <span className="settings-subtabs-toggle-label">
              {t(showSubtabs ? "settings.hideSubtabs" : "settings.showSubtabs")}
            </span>
          </button>
        </div>
      </div>

      {/* Secondary Row: Dynamic Subtabs Strip (Collapsible) */}
      <div
        className={`settings-subtabs-strip-container${
          showSubtabs ? "" : " settings-subtabs-strip-container--collapsed"
        }`}
        aria-hidden={!showSubtabs}
      >
        <div
          className="settings-subtabs-bar"
          role="tablist"
          aria-label={t("settings.subtabsAria")}
        >
          {activeGroup?.items.map((item) => {
            const isSubtabActive = item.tab === activeTab;
            return (
              <NavLink
                key={item.tab}
                to={`/settings/${item.tab}`}
                role="tab"
                aria-selected={isSubtabActive}
                className={({ isActive }) =>
                  `settings-subtab-item${isActive ? " active" : ""}`
                }
              >
                <span className="settings-subtab-item-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="settings-subtab-item-label">{item.label}</span>

                {/* Subtab Badges */}
                {item.tab === "integrations" && connectedIntegrations > 0 && (
                  <span
                    className="settings-subtab-item-badge"
                    title={t("settings.connectedCount", { count: connectedIntegrations })}
                  >
                    {connectedIntegrations}
                  </span>
                )}
                {item.tab === "general" && isUpdateAvailable && (
                  <span
                    className="settings-subtab-item-badge settings-subtab-item-badge--highlight"
                    title={t("updater.newVersionAvailable", { version: "" })}
                  >
                    Update
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* Compact breadcrumb pill shown only when subtabs are hidden */}
      {!showSubtabs && activeSubtabItem && (
        <div className="settings-compact-subtab-indicator">
          <span className="settings-compact-subtab-label">
            {t("settings.compactSubtab")}:
          </span>
          <span className="settings-compact-subtab-chip">
            <span className="settings-compact-subtab-icon" aria-hidden>
              {activeSubtabItem.icon}
            </span>
            <span>{activeSubtabItem.label}</span>
          </span>
        </div>
      )}
    </nav>
  );
}
