import { useState, useMemo } from "react";
import {
  HelpCircle,
  Search,
  Sparkles,
  Gamepad2,
  Compass,
  Palette,
  Download,
  Store,
  Heart,
  Calculator,
  X,
  Keyboard,
  Filter,
} from "lucide-react";

interface CommandPaletteCheatSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyQuery: (query: string) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function CommandPaletteCheatSheet({
  isOpen,
  onClose,
  onApplyQuery,
  t,
}: CommandPaletteCheatSheetProps) {
  const [filterText, setFilterText] = useState("");

  const prefixes = [
    { prefix: "@", nameKey: "commandPalette.scopeGames", descKey: "commandPalette.cheatSheetPrefixGames", icon: Gamepad2, example: "@witcher" },
    { prefix: ">", nameKey: "commandPalette.scopeActions", descKey: "commandPalette.cheatSheetPrefixActions", icon: Sparkles, example: ">big screen" },
    { prefix: "/", nameKey: "commandPalette.scopeNavigation", descKey: "commandPalette.cheatSheetPrefixNav", icon: Compass, example: "/settings" },
    { prefix: "#", nameKey: "commandPalette.scopeThemes", descKey: "commandPalette.cheatSheetPrefixThemes", icon: Palette, example: "#cyberpunk" },
    { prefix: "$", nameKey: "commandPalette.scopeDownloads", descKey: "commandPalette.cheatSheetPrefixDownloads", icon: Download, example: "$cyberpunk" },
    { prefix: "?", nameKey: "commandPalette.scopeStore", descKey: "commandPalette.cheatSheetPrefixStore", icon: Store, example: "?final fantasy" },
    { prefix: "!", nameKey: "commandPalette.scopeWishlist", descKey: "commandPalette.cheatSheetPrefixWishlist", icon: Heart, example: "!hades" },
    { prefix: "~", nameKey: "commandPalette.scopeUtility", descKey: "commandPalette.cheatSheetPrefixUtility", icon: Calculator, example: "~80 gb at 100 mbps" },
  ];

  const powerFilters = [
    { token: "is:installed", descKey: "commandPalette.filterInstalled", example: "is:installed cyberpunk" },
    { token: "is:cloud", descKey: "commandPalette.filterCloud", example: "is:cloud rpg" },
    { token: "is:fav", descKey: "commandPalette.filterFavorite", example: "is:fav" },
    { token: "is:unplayed", descKey: "commandPalette.filterUnplayed", example: "is:unplayed is:installed" },
    { token: "is:running", descKey: "commandPalette.filterRunning", example: "is:running" },
    { token: "genre:rpg", descKey: "commandPalette.filterGenre", example: "genre:rpg year:>2020" },
    { token: "tag:action", descKey: "commandPalette.filterTag", example: "tag:co-op" },
    { token: "dev:valve", descKey: "commandPalette.filterDev", example: "dev:valve" },
    { token: "source:steam", descKey: "commandPalette.filterSource", example: "source:steam is:installed" },
    { token: "year:>2020", descKey: "commandPalette.filterYear", example: "year:>2022 rating:>80" },
    { token: "rating:>80", descKey: "commandPalette.filterRating", example: "rating:>85 is:installed" },
    { token: "playtime:>10h", descKey: "commandPalette.filterPlaytime", example: "playtime:>20h" },
    { token: "size:>50gb", descKey: "commandPalette.filterSize", example: "size:>50gb is:installed" },
    { token: "sort:playtime", descKey: "commandPalette.filterSort", example: "is:installed sort:playtime" },
  ];

  const hotkeys = [
    { keys: ["↑", "↓"], descKey: "commandPalette.hintNavigate" },
    { keys: ["↵"], descKey: "commandPalette.hintSelect" },
    { keys: ["Ctrl", "↵"], descKey: "commandPalette.hintDetails" },
    { keys: ["Ctrl", "K"], descKey: "commandPalette.actionsMenu" },
    { keys: ["Ctrl", "P"], descKey: "commandPalette.toggleInspector" },
    { keys: ["Ctrl", "O"], descKey: "commandPalette.openFolder" },
    { keys: ["Ctrl", "C"], descKey: "commandPalette.copy" },
    { keys: ["Tab"], descKey: "commandPalette.hintScope" },
    { keys: ["Shift", "Del"], descKey: "commandPalette.removeRecent" },
    { keys: ["Esc"], descKey: "commandPalette.hintClose" },
  ];

  const filteredPrefixes = useMemo(() => {
    if (!filterText) return prefixes;
    const q = filterText.toLowerCase();
    return prefixes.filter((p) => p.prefix.includes(q) || p.example.includes(q) || t(p.nameKey).toLowerCase().includes(q));
  }, [filterText, prefixes, t]);

  const filteredPowerFilters = useMemo(() => {
    if (!filterText) return powerFilters;
    const q = filterText.toLowerCase();
    return powerFilters.filter((pf) => pf.token.includes(q) || pf.example.includes(q) || t(pf.descKey).toLowerCase().includes(q));
  }, [filterText, powerFilters, t]);

  if (!isOpen) return null;

  return (
    <div className="cmd-cheatsheet-backdrop" onClick={onClose}>
      <div className="cmd-cheatsheet-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cmd-cheatsheet-header">
          <div className="cmd-cheatsheet-title-group">
            <HelpCircle className="cmd-cheatsheet-icon" size={18} />
            <div>
              <h3 className="cmd-cheatsheet-title">{t("commandPalette.cheatSheetTitle")}</h3>
              <span className="cmd-cheatsheet-subtitle">{t("commandPalette.cheatSheetSubtitle")}</span>
            </div>
          </div>
          <button type="button" className="cmd-cheatsheet-close" onClick={onClose} aria-label={t("commandPalette.hintClose")}>
            <X size={16} />
          </button>
        </div>

        {/* Filter search in cheat sheet */}
        <div className="cmd-cheatsheet-search">
          <Search size={14} className="cmd-cheatsheet-search-icon" />
          <input
            type="text"
            className="cmd-cheatsheet-search-input"
            placeholder={t("commandPalette.searchCheatSheet")}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            autoFocus
          />
        </div>

        {/* Content Body */}
        <div className="cmd-cheatsheet-body">
          {/* Section 1: Scopes & Prefixes */}
          <div className="cmd-cheatsheet-section">
            <div className="cmd-cheatsheet-section-header">
              <Filter size={14} />
              <span>{t("commandPalette.sectionScopePrefixes")}</span>
            </div>
            <div className="cmd-cheatsheet-grid">
              {filteredPrefixes.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.prefix}
                    type="button"
                    className="cmd-cheatsheet-card"
                    onClick={() => {
                      onApplyQuery(`${p.prefix} `);
                      onClose();
                    }}
                  >
                    <div className="cmd-cheatsheet-card-top">
                      <div className="cmd-cheatsheet-prefix-badge">
                        <Icon size={12} />
                        <kbd>{p.prefix}</kbd>
                      </div>
                      <span className="cmd-cheatsheet-card-title">{t(p.nameKey)}</span>
                    </div>
                    <span className="cmd-cheatsheet-card-desc">{t(p.descKey)}</span>
                    <span className="cmd-cheatsheet-card-example">
                      <code>{p.example}</code>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Power Filters */}
          <div className="cmd-cheatsheet-section">
            <div className="cmd-cheatsheet-section-header">
              <Sparkles size={14} />
              <span>{t("commandPalette.sectionPowerFilters")}</span>
            </div>
            <div className="cmd-cheatsheet-grid">
              {filteredPowerFilters.map((pf) => (
                <button
                  key={pf.token}
                  type="button"
                  className="cmd-cheatsheet-card"
                  onClick={() => {
                    onApplyQuery(`${pf.token} `);
                    onClose();
                  }}
                >
                  <div className="cmd-cheatsheet-card-top">
                    <kbd className="cmd-cheatsheet-token">{pf.token}</kbd>
                  </div>
                  <span className="cmd-cheatsheet-card-desc">{t(pf.descKey)}</span>
                  <span className="cmd-cheatsheet-card-example">
                    <code>{pf.example}</code>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Section 3: Keyboard Shortcuts */}
          <div className="cmd-cheatsheet-section">
            <div className="cmd-cheatsheet-section-header">
              <Keyboard size={14} />
              <span>{t("commandPalette.sectionHotkeys")}</span>
            </div>
            <div className="cmd-cheatsheet-hotkeys-grid">
              {hotkeys.map((h, i) => (
                <div key={i} className="cmd-cheatsheet-hotkey-row">
                  <div className="cmd-cheatsheet-hotkey-keys">
                    {h.keys.map((k, j) => (
                      <kbd key={j} className="command-palette-key-pill">
                        {k}
                      </kbd>
                    ))}
                  </div>
                  <span className="cmd-cheatsheet-hotkey-desc">{t(h.descKey)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cmd-cheatsheet-footer">
          <span className="cmd-cheatsheet-tip">{t("commandPalette.cheatSheetClickTip")}</span>
          <kbd className="command-palette-key-pill">Esc</kbd>
        </div>
      </div>
    </div>
  );
}
