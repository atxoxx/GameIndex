import type { JSX } from "react";
import { Search, Star, X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { InterfacePageKey } from "../../../context/interfaceLayout";
import { STUDIO_PAGE_ICON } from "./studioIcons";
import {
  groupStudioSearchResults,
  searchStudioIndex,
  STUDIO_NAV_GROUPS,
  studioScopeLabel,
  type StudioSearchEntry,
} from "./studioScopes";
import "./StudioRail.css";

export interface StudioRailProps {
  activePage: InterfacePageKey;
  hiddenCountForPage: (page: InterfacePageKey) => number;
  landingPage: InterfacePageKey;
  searchIndex: StudioSearchEntry[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelectPage: (page: InterfacePageKey) => void;
  onSelectSearchResult: (entry: StudioSearchEntry) => void;
}

export function StudioRail({
  activePage,
  hiddenCountForPage,
  landingPage,
  searchIndex,
  query,
  onQueryChange,
  onSelectPage,
  onSelectSearchResult,
}: StudioRailProps): JSX.Element {
  const { t } = useLanguage();

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const results = isSearching ? searchStudioIndex(searchIndex, query) : [];
  const resultGroups = groupStudioSearchResults(results);

  return (
    <div className="studio-rail">
      <div className="studio-rail__top">
        <div className="studio-rail__head">
          <h3 className="studio-rail__title">{t("settings.studio.railTitle")}</h3>
          <p className="studio-rail__hint">{t("settings.studio.railHint")}</p>
        </div>

        <div className="studio-rail__search">
          <Search size={14} className="studio-rail__search-icon" aria-hidden="true" />
          <input
            type="search"
            className="studio-rail__input"
            value={query}
            placeholder={t("settings.studio.searchPlaceholder")}
            aria-label={t("settings.studio.searchPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="studio-rail__clear"
              onClick={() => onQueryChange("")}
              aria-label={t("settings.studio.searchClear")}
              title={t("settings.studio.searchClear")}
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {isSearching ? (
        <div className="studio-rail__results">
          <p className="studio-rail__results-count" aria-live="polite">
            {t("settings.studio.searchResults", { count: results.length })}
          </p>

          {resultGroups.length === 0 ? (
            <p className="studio-rail__empty">
              {t("settings.studio.searchEmpty", { query: trimmedQuery })}
            </p>
          ) : (
            resultGroups.map((group) => (
              <div className="studio-rail__group" key={group.scope}>
                <span className="studio-rail__group-title">{studioScopeLabel(group.scope, t)}</span>
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="studio-rail__result"
                    title={t("settings.studio.searchJumpHint")}
                    onClick={() => onSelectSearchResult(entry)}
                  >
                    <span className="studio-rail__result-label">{entry.label}</span>
                    <span className="studio-rail__result-hint">{entry.hint}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="studio-rail__groups">
          {STUDIO_NAV_GROUPS.map((group) => (
            <div className="studio-rail__group" key={group.id}>
              <span className="studio-rail__group-title">{t(group.labelKey)}</span>
              {group.pages.map((page) => {
                const PageIcon = STUDIO_PAGE_ICON[page];
                const hiddenCount = hiddenCountForPage(page);
                const isActive = page === activePage;

                return (
                  <button
                    key={page}
                    type="button"
                    className={`studio-rail__item${isActive ? " is-active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => onSelectPage(page)}
                  >
                    <PageIcon size={14} className="studio-rail__item-icon" aria-hidden="true" />
                    <span className="studio-rail__item-label">{studioScopeLabel(page, t)}</span>
                    {hiddenCount > 0 && (
                      <span
                        className="studio-rail__count"
                        title={t("settings.studio.hiddenCountTooltip")}
                        aria-label={t("settings.studio.hiddenCount", { count: hiddenCount })}
                      >
                        {hiddenCount}
                      </span>
                    )}
                    {page === landingPage && (
                      <span
                        className="studio-rail__star"
                        title={t("settings.interface.isLandingPage")}
                        role="img"
                        aria-label={t("settings.interface.isLandingPage")}
                      >
                        <Star size={12} fill="currentColor" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
