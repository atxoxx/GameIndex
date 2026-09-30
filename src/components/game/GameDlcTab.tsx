import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Game } from "../../types/game";
import type { SteamGameDlcsResult, SteamDlcItem } from "../../types/steam";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { IconDlc, IconFamily, IconSteam } from "./icons";
import { Button } from "../ui";

interface GameDlcTabProps {
  game?: Game | null;
  storeAppId?: number | null;
  gameName?: string;
}

type FilterType = "all" | "owned" | "unowned" | "free";
type SortType = "default" | "price-asc" | "price-desc" | "name";

function cleanDescription(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export default function GameDlcTab({
  game,
  storeAppId,
  gameName: _gameName,
}: GameDlcTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const appId = game?.steamAppId ?? storeAppId ?? null;

  const [data, setData] = useState<SteamGameDlcsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy] = useState<SortType>("default");
  const [selectedDlc, setSelectedDlc] = useState<SteamDlcItem | null>(null);

  const activeAppIdRef = useRef<number | null>(null);

  // Close modal on Escape
  useEffect(() => {
    if (!selectedDlc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedDlc(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedDlc]);

  const fetchDlcs = useCallback(() => {
    if (!appId) {
      setData(null);
      setLoading(false);
      return;
    }

    activeAppIdRef.current = appId;
    setLoading(true);
    setError(null);

    invoke<SteamGameDlcsResult>("steam_get_game_dlcs", { appId })
      .then((res) => {
        if (activeAppIdRef.current === appId) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn("[GameDlcTab] Failed to fetch DLCs:", err);
        if (activeAppIdRef.current === appId) {
          setError(String(err));
          setLoading(false);
        }
      });
  }, [appId]);

  useEffect(() => {
    fetchDlcs();
  }, [fetchDlcs]);

  const handleToggleOwnership = useCallback(
    async (dlc: SteamDlcItem) => {
      if (!appId) return;
      const targetState = !dlc.isOwned;

      // Optimistic update
      setData((prev) => {
        if (!prev) return prev;
        const updatedList = prev.dlcs.map((item) =>
          item.appId === dlc.appId ? { ...item, isOwned: targetState } : item
        );
        const newOwnedCount = updatedList.filter((item) => item.isOwned).length;
        return {
          ...prev,
          ownedCount: newOwnedCount,
          dlcs: updatedList,
        };
      });

      setSelectedDlc((prev) => {
        if (prev && prev.appId === dlc.appId) {
          return { ...prev, isOwned: targetState };
        }
        return prev;
      });

      try {
        await invoke("steam_toggle_dlc_owned", {
          appId,
          dlcAppId: dlc.appId,
          owned: targetState,
        });
        showToast(
          targetState
            ? t("dlc.markedAsOwned", { name: dlc.name })
            : t("dlc.markedAsUnowned", { name: dlc.name }),
          "info"
        );
      } catch (err) {
        console.error("Failed to toggle DLC ownership:", err);
        showToast(t("dlc.toggleFailed"), "error");
        // Revert on error
        fetchDlcs();
      }
    },
    [appId, showToast, t, fetchDlcs]
  );

  const handleOpenStore = useCallback((dlcAppId: number) => {
    openUrl(`https://store.steampowered.com/app/${dlcAppId}/`).catch((err) => {
      console.warn("Failed to open Steam store link:", err);
    });
  }, []);

  // Filtered & sorted DLCs
  const filteredDlcs = useMemo(() => {
    if (!data?.dlcs) return [];

    let list = data.dlcs;

    // Filter by type
    if (filter === "owned") {
      list = list.filter((d) => d.isOwned);
    } else if (filter === "unowned") {
      list = list.filter((d) => !d.isOwned);
    } else if (filter === "free") {
      list = list.filter((d) => d.isFree);
    }

    // Filter by query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }

    // Sort
    if (sortBy === "name") {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [data?.dlcs, filter, searchQuery, sortBy]);

  const counts = useMemo(() => {
    if (!data?.dlcs) return { all: 0, owned: 0, unowned: 0, free: 0 };
    return {
      all: data.dlcs.length,
      owned: data.dlcs.filter((d) => d.isOwned).length,
      unowned: data.dlcs.filter((d) => !d.isOwned).length,
      free: data.dlcs.filter((d) => d.isFree).length,
    };
  }, [data?.dlcs]);

  const ownershipPercentage = useMemo(() => {
    if (!data || data.totalDlcs === 0) return 0;
    return Math.round((data.ownedCount / data.totalDlcs) * 100);
  }, [data]);

  if (!appId) {
    return (
      <div className="dlc-tab-root">
        <div className="dlc-empty-state">
          <span className="dlc-empty-state__icon" aria-hidden>
            <IconSteam size={42} />
          </span>
          <h3 className="dlc-empty-state__title">{t("dlc.noSteamLinked")}</h3>
          <p className="dlc-empty-state__desc">{t("dlc.noSteamLinkedDesc")}</p>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="dlc-tab-root">
        <div className="dlc-stats-bar">
          <div className="dlc-stat-tile" style={{ height: 72, opacity: 0.5 }} />
          <div className="dlc-stat-tile" style={{ height: 72, opacity: 0.5 }} />
          <div className="dlc-stat-tile" style={{ height: 72, opacity: 0.5 }} />
        </div>
        <div className="dlc-grid">
          <div className="dlc-item-card" style={{ height: 260, opacity: 0.4 }} />
          <div className="dlc-item-card" style={{ height: 260, opacity: 0.4 }} />
          <div className="dlc-item-card" style={{ height: 260, opacity: 0.4 }} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="dlc-tab-root">
        <div className="dlc-empty-state">
          <span className="dlc-empty-state__icon" aria-hidden>
            <IconDlc size={42} />
          </span>
          <h3 className="dlc-empty-state__title">{t("dlc.loadFailed")}</h3>
          <p className="dlc-empty-state__desc">{error}</p>
          <Button variant="ghost" size="sm" onClick={fetchDlcs}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (!data || data.totalDlcs === 0) {
    return (
      <div className="dlc-tab-root">
        {/* If family share info is present, display it even if 0 DLCs */}
        {data?.familyShare?.isShared && (
          <div className="family-share-banner">
            <div className="family-share-banner__avatar-wrap">
              {data.familyShare.ownerAvatarUrl ? (
                <img
                  src={data.familyShare.ownerAvatarUrl}
                  alt={data.familyShare.ownerName || "Owner"}
                  className="family-share-banner__avatar"
                />
              ) : (
                <div className="family-share-banner__avatar" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#4f46e5" }}>
                  <IconFamily size={18} />
                </div>
              )}
              <span className="family-share-banner__badge-icon">
                <IconFamily size={10} />
              </span>
            </div>
            <div className="family-share-banner__content">
              <span className="family-share-banner__title">
                {t("dlc.familySharing")}
              </span>
              <span className="family-share-banner__desc">
                {t("dlc.sharedBy", {
                  owner: data.familyShare.ownerName || t("dlc.familyMember"),
                  group: data.familyShare.familyGroupName || t("dlc.steamFamily"),
                })}
              </span>
            </div>
          </div>
        )}

        <div className="dlc-empty-state">
          <span className="dlc-empty-state__icon" aria-hidden>
            <IconDlc size={42} />
          </span>
          <h3 className="dlc-empty-state__title">{t("dlc.noneFoundTitle")}</h3>
          <p className="dlc-empty-state__desc">{t("dlc.noneFoundDesc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dlc-tab-root">
      {/* Family Sharing Banner */}
      {data.familyShare?.isShared && (
        <div className="family-share-banner">
          <div className="family-share-banner__avatar-wrap">
            {data.familyShare.ownerAvatarUrl ? (
              <img
                src={data.familyShare.ownerAvatarUrl}
                alt={data.familyShare.ownerName || "Owner"}
                className="family-share-banner__avatar"
              />
            ) : (
              <div className="family-share-banner__avatar" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#4f46e5" }}>
                <IconFamily size={18} />
              </div>
            )}
            <span className="family-share-banner__badge-icon">
              <IconFamily size={10} />
            </span>
          </div>
          <div className="family-share-banner__content">
            <span className="family-share-banner__title">
              {t("dlc.familySharing")}
            </span>
            <span className="family-share-banner__desc">
              {t("dlc.sharedBy", {
                owner: data.familyShare.ownerName || t("dlc.familyMember"),
                group: data.familyShare.familyGroupName || t("dlc.steamFamily"),
              })}
            </span>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="dlc-stats-bar">
        <div className="dlc-stat-tile">
          <span className="dlc-stat-tile__icon" aria-hidden>
            <IconDlc size={22} />
          </span>
          <div className="dlc-stat-tile__body">
            <span className="dlc-stat-tile__value">{data.totalDlcs}</span>
            <span className="dlc-stat-tile__label">{t("dlc.totalAvailable")}</span>
          </div>
        </div>

        <div className="dlc-stat-tile dlc-stat-tile--owned">
          <span className="dlc-stat-tile__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="dlc-stat-tile__body">
            <span className="dlc-stat-tile__value">{data.ownedCount}</span>
            <span className="dlc-stat-tile__label">{t("dlc.inLibrary")}</span>
          </div>
        </div>

        <div className="dlc-stat-tile dlc-stat-tile--missing">
          <span className="dlc-stat-tile__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </span>
          <div className="dlc-stat-tile__body">
            <span className="dlc-stat-tile__value">
              {Math.max(0, data.totalDlcs - data.ownedCount)}
            </span>
            <span className="dlc-stat-tile__label">{t("dlc.unowned")}</span>
          </div>
        </div>
      </div>

      {/* Progress Card */}
      <div className="dlc-progress-card">
        <div className="dlc-progress-card__header">
          <span className="dlc-progress-card__label">{t("dlc.collectionProgress")}</span>
          <span className="dlc-progress-card__pct">{ownershipPercentage}%</span>
        </div>
        <div className="dlc-progress-bar">
          <div
            className="dlc-progress-bar__fill"
            style={{ width: `${ownershipPercentage}%` }}
          />
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="dlc-controls-bar">
        <div className="dlc-filter-group" role="tablist">
          <button
            type="button"
            className={`dlc-filter-chip ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            {t("dlc.filterAll")}
            <span className="dlc-filter-chip__count">{counts.all}</span>
          </button>
          <button
            type="button"
            className={`dlc-filter-chip ${filter === "owned" ? "active" : ""}`}
            onClick={() => setFilter("owned")}
          >
            {t("dlc.filterOwned")}
            <span className="dlc-filter-chip__count">{counts.owned}</span>
          </button>
          <button
            type="button"
            className={`dlc-filter-chip ${filter === "unowned" ? "active" : ""}`}
            onClick={() => setFilter("unowned")}
          >
            {t("dlc.filterUnowned")}
            <span className="dlc-filter-chip__count">{counts.unowned}</span>
          </button>
          {counts.free > 0 && (
            <button
              type="button"
              className={`dlc-filter-chip ${filter === "free" ? "active" : ""}`}
              onClick={() => setFilter("free")}
            >
              {t("dlc.filterFree")}
              <span className="dlc-filter-chip__count">{counts.free}</span>
            </button>
          )}
        </div>

        <div className="dlc-search-wrap">
          <svg
            className="dlc-search-icon"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="dlc-search-input"
            placeholder={t("dlc.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* DLC Cards Grid */}
      {filteredDlcs.length === 0 ? (
        <div className="dlc-empty-state">
          <h4 className="dlc-empty-state__title">{t("dlc.noMatches")}</h4>
          <p className="dlc-empty-state__desc">{t("dlc.noMatchesDesc")}</p>
        </div>
      ) : (
        <div className="dlc-grid">
          {filteredDlcs.map((dlc) => (
            <div
              key={dlc.appId}
              className={`dlc-item-card ${dlc.isOwned ? "dlc-item-card--owned" : ""}`}
              onClick={() => setSelectedDlc(dlc)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedDlc(dlc);
                }
              }}
              aria-label={dlc.name}
            >
              <div className="dlc-item-card__header-img-wrap">
                {dlc.headerImage ? (
                  <img
                    src={dlc.headerImage}
                    alt={dlc.name}
                    className="dlc-item-card__img"
                    loading="lazy"
                  />
                ) : (
                  <div className="dlc-item-card__img" />
                )}
                <div className="dlc-item-card__badge-ribbon">
                  {dlc.isOwned && (
                    <span className="dlc-badge dlc-badge--owned">
                      ✓ {t("dlc.owned")}
                    </span>
                  )}
                  {dlc.isFree && (
                    <span className="dlc-badge dlc-badge--free">
                      {t("dlc.free")}
                    </span>
                  )}
                  {dlc.discountPercent && dlc.discountPercent > 0 && !dlc.isOwned ? (
                    <span className="dlc-badge dlc-badge--discount">
                      -{dlc.discountPercent}%
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="dlc-item-card__content">
                <span className="dlc-item-card__title" title={dlc.name}>
                  {dlc.name}
                </span>

                {dlc.releaseDate && (
                  <div className="dlc-item-card__meta">
                    <span>{dlc.releaseDate}</span>
                  </div>
                )}

                <div className="dlc-item-card__price-row">
                  {dlc.initialPriceFormatted &&
                  dlc.discountPercent &&
                  dlc.discountPercent > 0 ? (
                    <span className="dlc-item-card__price-orig">
                      {dlc.initialPriceFormatted}
                    </span>
                  ) : null}
                  <span
                    className={`dlc-item-card__price-current ${
                      dlc.isFree ? "dlc-item-card__price-current--free" : ""
                    }`}
                  >
                    {dlc.isFree
                      ? t("dlc.free")
                      : dlc.priceFormatted || t("dlc.available")}
                  </span>
                </div>
              </div>

              <div className="dlc-item-card__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenStore(dlc.appId);
                  }}
                  title={t("dlc.openInStore")}
                >
                  <IconSteam size={14} />
                  <span>{t("dlc.steamStore")}</span>
                </Button>

                <Button
                  variant={dlc.isOwned ? "secondary" : "ghost"}
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleOwnership(dlc);
                  }}
                >
                  {dlc.isOwned ? `✓ ${t("dlc.owned")}` : `+ ${t("dlc.markOwned")}`}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DLC Detail Modal */}
      {selectedDlc &&
        createPortal(
          <div
            className="modal-backdrop"
            onMouseDown={() => setSelectedDlc(null)}
            role="presentation"
          >
            <div
              className="modal dlc-modal"
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="dlc-modal-title"
            >
              <div className="dlc-modal__banner-wrap">
                {selectedDlc.headerImage ? (
                  <img
                    src={selectedDlc.headerImage}
                    alt={selectedDlc.name}
                    className="dlc-modal__banner-img"
                  />
                ) : (
                  <div className="dlc-modal__banner-img" />
                )}
                <div className="dlc-modal__banner-overlay" />
                <button
                  type="button"
                  className="dlc-modal__close-btn"
                  onClick={() => setSelectedDlc(null)}
                  title={t("common.close")}
                  aria-label={t("common.close")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <div className="dlc-modal__banner-badges">
                  {selectedDlc.isOwned && (
                    <span className="dlc-badge dlc-badge--owned">
                      ✓ {t("dlc.owned")}
                    </span>
                  )}
                  {selectedDlc.isInstalled && (
                    <span className="dlc-badge dlc-badge--owned">
                      {t("dlc.installed")}
                    </span>
                  )}
                  {selectedDlc.isFree && (
                    <span className="dlc-badge dlc-badge--free">
                      {t("dlc.free")}
                    </span>
                  )}
                  {selectedDlc.discountPercent && selectedDlc.discountPercent > 0 && !selectedDlc.isOwned ? (
                    <span className="dlc-badge dlc-badge--discount">
                      -{selectedDlc.discountPercent}%
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="dlc-modal__body">
                <div className="dlc-modal__header-info">
                  <h2 className="dlc-modal__title" id="dlc-modal-title">
                    {selectedDlc.name}
                  </h2>
                  <span className="dlc-modal__app-id">
                    Steam AppID: {selectedDlc.appId}
                  </span>
                </div>

                <div className="dlc-modal__meta-grid">
                  <div className="dlc-modal__meta-tile">
                    <span className="dlc-modal__meta-label">{t("dlc.status")}</span>
                    <span className="dlc-modal__meta-value">
                      {selectedDlc.isOwned ? t("dlc.owned") : t("dlc.unowned")}
                    </span>
                  </div>

                  <div className="dlc-modal__meta-tile">
                    <span className="dlc-modal__meta-label">{t("dlc.installed")}</span>
                    <span className="dlc-modal__meta-value">
                      {selectedDlc.isInstalled ? t("dlc.installed") : t("dlc.notInstalled")}
                    </span>
                  </div>

                  {selectedDlc.releaseDate && (
                    <div className="dlc-modal__meta-tile">
                      <span className="dlc-modal__meta-label">{t("dlc.releaseDate")}</span>
                      <span className="dlc-modal__meta-value">{selectedDlc.releaseDate}</span>
                    </div>
                  )}

                  <div className="dlc-modal__meta-tile">
                    <span className="dlc-modal__meta-label">
                      {selectedDlc.isFree ? t("dlc.free") : t("dlc.available")}
                    </span>
                    <span className="dlc-modal__meta-value">
                      {selectedDlc.isFree
                        ? t("dlc.free")
                        : selectedDlc.priceFormatted || t("dlc.available")}
                    </span>
                  </div>
                </div>

                <div className="dlc-modal__desc-section">
                  <span className="dlc-modal__desc-heading">
                    {t("dlc.aboutThisDlc")}
                  </span>
                  <p className="dlc-modal__desc-content">
                    {cleanDescription(selectedDlc.shortDescription) || t("dlc.noDescription")}
                  </p>
                </div>
              </div>

              <div className="dlc-modal__footer">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenStore(selectedDlc.appId)}
                >
                  <IconSteam size={15} />
                  <span>{t("dlc.openInStore")}</span>
                </Button>

                <div className="dlc-modal__footer-right">
                  <Button
                    variant={selectedDlc.isOwned ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => handleToggleOwnership(selectedDlc)}
                  >
                    {selectedDlc.isOwned
                      ? t("dlc.unmarkOwned")
                      : `+ ${t("dlc.markOwned")}`}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setSelectedDlc(null)}
                  >
                    {t("common.close")}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
