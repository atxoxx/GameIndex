import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Compass, Download, Gamepad2, Plus, RefreshCw, Search, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { Button } from "../ui";
import {
  KNOWN_EMULATORS,
  getPlatformCategory,
  knownEmulatorByKey,
  type Emulator,
  type DiscoveredEmulator,
  type KnownEmulator,
  type PlatformCategory,
} from "../../types/emulator";

interface AddModalProps {
  emulators: Emulator[];                 // already-configured emulators, for "added" badges
  onClose: () => void;
  onAddDiscovered: (d: DiscoveredEmulator) => void;
  onConfigureKnown: (k: KnownEmulator) => void;
  onCustom: () => void;
  onOpenDownload: () => void;
}

type TabId = "installed" | "catalog" | "download";

const FAMILIES: { key: PlatformCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "nintendo", label: "Nintendo" },
  { key: "playstation", label: "PlayStation" },
  { key: "sega", label: "Sega" },
  { key: "xbox", label: "Xbox" },
  { key: "arcade", label: "Arcade" },
  { key: "other", label: "Other" },
];

function sameExecutable(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return left.length > 0 && left === right;
}

export default function EmulatorAddModal({
  emulators,
  onClose,
  onAddDiscovered,
  onConfigureKnown,
  onCustom,
  onOpenDownload,
}: AddModalProps) {
  const { t } = useLanguage();
  const { hostPlatform } = useSettings();

  const [tab, setTab] = useState<TabId>("installed");

  const [discovered, setDiscovered] = useState<DiscoveredEmulator[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const autoScannedRef = useRef(false);

  const [catalogSearch, setCatalogSearch] = useState("");
  const [family, setFamily] = useState<PlatformCategory>("all");

  const runDiscovery = useCallback(async () => {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const list = await invoke<DiscoveredEmulator[]>("discover_emulators");
      setDiscovered(Array.isArray(list) ? list : []);
    } catch (err) {
      setDiscoverError(String(err));
      setDiscovered([]);
    } finally {
      setDiscovering(false);
    }
  }, []);

  // Auto-scan once when the Installed tab first opens; the Rescan button
  // calls `runDiscovery` directly.
  useEffect(() => {
    if (tab !== "installed" || autoScannedRef.current) return;
    autoScannedRef.current = true;
    void runDiscovery();
  }, [tab, runDiscovery]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function selectTab(next: TabId) {
    setTab(next);
  }

  function discoveredAdded(d: DiscoveredEmulator): boolean {
    return emulators.some((e) => sameExecutable(e.executablePath, d.executablePath));
  }

  function knownAdded(k: KnownEmulator): boolean {
    return emulators.some(
      (e) =>
        e.name.trim().toLowerCase() === k.name.trim().toLowerCase() &&
        e.platform.trim().toLowerCase() === k.platform.trim().toLowerCase(),
    );
  }

  const catalogRows = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return KNOWN_EMULATORS.filter((k) => {
      if (family !== "all" && getPlatformCategory(k.platform) !== family) return false;
      if (q && !k.name.toLowerCase().includes(q) && !k.platform.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [catalogSearch, family]);

  const discoveryExplainer =
    hostPlatform === "linux" ? t("emulators.discovery.descLinux") : t("emulators.discovery.desc");

  return createPortal(
    <div className="modal-overlay emulators-modal-overlay" onMouseDown={onClose}>
      <div
        className="modal emulators-modal emu-add-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("emulators.add.title")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-text">
            <h2>{t("emulators.add.title")}</h2>
            <p className="modal-subtitle">{t("emulators.add.subtitle")}</p>
          </div>
          <button className="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="emu-add-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            id="emu-add-tab-installed"
            aria-controls="emu-add-panel"
            aria-selected={tab === "installed"}
            className={`emu-add-tab${tab === "installed" ? " is-active" : ""}`}
            onClick={() => selectTab("installed")}
          >
            <Gamepad2 size={15} aria-hidden />
            <span>{t("emulators.add.tab.installed")}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="emu-add-tab-catalog"
            aria-controls="emu-add-panel"
            aria-selected={tab === "catalog"}
            className={`emu-add-tab${tab === "catalog" ? " is-active" : ""}`}
            onClick={() => selectTab("catalog")}
          >
            <Compass size={15} aria-hidden />
            <span>{t("emulators.add.tab.catalog")}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="emu-add-tab-download"
            aria-controls="emu-add-panel"
            aria-selected={tab === "download"}
            className={`emu-add-tab${tab === "download" ? " is-active" : ""}`}
            onClick={() => selectTab("download")}
          >
            <Download size={15} aria-hidden />
            <span>{t("emulators.add.tab.download")}</span>
          </button>
        </div>

        <div
          id="emu-add-panel"
          className="modal-body emu-add-body"
          role="tabpanel"
          aria-labelledby={`emu-add-tab-${tab}`}
        >
          {tab === "installed" && (
            <>
              <div className="emu-add-toolbar">
                <p className="emu-add-explainer">{discoveryExplainer}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  isLoading={discovering}
                  leftIcon={<RefreshCw size={15} aria-hidden />}
                  onClick={() => void runDiscovery()}
                >
                  {t("emulators.discovery.scan")}
                </Button>
              </div>

              {discovering && discovered.length === 0 ? (
                <div className="emu-add-empty">{t("emulators.discovery.scanning")}</div>
              ) : discoverError ? (
                <div className="emu-add-empty">{discoverError}</div>
              ) : discovered.length === 0 ? (
                <div className="emu-add-empty">{t("emulators.discovery.none")}</div>
              ) : (
                <div className="emu-add-list">
                  {discovered.map((d) => {
                    const known = knownEmulatorByKey(d.key);
                    const added = discoveredAdded(d);
                    return (
                      <div className="emu-add-row" key={d.executablePath || d.key}>
                        <span className="emu-add-row-glyph">{known?.glyph ?? "🎮"}</span>
                        <span className="emu-add-row-main">
                          <span className="emu-add-row-name">{known?.name ?? d.name}</span>
                          <span className="emu-add-row-platform">
                            {known?.platform ?? d.platform}
                          </span>
                          <span className="emu-add-row-path">{d.executablePath}</span>
                        </span>
                        <span className="emu-add-row-meta">
                          <Button
                            type="button"
                            size="sm"
                            variant={added ? "secondary" : "primary"}
                            disabled={added}
                            leftIcon={added ? undefined : <Plus size={15} aria-hidden />}
                            onClick={() => onAddDiscovered(d)}
                          >
                            {added
                              ? t("emulators.discovery.added")
                              : t("emulators.discovery.add")}
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === "catalog" && (
            <>
              <div className="emu-add-toolbar">
                <div className="emu-add-search">
                  <Search size={15} aria-hidden />
                  <input
                    type="text"
                    placeholder={t("emulators.add.search")}
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                  />
                </div>
                <div className="emu-add-families">
                  {FAMILIES.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className={`emu-add-chip${family === f.key ? " is-active" : ""}`}
                      aria-pressed={family === f.key}
                      onClick={() => setFamily(f.key)}
                    >
                      {f.key === "all"
                        ? t("emulators.filter.all")
                        : f.key === "other"
                          ? t("emulators.custom")
                          : f.label}
                    </button>
                  ))}
                </div>
              </div>

              {catalogRows.length === 0 ? (
                <div className="emu-add-empty">{t("emulators.add.noResults")}</div>
              ) : (
                <div className="emu-add-list">
                  {catalogRows.map((k) => {
                    const added = knownAdded(k);
                    return (
                      <div className="emu-add-row" key={k.key}>
                        {k.logo ? (
                          <img
                            className="emu-add-row-glyph-img"
                            src={k.logo}
                            alt=""
                            draggable={false}
                            loading="lazy"
                          />
                        ) : (
                          <span className="emu-add-row-glyph">{k.glyph}</span>
                        )}
                        <span className="emu-add-row-main">
                          <span className="emu-add-row-name">{k.name}</span>
                          <span className="emu-add-row-platform">{k.platform}</span>
                          <span className="emu-add-row-desc">{k.description}</span>
                        </span>
                        <span className="emu-add-row-meta">
                          {added && (
                            <span className="emu-add-row-badge">
                              {t("emulators.discovery.added")}
                            </span>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={added}
                            onClick={() => onConfigureKnown(k)}
                          >
                            {added ? t("emulators.discovery.added") : t("emulators.add.setup")}
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === "download" && (
            <div className="emu-add-download">
              <Download size={28} aria-hidden />
              <p>{t("emulators.download.subtitle")}</p>
              <Button type="button" variant="primary" onClick={onOpenDownload}>
                {t("emulators.download.title")}
              </Button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="modal-footer-left">
            <Button
              type="button"
              variant="ghost"
              leftIcon={<Plus size={15} aria-hidden />}
              onClick={onCustom}
            >
              {t("emulators.add.custom")}
            </Button>
          </div>
          <div className="modal-footer-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
