import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronRight, Search, X } from "lucide-react";
import { useUpdate } from "../../context/UpdateContext";
import { getCategoryForTab } from "./settingsCatalog";
import { useSettingsUi } from "./SettingsUiContext";
import { IntegrationsIcon, SettingsGearIcon } from "./settingsIcons";
import type { SettingsNavGroup, SettingsSearchEntry, SettingsTab } from "./types";

interface SettingsSidebarProps {
  groups: SettingsNavGroup[];
  activeTab: SettingsTab;
  searchIndex: SettingsSearchEntry[];
  connectedIntegrations: number;
  /** App version shown in the rail footer. */
  version: string;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

const MAX_RESULTS = 10;

/** Token-AND match so "download folder" finds the folder row even when the
 *  words are not adjacent. Returns -1 when the entry does not match. */
function matchScore(entry: SettingsSearchEntry, tokens: string[]): number {
  const label = entry.label.toLowerCase();
  const haystack = `${label} ${entry.crumb.toLowerCase()} ${entry.keywords.toLowerCase()}`;
  let best = 99;
  for (const token of tokens) {
    if (!haystack.includes(token)) return -1;
    if (label.startsWith(token)) best = Math.min(best, 0);
    else if (label.includes(token)) best = Math.min(best, 1);
    else if (entry.keywords.toLowerCase().includes(token)) best = Math.min(best, 2);
    else best = Math.min(best, 3);
  }
  return best;
}

function KindLabel({
  kind,
  t,
}: {
  kind: SettingsSearchEntry["kind"];
  t: SettingsSidebarProps["t"];
}) {
  const key =
    kind === "tab"
      ? "settings.kindTab"
      : kind === "section"
        ? "settings.kindSection"
        : "settings.kindSetting";
  return (
    <span className={`settings-rail-result-kind settings-rail-result-kind--${kind}`}>
      {t(key)}
    </span>
  );
}

/**
 * SettingsSidebar — the settings navigation rail.
 *
 * One flat, always-visible list of destinations grouped by intent, plus a
 * search field that resolves tabs, sections AND individual controls. The
 * rail is the only navigation surface: no category tabs stacked on top of
 * subtabs, so there is never a hidden third level to discover.
 */
export default function SettingsSidebar({
  groups,
  activeTab,
  searchIndex,
  connectedIntegrations,
  version,
  t,
}: SettingsSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { status: updateStatus } = useUpdate();
  const { showAdvanced, setShowAdvanced } = useSettingsUi();
  const isUpdateAvailable =
    updateStatus === "available" || updateStatus === "ready";

  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const activeCategoryId = getCategoryForTab(activeTab);

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const results = useMemo(() => {
    if (tokens.length === 0) return [];
    return searchIndex
      .map((entry) => ({ entry, score: matchScore(entry, tokens) }))
      .filter((row) => row.score >= 0)
      // Best textual match first; the kind only breaks ties (tabs are not
      // inherently more relevant than the exact control someone typed).
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        const rank = { tab: 0, section: 1, setting: 2 } as const;
        return rank[a.entry.kind] - rank[b.entry.kind];
      })
      .slice(0, MAX_RESULTS)
      .map((row) => row.entry);
  }, [searchIndex, tokens]);

  // `/` or Ctrl/Cmd+K focuses the search field from anywhere in Settings.
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
      if (e.code === "Slash" || e.key === "/") {
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

  useEffect(() => {
    setOpen(false);
    setActiveIdx(0);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = searchRef.current?.closest(".settings-rail-search");
      if (root && !root.contains(e.target as Node)) setOpen(false);
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
      return;
    }
    const section = entry.sectionId ?? entry.id;
    const highlight = entry.kind === "setting" ? `&highlight=${entry.id}` : "";
    navigate(`/settings/${entry.tab}?section=${section}${highlight}`);
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
    <aside className="settings-rail" aria-label={t("settings.title")}>
      <div className="settings-rail-head">
        <span className="settings-rail-title">
          <SettingsGearIcon />
          {t("settings.title")}
        </span>
        {connectedIntegrations > 0 && (
          <NavLink
            to="/settings/integrations"
            className="settings-rail-status"
            title={t("settings.connectedCount", { count: connectedIntegrations })}
          >
            <IntegrationsIcon />
            <span>{connectedIntegrations}</span>
          </NavLink>
        )}
      </div>

      <div className="settings-rail-search">
        <Search className="settings-rail-search-icon" size={15} aria-hidden />
        <input
          ref={searchRef}
          type="search"
          className="settings-rail-search-input"
          placeholder={t("settings.navSearch")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(e.target.value.trim().length > 0);
            setActiveIdx(0);
          }}
          onFocus={() => setOpen(query.trim().length > 0)}
          onKeyDown={onKeyDown}
          aria-label={t("settings.navSearch")}
          aria-expanded={open}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="settings-rail-search-results"
        />
        {query ? (
          <button
            type="button"
            className="settings-rail-search-clear"
            onClick={() => {
              setQuery("");
              setOpen(false);
              searchRef.current?.focus();
            }}
            aria-label={t("common.clearSearch")}
          >
            <X size={13} aria-hidden />
          </button>
        ) : (
          <kbd className="settings-rail-search-kbd" aria-hidden>
            Ctrl K
          </kbd>
        )}

        {open && (
          <div
            id="settings-rail-search-results"
            className="settings-rail-results"
            role="listbox"
            aria-label={t("settings.navSearch")}
          >
            {results.length === 0 ? (
              <div className="settings-rail-results-empty">
                <p>{t("settings.navEmpty")}</p>
                <span>{t("settings.searchTip")}</span>
              </div>
            ) : (
              results.map((entry, idx) => (
                <button
                  key={`${entry.tab}-${entry.id}`}
                  type="button"
                  role="option"
                  aria-selected={idx === activeIdx}
                  className={`settings-rail-result${idx === activeIdx ? " active" : ""}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => jumpTo(entry)}
                >
                  <span className="settings-rail-result-icon" aria-hidden>
                    {entry.icon ?? <ChevronRight size={14} />}
                  </span>
                  <span className="settings-rail-result-text">
                    <span className="settings-rail-result-label">{entry.label}</span>
                    <span className="settings-rail-result-crumb">{entry.crumb}</span>
                  </span>
                  <KindLabel kind={entry.kind} t={t} />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <nav className="settings-rail-nav" aria-label={t("settings.categoryAria")}>
        {groups.map((group) => {
          const isActiveGroup = group.id === activeCategoryId;
          return (
            <div
              key={group.id}
              className={`settings-rail-group${isActiveGroup ? " is-active" : ""}`}
            >
              <p className="settings-rail-group-label">{group.label}</p>
              {group.items.map((item) => {
                const isActive = item.tab === activeTab;
                const showConnected =
                  item.tab === "integrations" && connectedIntegrations > 0;
                const showUpdate = item.tab === "general" && isUpdateAvailable;
                return (
                  <NavLink
                    key={item.tab}
                    to={`/settings/${item.tab}`}
                    className={`settings-rail-item${isActive ? " active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    title={item.hint}
                  >
                    <span className="settings-rail-item-icon" aria-hidden>
                      {item.icon}
                    </span>
                    <span className="settings-rail-item-text">
                      <span className="settings-rail-item-label">{item.label}</span>
                      {isActive && item.hint && (
                        <span className="settings-rail-item-hint">{item.hint}</span>
                      )}
                    </span>
                    {showConnected && (
                      <span className="settings-rail-item-badge">
                        {connectedIntegrations}
                      </span>
                    )}
                    {showUpdate && (
                      <span className="settings-rail-item-badge settings-rail-item-badge--update">
                        {t("settings.updateBadge")}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="settings-rail-footer">
        <label className="settings-rail-essentials">
          <span className="settings-rail-essentials-text">
            <span className="settings-rail-essentials-title">
              {t("settings.essentialsToggle")}
            </span>
            <span className="settings-rail-essentials-desc">
              {t("settings.essentialsToggleDesc")}
            </span>
          </span>
          <input
            type="checkbox"
            className="settings-rail-switch"
            checked={!showAdvanced}
            onChange={(e) => setShowAdvanced(!e.target.checked)}
            aria-label={t("settings.essentialsToggle")}
          />
          <span className="settings-rail-switch-track" aria-hidden>
            <Check size={11} />
          </span>
        </label>
        <div className="settings-rail-meta">
          {version ? (
            <span>{t("settings.versionLabel", { version })}</span>
          ) : (
            <span />
          )}
          {updateStatus === "available" && (
            <NavLink to="/settings/general?section=general-updates">
              {t("settings.updateAvailableShort")}
            </NavLink>
          )}
        </div>
      </div>
    </aside>
  );
}
