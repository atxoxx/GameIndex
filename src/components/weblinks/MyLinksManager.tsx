import React, { useState, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  CustomLinkIcon,
  OpenExternalIcon,
  EditIcon,
  TrashIcon,
  SearchIcon,
  TagIcon,
  RedditIcon,
  SpeedrunIcon,
  NexusModsIcon,
} from "./WebLinksIcons";
import { deriveCustomLinkMeta } from "./sources";
import type { Game } from "../../types/game";
import { slugify } from "../../types/game";

interface MyLinksManagerProps {
  game: Game;
  customLinks: string[];
  activePreviewUrl: string | null;
  editable: boolean;
  onSelectPreviewUrl: (url: string) => void;
  onOpenExternal: (url: string) => void;
  onWebsitesChange?: (websites: string[]) => void;
}

interface ParsedCustomLink {
  rawUrl: string;
  url: string;
  label: string;
  host: string;
  tag?: string;
}

/** Parse a stored website item (either raw URL or serialized JSON metadata) */
function parseCustomLinkItem(raw: string): ParsedCustomLink {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj.url) {
        const meta = deriveCustomLinkMeta(obj.url);
        return {
          rawUrl: raw,
          url: obj.url,
          label: obj.label || meta.label,
          host: meta.host,
          tag: obj.tag,
        };
      }
    } catch {
      // fallback to plain string
    }
  }

  const meta = deriveCustomLinkMeta(trimmed);
  return {
    rawUrl: raw,
    url: trimmed,
    label: meta.label,
    host: meta.host,
  };
}

/** Serialize custom link item for storage in game.websites string[] */
function serializeCustomLink(url: string, label?: string, tag?: string): string {
  const meta = deriveCustomLinkMeta(url);
  if ((label && label !== meta.label) || tag) {
    return JSON.stringify({ url, label: label || meta.label, tag });
  }
  return url;
}

/** Multi-fallback Favicon component */
function CustomFavicon({ host }: { host: string }) {
  const [stage, setStage] = useState<"google" | "duckduckgo" | "fallback">("google");

  if (stage === "fallback" || !host) {
    return (
      <span className="wl-mylink-favicon-fallback">
        <CustomLinkIcon />
      </span>
    );
  }

  const src =
    stage === "google"
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
      : `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;

  return (
    <img
      className="wl-mylink-favicon-img"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (stage === "google") setStage("duckduckgo");
        else setStage("fallback");
      }}
    />
  );
}

export default function MyLinksManager({
  game,
  customLinks,
  activePreviewUrl,
  editable,
  onSelectPreviewUrl,
  onOpenExternal,
  onWebsitesChange,
}: MyLinksManagerProps) {
  const { t } = useLanguage();

  const [urlInput, setUrlInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<ParsedCustomLink | null>(null);

  const parsedItems = useMemo(() => {
    return customLinks.map(parseCustomLinkItem);
  }, [customLinks]);

  const filteredItems = useMemo(() => {
    if (!searchFilter.trim()) return parsedItems;
    const q = searchFilter.toLowerCase();
    return parsedItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.host.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        (item.tag && item.tag.toLowerCase().includes(q))
    );
  }, [parsedItems, searchFilter]);

  const handleAddOrUpdateLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onWebsitesChange) return;

    let trimmedUrl = urlInput.trim();
    if (!trimmedUrl) return;

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      trimmedUrl = `https://${trimmedUrl}`;
    }

    try {
      new URL(trimmedUrl);
    } catch {
      setLinkError(t("weblinks.addLinkInvalid"));
      return;
    }

    const trimmedLabel = labelInput.trim();
    const trimmedTag = tagInput.trim();

    if (editingItem) {
      // Update existing item
      const updated = customLinks.map((raw) => {
        if (raw === editingItem.rawUrl) {
          return serializeCustomLink(trimmedUrl, trimmedLabel, trimmedTag);
        }
        return raw;
      });
      onWebsitesChange(updated);
      setEditingItem(null);
    } else {
      // Prevent duplicates
      if (
        parsedItems.some(
          (item) => item.url.toLowerCase() === trimmedUrl.toLowerCase()
        )
      ) {
        setLinkError(t("weblinks.addLinkInvalid"));
        return;
      }
      const newItem = serializeCustomLink(trimmedUrl, trimmedLabel, trimmedTag);
      onWebsitesChange([...customLinks, newItem]);
    }

    setUrlInput("");
    setLabelInput("");
    setTagInput("");
    setLinkError(null);
    onSelectPreviewUrl(trimmedUrl);
  };

  const handleStartEdit = (item: ParsedCustomLink) => {
    setEditingItem(item);
    setUrlInput(item.url);
    setLabelInput(item.label);
    setTagInput(item.tag || "");
    setLinkError(null);
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
    setUrlInput("");
    setLabelInput("");
    setTagInput("");
    setLinkError(null);
  };

  const handleRemove = (rawUrl: string) => {
    if (!onWebsitesChange) return;
    onWebsitesChange(customLinks.filter((u) => u !== rawUrl));
    if (editingItem?.rawUrl === rawUrl) {
      handleCancelEdit();
    }
  };

  const handleAddPreset = (presetType: string) => {
    if (!onWebsitesChange) return;
    let url = "";
    let label = "";
    let tag = "Community";

    const gameSlug = slugify(game.name);

    switch (presetType) {
      case "reddit":
        url = `https://www.reddit.com/r/${gameSlug.replace(/-/g, "")}/`;
        label = `r/${gameSlug.replace(/-/g, "")}`;
        tag = "Reddit";
        break;
      case "wiki":
        url = `https://${gameSlug.replace(/-/g, "")}.fandom.com/`;
        label = `${game.name} Wiki`;
        tag = "Wiki";
        break;
      case "speedrun":
        url = `https://www.speedrun.com/${gameSlug.replace(/-/g, "_")}`;
        label = "Speedrun.com";
        tag = "Leaderboards";
        break;
      case "modpack":
        url = `https://next.nexusmods.com/games/${gameSlug.replace(/-/g, "")}/collections`;
        label = "Nexus Collections";
        tag = "Mods";
        break;
    }

    if (!url) return;
    if (parsedItems.some((item) => item.url.toLowerCase() === url.toLowerCase())) return;

    const newItem = serializeCustomLink(url, label, tag);
    onWebsitesChange([...customLinks, newItem]);
    onSelectPreviewUrl(url);
  };

  return (
    <div className="wl-mylinks">
      {/* Add / Edit Form */}
      {editable && (
        <div className="wl-mylinks-editor-card">
          <form className="wl-mylinks-form" onSubmit={handleAddOrUpdateLink}>
            <div className="wl-mylinks-form-row">
              <input
                className="wl-mylinks-add-input url-field"
                type="text"
                placeholder={t("weblinks.addLinkPlaceholder")}
                aria-label={t("weblinks.addLink")}
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (linkError) setLinkError(null);
                }}
              />
              <input
                className="wl-mylinks-add-input label-field"
                type="text"
                placeholder={t("weblinks.addTitlePlaceholder")}
                aria-label="Custom link label"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
              />
              <input
                className="wl-mylinks-add-input tag-field"
                type="text"
                placeholder={t("weblinks.addTagPlaceholder")}
                aria-label="Tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
              />
              <button
                className="wl-mylinks-add-btn primary"
                type="submit"
                disabled={!urlInput.trim()}
              >
                {editingItem ? t("weblinks.saveLink") : t("weblinks.addLink")}
              </button>
              {editingItem && (
                <button
                  className="wl-mylinks-add-btn secondary"
                  type="button"
                  onClick={handleCancelEdit}
                >
                  {t("weblinks.cancel")}
                </button>
              )}
            </div>

            {linkError && <div className="wl-mylinks-add-error">{linkError}</div>}

            {/* Quick Presets Bar */}
            <div className="wl-mylinks-presets-bar">
              <span className="wl-mylinks-presets-label">{t("weblinks.presetsTitle")}:</span>
              <button
                type="button"
                className="wl-preset-chip"
                onClick={() => handleAddPreset("reddit")}
              >
                {RedditIcon}
                <span>{t("weblinks.presetReddit")}</span>
              </button>
              <button
                type="button"
                className="wl-preset-chip"
                onClick={() => handleAddPreset("wiki")}
              >
                <CustomLinkIcon />
                <span>{t("weblinks.presetWiki")}</span>
              </button>
              <button
                type="button"
                className="wl-preset-chip"
                onClick={() => handleAddPreset("speedrun")}
              >
                {SpeedrunIcon}
                <span>{t("weblinks.presetSpeedrun")}</span>
              </button>
              <button
                type="button"
                className="wl-preset-chip"
                onClick={() => handleAddPreset("modpack")}
              >
                {NexusModsIcon}
                <span>{t("weblinks.presetModpack")}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter / Search header when user has multiple custom links */}
      {parsedItems.length > 3 && (
        <div className="wl-mylinks-search-row">
          <div className="wl-mylinks-search-wrapper">
            <SearchIcon />
            <input
              type="text"
              className="wl-mylinks-search-input"
              placeholder={t("weblinks.searchLinksPlaceholder")}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>
          <span className="wl-mylinks-count">
            {t("weblinks.linkCount", { count: filteredItems.length })}
          </span>
        </div>
      )}

      {/* Empty State */}
      {filteredItems.length === 0 ? (
        <div className="wl-mylinks-empty">
          <span className="wl-mylinks-empty-icon">
            <CustomLinkIcon />
          </span>
          <div className="wl-mylinks-empty-text">
            <h4>{t("weblinks.noCustomLinks")}</h4>
            <p>{t("weblinks.noCustomLinksBody")}</p>
          </div>
        </div>
      ) : (
        /* Cards Grid */
        <div className="wl-mylinks-grid">
          {filteredItems.map((item) => {
            const isActive = activePreviewUrl === item.url;
            return (
              <div
                key={item.rawUrl}
                className={`wl-mylink-card${isActive ? " active" : ""}`}
              >
                <button
                  type="button"
                  className="wl-mylink-card-main"
                  onClick={() => onSelectPreviewUrl(item.url)}
                  title={t("weblinks.openInPreview")}
                >
                  <span className="wl-mylink-favicon">
                    <CustomFavicon host={item.host} />
                  </span>
                  <span className="wl-mylink-card-text">
                    <span className="wl-mylink-card-label-row">
                      <span className="wl-mylink-card-label">{item.label}</span>
                      {item.tag && (
                        <span className="wl-mylink-tag-badge">
                          <TagIcon />
                          {item.tag}
                        </span>
                      )}
                    </span>
                    <span className="wl-mylink-card-host">{item.host}</span>
                  </span>
                </button>

                <div className="wl-mylink-card-buttons">
                  <button
                    type="button"
                    className="wl-mylink-btn-icon"
                    onClick={() => onOpenExternal(item.url)}
                    title={t("weblinks.openInBrowser")}
                    aria-label={t("weblinks.openInBrowser")}
                  >
                    <OpenExternalIcon />
                  </button>

                  {editable && (
                    <>
                      <button
                        type="button"
                        className="wl-mylink-btn-icon"
                        onClick={() => handleStartEdit(item)}
                        title={t("weblinks.editLink")}
                        aria-label={t("weblinks.editLink")}
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        className="wl-mylink-btn-icon danger"
                        onClick={() => handleRemove(item.rawUrl)}
                        title={t("weblinks.removeLink")}
                        aria-label={t("weblinks.removeLink")}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
