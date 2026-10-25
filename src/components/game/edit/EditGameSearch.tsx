import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { CornerDownLeft, Search, X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { EDIT_AREAS, SEARCH_FIELDS, type EditSearchField } from "./editRegistry";
import { AREA_FOR_SECTION, type EditSectionKey } from "./draftKeys";

interface SearchResult {
  id: string;
  label: string;
  areaLabel: string;
  sectionLabel: string;
  section: EditSectionKey;
  fieldId?: string;
}

/** Field/section index used by the header search box. */
export function EditGameSearch({
  inputRef,
  onJump,
  showCompatibility,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onJump: (section: EditSectionKey, fieldId?: string) => void;
  showCompatibility: boolean;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const areas = useMemo(
    () =>
      EDIT_AREAS.filter(
        (area) => area.key !== "compatibility" || showCompatibility,
      ),
    [showCompatibility],
  );

  const sectionEntries = useMemo(
    () =>
      areas.flatMap((area) =>
        area.sections.map((section) => ({
          id: `section:${section.key}`,
          label: t(section.labelKey),
          areaLabel: t(area.labelKey),
          sectionLabel: t(section.labelKey),
          section: section.key,
          keywords: [t(section.descKey)],
        })),
      ),
    [areas, t],
  );

  const availableFields = useMemo(
    () =>
      SEARCH_FIELDS.filter(
        (field) =>
          showCompatibility || AREA_FOR_SECTION[field.section] !== "compatibility",
      ),
    [showCompatibility],
  );

  const results = useMemo<SearchResult[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const matchesField = (field: EditSearchField) => {
      const label = t(field.labelKey).toLowerCase();
      if (label.includes(needle)) return true;
      if (field.keywords?.some((word) => word.toLowerCase().includes(needle))) return true;
      return false;
    };

    const sectionMatches: SearchResult[] = sectionEntries
      .filter(
        (entry) =>
          entry.label.toLowerCase().includes(needle) ||
          entry.keywords.some((word) => word.toLowerCase().includes(needle)),
      )
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        areaLabel: entry.areaLabel,
        sectionLabel: entry.sectionLabel,
        section: entry.section,
      }));

    const fieldMatches: SearchResult[] = availableFields.filter(matchesField).map((field) => {
      const area = areas.find((item) =>
        item.sections.some((section) => section.key === field.section),
      );
      const section = areas.flatMap((item) => item.sections).find(
        (item) => item.key === field.section,
      );
      return {
        id: field.id,
        label: t(field.labelKey),
        areaLabel: area ? t(area.labelKey) : "",
        sectionLabel: section ? t(section.labelKey) : "",
        section: field.section,
        fieldId: field.id,
      };
    });

    return [...sectionMatches, ...fieldMatches].slice(0, 12);
  }, [availableFields, areas, query, sectionEntries, t]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const pick = (result: SearchResult) => {
    onJump(result.section, result.fieldId);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query) {
        setQuery("");
        setOpen(false);
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (!query) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        results.length ? (index - 1 + results.length) % results.length : 0,
      );
    } else if (event.key === "Enter") {
      const result = results[activeIndex];
      if (result) {
        event.preventDefault();
        pick(result);
      }
    }
  };

  const showPanel = open && query.trim().length > 0;

  return (
    <div className="edit-search" ref={rootRef}>
      <Search size={15} className="edit-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="edit-search-input"
        value={query}
        placeholder={t("edit.searchPlaceholder")}
        aria-label={t("edit.searchPlaceholder")}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="edit-search-results"
        aria-autocomplete="list"
        aria-activedescendant={
          showPanel && results[activeIndex] ? `edit-search-${results[activeIndex].id}` : undefined
        }
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {query ? (
        <button
          type="button"
          className="edit-search-clear"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          aria-label={t("common.clear")}
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : (
        <kbd className="edit-search-kbd" aria-hidden="true">
          /
        </kbd>
      )}

      {showPanel && (
        <div className="edit-search-panel" id="edit-search-results" role="listbox">
          {results.length === 0 ? (
            <p className="edit-search-empty">{t("edit.searchNoResults", { query })}</p>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                id={`edit-search-${result.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`edit-search-result${index === activeIndex ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(result)}
              >
                <span className="edit-search-result-label">{result.label}</span>
                <span className="edit-search-result-path">
                  {result.areaLabel} <span aria-hidden="true">›</span> {result.sectionLabel}
                </span>
                {index === activeIndex && (
                  <CornerDownLeft size={13} className="edit-search-enter" aria-hidden="true" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
