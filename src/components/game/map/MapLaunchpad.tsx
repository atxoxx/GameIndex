import { ExternalLink, Map as MapIcon, MapPinned, Search } from "lucide-react";
import { Button } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { MapSourceResult } from "../../../types/game";
import { IconMap } from "../icons";

/** Provider front doors used when no map matches. */
const PROVIDER_HOMES: { id: string; label: string; url: string }[] = [
  { id: "mapgenie", label: "MapGenie", url: "https://mapgenie.io" },
  { id: "gamemaps", label: "GameMaps", url: "https://www.gamemaps.com" },
  { id: "gamemappers", label: "GameMappers", url: "https://gamemappers.net" },
  { id: "wand", label: "Wand", url: "https://wand.com/en/maps" },
  { id: "gamemapscom", label: "Game-Maps", url: "https://www.game-maps.com" },
];

export interface MapLaunchpadProps {
  sources: MapSourceResult[];
  /** Name used for the current lookup. */
  query: string;
  searching: boolean;
  searchError: boolean;
  /** provider id → last chosen map URL */
  remembered: Record<string, string>;
  canReset: boolean;
  onOpenProvider: (source: MapSourceResult, mapUrl: string) => void;
  onOpenExternal: (url: string) => void;
  onSearchAnother: () => void;
  onResetLookup: () => void;
}

/**
 * The Map tab's landing surface.
 *
 * Every provider that matched gets a card with its map list, so a game with
 * several regions/sub-maps can be entered at the right one. A provider that
 * has no match is still reachable through its front door below.
 */
export default function MapLaunchpad({
  sources,
  query,
  searching,
  searchError,
  remembered,
  canReset,
  onOpenProvider,
  onOpenExternal,
  onSearchAnother,
  onResetLookup,
}: MapLaunchpadProps) {
  const { t } = useLanguage();

  if (searching) {
    return (
      <div className="map-launchpad__state" role="status">
        <span className="map-launchpad__spinner" aria-hidden="true" />
        <p>{t("map.searching", { name: query })}</p>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="map-launchpad__state map-launchpad__state--empty">
        <span className="map-launchpad__state-icon" aria-hidden="true">
          <MapIcon size={26} />
        </span>
        <h3>{searchError ? t("map.searchError") : t("map.noResults", { name: query })}</h3>
        <p>{t("map.noResultsHint")}</p>
        <div className="map-launchpad__state-actions">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Search size={14} />}
            onClick={onSearchAnother}
          >
            {t("map.searchOpen")}
          </Button>
          {canReset && (
            <Button variant="ghost" size="sm" onClick={onResetLookup}>
              {t("map.searchReset")}
            </Button>
          )}
        </div>
        <div className="map-launchpad__directory">
          <span>{t("map.browseProviders")}</span>
          <div>
            {PROVIDER_HOMES.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => onOpenExternal(provider.url)}
                title={t("map.openSite", { provider: provider.label })}
              >
                {provider.label}
                <ExternalLink size={11} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="map-launchpad">
      <div className="map-launchpad__grid">
        {sources.map((source) => {
          const maps = source.maps.length > 0 ? source.maps : [{ title: t("map.mapList"), url: source.url }];
          const seen = new Set<string>();
          const uniqueMaps = maps.filter((map) => {
            if (seen.has(map.url)) return false;
            seen.add(map.url);
            return true;
          });
          const rememberedUrl = remembered[source.id];
          const preferred = rememberedUrl && seen.has(rememberedUrl)
            ? rememberedUrl
            : source.url;

          return (
            <article className="map-provider" key={source.id}>
              <header className="map-provider__head">
                <span className="map-provider__icon" aria-hidden="true">
                  <IconMap size={17} />
                </span>
                <span className="map-provider__titles">
                  <span className="map-provider__label">{source.label}</span>
                  <span className="map-provider__title" title={source.title}>
                    {source.title}
                  </span>
                </span>
                <button
                  type="button"
                  className="map-provider__external"
                  onClick={() => onOpenExternal(source.url)}
                  title={t("map.openOnProvider", { provider: source.label })}
                  aria-label={t("map.openOnProvider", { provider: source.label })}
                >
                  <ExternalLink size={14} />
                </button>
              </header>

              <div className="map-provider__maps">
                {uniqueMaps.map((map) => {
                  const isRemembered = map.url === rememberedUrl;
                  return (
                    <button
                      key={map.url}
                      type="button"
                      className={`map-provider__map${isRemembered ? " is-remembered" : ""}`}
                      onClick={() => onOpenProvider(source, map.url)}
                    >
                      <MapPinned size={13} aria-hidden="true" />
                      <span>{map.title}</span>
                      {isRemembered && (
                        <span className="map-provider__last">{t("map.lastUsed")}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <Button
                variant="secondary"
                size="sm"
                className="map-provider__open"
                onClick={() => onOpenProvider(source, preferred)}
              >
                {t("map.openMap")}
              </Button>
            </article>
          );
        })}
      </div>

      <div className="map-launchpad__providers">
        <span>{t("map.browseProviders")}</span>
        <div>
          {PROVIDER_HOMES.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => onOpenExternal(provider.url)}
              title={t("map.openSite", { provider: provider.label })}
            >
              {provider.label}
              <ExternalLink size={11} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
