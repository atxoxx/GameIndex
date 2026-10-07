import { useMemo, useState } from "react";
import { Bookmark, Heart, Search, Trash2 } from "lucide-react";
import { Button } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import type { ModBookmark } from "./useModBookmarks";
import RemoteModCard from "./RemoteModCard";
import "./mods-discover.css";

interface DiscoverBookmarksViewProps {
  bookmarks: ModBookmark[];
  installedKeys: Set<string>;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
  onRemoveBookmark: (source: string, id: string) => void;
  onQuickInstall?: (mod: RemoteModSummary) => void;
  onClearAll?: () => void;
  onNavigateBrowse: () => void;
}

export default function DiscoverBookmarksView({
  bookmarks,
  installedKeys,
  onOpen,
  onOpenExternal,
  onRemoveBookmark,
  onQuickInstall,
  onClearAll,
  onNavigateBrowse,
}: DiscoverBookmarksViewProps) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter(
      (b) =>
        b.mod.name.toLowerCase().includes(q) ||
        (b.mod.author && b.mod.author.toLowerCase().includes(q)) ||
        b.mod.source.toLowerCase().includes(q) ||
        (b.gameTitle && b.gameTitle.toLowerCase().includes(q)),
    );
  }, [bookmarks, filter]);

  if (bookmarks.length === 0) {
    return (
      <div className="mods-discover-empty">
        <Heart size={40} className="mods-discover-empty-icon" />
        <h3>{t("mods.discover.noBookmarksTitle")}</h3>
        <p>{t("mods.discover.noBookmarksDesc")}</p>
        <Button variant="primary" size="sm" onClick={onNavigateBrowse}>
          {t("mods.discover.browseMods")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mods-discover-bookmarks-view">
      <div className="mods-discover-bookmarks-head">
        <div className="mods-discover-bookmarks-stats">
          <span className="mods-discover-bookmarks-count">
            <Bookmark size={15} />
            {t("mods.discover.savedCount", { count: String(bookmarks.length) })}
          </span>

          {onClearAll && bookmarks.length > 0 && (
            <button
              type="button"
              className="mods-discover-clear-btn"
              onClick={onClearAll}
              title={t("mods.discover.clearAllBookmarks")}
            >
              <Trash2 size={13} /> {t("mods.discover.clearAllBookmarks")}
            </button>
          )}
        </div>

        <div className="mods-discover-history-search">
          <Search size={14} className="mods-discover-search-icon" />
          <input
            type="text"
            className="mods-discover-search-input"
            placeholder={t("mods.discover.searchBookmarksPlaceholder")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="mods-discover-grid">
        {filtered.map((b) => (
          <RemoteModCard
            key={`${b.mod.source}:${b.mod.id}`}
            mod={b.mod}
            installed={installedKeys.has(`${b.mod.source}:${b.mod.id}`)}
            isBookmarked={true}
            onOpen={onOpen}
            onOpenExternal={onOpenExternal}
            onToggleBookmark={() => onRemoveBookmark(b.mod.source, b.mod.id)}
            onQuickInstall={onQuickInstall}
          />
        ))}
      </div>
    </div>
  );
}
