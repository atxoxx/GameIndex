import { useMemo, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { FIXED_SOURCES, STEAM_SECTIONS, buildUrl, deriveCustomLinkMeta, getSteamAppIdString, SOURCE_CATEGORIES } from "./sources";
import { CustomLinkIcon } from "./WebLinksIcons";
import type { Game } from "../../types/game";
import type { FixedSourceKey, SourceCategoryKey, SteamSectionKey } from "./types";

interface BigScreenLinkItem {
  id: string;
  label: string;
  url: string;
  category: SourceCategoryKey;
  icon: ReactNode;
  accent: string;
  iconBg: string;
  disabled?: boolean;
}

export default function WebLinksBigScreen({ game }: { game: Game }) {
  const { t } = useLanguage();
  const appId = useMemo(() => getSteamAppIdString(game), [game]);
  const [selectedCat, setSelectedCat] = useState<SourceCategoryKey>("all");

  const links = useMemo<BigScreenLinkItem[]>(() => {
    const list: BigScreenLinkItem[] = [];

    // Steam sections
    STEAM_SECTIONS.forEach((sec) => {
      const url = buildUrl(game, "steam", sec.key, appId);
      const disabled = !!sec.requiresAppId && !appId;
      list.push({
        id: `steam-${sec.key}`,
        label: t(sec.i18nKey),
        url,
        category: "stores",
        icon: sec.icon,
        accent: "#66c0f4",
        iconBg: "#1b2838",
        disabled,
      });
    });

    // Other fixed sources
    FIXED_SOURCES.filter((s) => s.key !== "steam").forEach((src) => {
      const url = buildUrl(game, src.key as FixedSourceKey, "store" as SteamSectionKey, appId);
      list.push({
        id: src.key,
        label: src.label,
        url,
        category: src.category,
        icon: src.icon,
        accent: src.accent,
        iconBg: src.iconBg,
      });
    });

    // Custom links
    (game.websites ?? []).forEach((cUrl, idx) => {
      const trimmed = cUrl.trim();
      if (!trimmed) return;
      let url = trimmed;
      let label = "";

      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.url) {
            url = parsed.url;
            label = parsed.label;
          }
        } catch {
          // ignore
        }
      }

      const meta = deriveCustomLinkMeta(url);
      list.push({
        id: `custom-${idx}`,
        label: label || meta.label,
        url,
        category: "mylinks",
        icon: <CustomLinkIcon />,
        accent: "var(--color-accent)",
        iconBg: "var(--color-bg-tertiary)",
      });
    });

    return list;
  }, [game, appId, t]);

  const filteredLinks = useMemo(() => {
    if (selectedCat === "all") return links;
    return links.filter((l) => l.category === selectedCat);
  }, [links, selectedCat]);

  return (
    <div className="wl-bigscreen-container">
      <div className="wl-bigscreen-header">
        <h2 className="wl-bigscreen-title">{t("weblinks.title")}</h2>

        {/* Categories Bar */}
        <div className="wl-bigscreen-categories">
          {SOURCE_CATEGORIES.map((cat) => {
            const isActive = selectedCat === cat.key;
            return (
              <BigScreenCategoryButton
                key={cat.key}
                isActive={isActive}
                label={t(cat.i18nKey)}
                onSelect={() => setSelectedCat(cat.key)}
              />
            );
          })}
        </div>
      </div>

      {/* Grid of Link Cards */}
      <div className="wl-bigscreen-grid">
        {filteredLinks.map((item) => (
          <BigScreenLinkCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function BigScreenCategoryButton({
  label,
  isActive,
  onSelect,
}: {
  label: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const focusProps = useFocusable(onSelect);

  return (
    <button
      type="button"
      className={`bigscreen-system-menu-item wl-bigscreen-cat-btn${isActive ? " active" : ""}`}
      {...focusProps}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function BigScreenLinkCard({ item }: { item: BigScreenLinkItem }) {
  const handleOpen = async () => {
    if (item.disabled || !item.url) return;
    try {
      await openUrl(item.url);
    } catch {
      window.open(item.url, "_blank", "noopener,noreferrer");
    }
  };

  const focusProps = useFocusable(handleOpen);

  return (
    <button
      type="button"
      className={`bigscreen-system-menu-item wl-bigscreen-card${item.disabled ? " disabled" : ""}`}
      {...(item.disabled ? {} : focusProps)}
      onClick={handleOpen}
      disabled={item.disabled}
      style={{
        borderLeftColor: item.accent,
      }}
    >
      <div
        className="wl-bigscreen-icon"
        style={{
          background: item.iconBg,
          color: item.accent,
        }}
      >
        {item.icon}
      </div>
      <div className="wl-bigscreen-card-info">
        <div className="wl-bigscreen-card-label">{item.label}</div>
        {!item.disabled && (
          <div className="wl-bigscreen-card-host">
            {item.url.replace(/^https?:\/\//, "").replace(/^www\./, "")}
          </div>
        )}
      </div>
    </button>
  );
}
