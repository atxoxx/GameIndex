import { useMemo, useState } from "react";
import type { Game } from "../../types/game";
import { IconCheck, IconGlobe, IconX } from "./icons";
import { useLanguage } from "../../context/LanguageContext";

/**
 * LanguagesSection
 *
 *  Right-sidebar card listing the languages the game supports and
 *  which features (interface / audio / subtitles) each one has.
 *  Includes instant search filtering when a game supports many languages.
 */

interface LanguagesSectionProps {
  game: Game;
}

interface LangFlags {
  interface: boolean;
  audio: boolean;
  subtitles: boolean;
}

export default function LanguagesSection({ game }: LanguagesSectionProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  const languages = useMemo(() => {
    if (!game.languageSupports || game.languageSupports.length === 0) return null;
    const map: Record<string, LangFlags> = {};
    for (const ls of game.languageSupports) {
      if (!ls.language) continue;
      if (!map[ls.language]) {
        map[ls.language] = { interface: false, audio: false, subtitles: false };
      }
      const type = ls.supportType ? ls.supportType.toLowerCase() : "";
      if (type === "interface") map[ls.language].interface = true;
      else if (type === "audio") map[ls.language].audio = true;
      else if (type === "subtitles") map[ls.language].subtitles = true;
    }
    const list = Object.keys(map).sort();
    return list.length > 0 ? { list, map } : null;
  }, [game.languageSupports]);

  if (!languages) return null;

  const filteredList = languages.list.filter((l) =>
    l.toLowerCase().includes(search.toLowerCase().trim())
  );

  const displayList = expanded || search.trim() ? filteredList : filteredList.slice(0, 8);
  const showExpandButton = !search.trim() && filteredList.length > 8;

  return (
    <section className="game-section languages-section">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconGlobe size={16} />
        </span>
        {t("lang.title")}
        <span className="game-section-title__count">{languages.list.length}</span>
      </h2>

      {languages.list.length > 8 && (
        <div className="languages-search-wrap">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="languages-search-icon"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="languages-search-input"
            placeholder={t("lang.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="languages-search-clear"
              onClick={() => setSearch("")}
              aria-label={t("common.clear")}
            >
              <IconX size={12} />
            </button>
          )}
        </div>
      )}

      <div className="languages-table-wrap">
        <table className="languages-table">
          <thead>
            <tr>
              <th>{t("lang.column.language")}</th>
              <th className="lang-th-center">{t("lang.column.interface")}</th>
              <th className="lang-th-center">{t("lang.column.audio")}</th>
              <th className="lang-th-center">{t("lang.column.subtitles")}</th>
            </tr>
          </thead>
          <tbody>
            {displayList.map((lang) => {
              const flags = languages.map[lang];
              return (
                <tr key={lang}>
                  <td className="lang-name">{lang}</td>
                  <td className="lang-cell-center">
                    {flags.interface ? (
                      <IconCheck size={14} style={{ color: "var(--color-success)" }} />
                    ) : (
                      <IconX size={14} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                    )}
                  </td>
                  <td className="lang-cell-center">
                    {flags.audio ? (
                      <IconCheck size={14} style={{ color: "var(--color-success)" }} />
                    ) : (
                      <IconX size={14} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                    )}
                  </td>
                  <td className="lang-cell-center">
                    {flags.subtitles ? (
                      <IconCheck size={14} style={{ color: "var(--color-success)" }} />
                    ) : (
                      <IconX size={14} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                    )}
                  </td>
                </tr>
              );
            })}
            {displayList.length === 0 && (
              <tr>
                <td colSpan={4} className="lang-empty-search">
                  {t("common.noResults")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showExpandButton && (
        <button
          type="button"
          className="languages-expand-btn"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded
            ? t("common.showLess")
            : t("common.showMoreCount", { count: filteredList.length - 8 })}
        </button>
      )}
    </section>
  );
}
