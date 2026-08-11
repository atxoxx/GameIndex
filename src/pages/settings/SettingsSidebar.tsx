import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { SettingsGearIcon } from "./settingsIcons";
import type { SettingsNavGroup, SettingsSearchEntry } from "./types";

interface SettingsSidebarProps {
  groups: SettingsNavGroup[];
  /** Flat index of every searchable destination (tabs + sections). */
  searchIndex: SettingsSearchEntry[];
  /** Connected integrations count badge on the Integrations row. */
  connectedIntegrations: number;
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

/**
 * SettingsSidebar — the left rail for the settings page. Navigation is
 * a plain, predictable list of the seven tabs (each row is a route
 * link), and the search box is a command palette: it matches across
 * every tab AND every section in the catalog, shows the top results
 * with a breadcrumb, and jumps through the same `?section=` URL the
 * jump bar uses. `/` or Ctrl/Cmd+K focuses the search box.
 */
export default function SettingsSidebar({
  groups,
  searchIndex,
  connectedIntegrations,
  t,
}: SettingsSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

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

  // Close the palette when the route changes (a result was picked or
  // the user navigated away) and on outside clicks.
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

  return (
    <aside className="settings-sidebar" aria-label={t("settings.sectionsAria")}>
      <div className="settings-sidebar-head">
        <span className="settings-sidebar-title">
          <SettingsGearIcon />
          {t("settings.title")}
        </span>
      </div>

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
          <kbd className="settings-search-kbd" aria-hidden>
            /
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
              <p className="settings-search-empty">{t("settings.navEmpty")}</p>
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
                    {entry.kind === "section" && (
                      <span className="settings-search-result-kind">
                        {t("settings.onThisPage")}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      <nav className="settings-nav" aria-label={t("settings.sectionsAria")}>
        {groups.map((group) => (
          <div className="settings-nav-group" key={group.id}>
            <div className="settings-nav-group-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.tab}
                to={`/settings/${item.tab}`}
                className={({ isActive }) =>
                  `settings-nav-item${isActive ? " active" : ""}`
                }
              >
                <span className="settings-nav-item-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="settings-nav-item-label">{item.label}</span>
                {item.tab === "integrations" && connectedIntegrations > 0 && (
                  <span
                    className="settings-nav-item-badge"
                    title={t("settings.connectedCount", {
                      count: connectedIntegrations,
                    })}
                  >
                    {connectedIntegrations}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
