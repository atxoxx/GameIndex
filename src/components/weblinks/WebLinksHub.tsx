import { ArrowUpRight, CornerDownRight, Plus, Settings2 } from "lucide-react";
import { Badge, Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import type { Game } from "../../types/game";
import {
  SOURCE_CATEGORIES,
  buildUrl,
  formatUrlForDisplay,
  type ParsedCustomLink,
} from "./sources";
import type { SourceCategoryKey, SourceDef } from "./types";

const HUB_CATEGORIES: SourceCategoryKey[] = [
  "stores",
  "wikis",
  "community",
  "modding",
];

export interface WebLinksHubProps {
  game: Game;
  sources: SourceDef[];
  customLinks: ParsedCustomLink[];
  activeCategory: SourceCategoryKey;
  query: string;
  lastSource: SourceDef | null;
  appId: string | null;
  editable: boolean;
  onOpenSource: (source: SourceDef) => void;
  onOpenCustom: (link: ParsedCustomLink) => void;
  onOpenExternal: (url: string) => void;
  onManageLinks: () => void;
}

/**
 * The Web Links landing hub.
 *
 * Instead of dropping the reader into a webview, the tab opens on a map of
 * every place worth visiting for this game: official stores, wikis, community
 * sites, modding tools and the reader's own links. Each card opens the
 * existing in-tab preview browser.
 */
export default function WebLinksHub({
  game,
  sources,
  customLinks,
  activeCategory,
  query,
  lastSource,
  appId,
  editable,
  onOpenSource,
  onOpenCustom,
  onOpenExternal,
  onManageLinks,
}: WebLinksHubProps) {
  const { t } = useLanguage();
  const needle = query.trim().toLowerCase();

  const matches = (source: SourceDef) =>
    !needle ||
    source.label.toLowerCase().includes(needle) ||
    (source.url ?? "").toLowerCase().includes(needle);

  const categoryLabel = (key: SourceCategoryKey) =>
    t(
      SOURCE_CATEGORIES.find((category) => category.key === key)?.i18nKey ??
        "weblinks.categories.all",
    );

  const visibleCustom = customLinks.filter(
    (link) =>
      !needle ||
      link.label.toLowerCase().includes(needle) ||
      link.host.toLowerCase().includes(needle) ||
      (link.tag ?? "").toLowerCase().includes(needle),
  );

  const showCustom = activeCategory === "all" || activeCategory === "mylinks";

  const visibleFixed = sources.filter(
    (source) =>
      (activeCategory === "all" || source.category === activeCategory) &&
      matches(source),
  );

  return (
    <div className="wl-hub">
      {lastSource && !needle && (
        <button
          type="button"
          className="wl-hub-resume"
          onClick={() => onOpenSource(lastSource)}
        >
          <span
            className="wl-hub-card__icon"
            style={{
              background: lastSource.iconBg,
              color: lastSource.accent,
            }}
          >
            {lastSource.icon}
          </span>
          <span className="wl-hub-resume__text">
            <span className="wl-hub-resume__eyebrow">
              {t("weblinks.hub.resumeEyebrow")}
            </span>
            <span className="wl-hub-resume__title">{lastSource.label}</span>
          </span>
          <CornerDownRight size={16} aria-hidden="true" />
        </button>
      )}

      {HUB_CATEGORIES.map((category) => {
        if (activeCategory !== "all" && activeCategory !== category) return null;
        const list = sources.filter(
          (source) => source.category === category && matches(source),
        );
        if (list.length === 0) return null;
        return (
          <section className="wl-hub-section" key={category}>
            <header className="wl-hub-section__head">
              <h3>{categoryLabel(category)}</h3>
              <span>{list.length}</span>
            </header>
            <div className="wl-hub-grid">
              {list.map((source) => {
                const url = buildUrl(game, source.key, "store", appId);
                return (
                  <article className="wl-hub-card" key={source.key}>
                    <button
                      type="button"
                      className="wl-hub-card__open"
                      onClick={() => onOpenSource(source)}
                    >
                      <span
                        className="wl-hub-card__icon"
                        style={{
                          background: source.iconBg,
                          color: source.accent,
                        }}
                      >
                        {source.icon}
                      </span>
                      <span className="wl-hub-card__text">
                        <span className="wl-hub-card__title">{source.label}</span>
                        <span className="wl-hub-card__host">
                          {formatUrlForDisplay(url)}
                        </span>
                      </span>
                      <CornerDownRight
                        size={14}
                        className="wl-hub-card__go"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className="wl-hub-card__external"
                      onClick={() => onOpenExternal(url)}
                      title={t("weblinks.openInBrowser")}
                      aria-label={t("weblinks.openInBrowser")}
                    >
                      <ArrowUpRight size={14} />
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {showCustom && (
        <section className="wl-hub-section">
          <header className="wl-hub-section__head">
            <h3>{categoryLabel("mylinks")}</h3>
            <span>{customLinks.length}</span>
            {editable && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Settings2 size={14} />}
                onClick={onManageLinks}
              >
                {t("weblinks.hub.manage")}
              </Button>
            )}
          </header>

          {visibleCustom.length === 0 ? (
            <div className="wl-hub-empty">
              <Badge variant="default" size="sm">
                <Plus size={11} aria-hidden="true" /> {t("weblinks.myLinks")}
              </Badge>
              <p>{t("weblinks.noCustomLinksBody")}</p>
              {editable && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={onManageLinks}
                >
                  {t("weblinks.addLink")}
                </Button>
              )}
            </div>
          ) : (
            <div className="wl-hub-grid">
              {visibleCustom.map((link) => (
                <article className="wl-hub-card" key={link.raw}>
                  <button
                    type="button"
                    className="wl-hub-card__open"
                    onClick={() => onOpenCustom(link)}
                  >
                    <span className="wl-hub-card__icon wl-hub-card__icon--link">
                      {link.label.charAt(0).toUpperCase()}
                    </span>
                    <span className="wl-hub-card__text">
                      <span className="wl-hub-card__title">{link.label}</span>
                      <span className="wl-hub-card__host">{link.host}</span>
                    </span>
                    <CornerDownRight
                      size={14}
                      className="wl-hub-card__go"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    className="wl-hub-card__external"
                    onClick={() => onOpenExternal(link.url)}
                    title={t("weblinks.openInBrowser")}
                    aria-label={t("weblinks.openInBrowser")}
                  >
                    <ArrowUpRight size={14} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {visibleFixed.length === 0 && visibleCustom.length === 0 && (
        <p className="wl-hub-noresults">{t("weblinks.hub.noResults")}</p>
      )}

      <p className="wl-footnote wl-hub-footnote">
        <span>{t("weblinks.footnote")}</span>
        <button type="button" onClick={onManageLinks} disabled={!editable}>
          {t("weblinks.myLinks")}
        </button>
      </p>
    </div>
  );
}
