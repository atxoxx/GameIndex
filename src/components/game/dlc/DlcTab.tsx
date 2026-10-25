import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  LayoutGrid,
  Percent,
  RefreshCw,
  Rows3,
  ShoppingBag,
  Star,
  Package,
} from "lucide-react";
import type { Game } from "../../../types/game";
import type { SteamGameDlcsResult, SteamDlcItem } from "../../../types/steam";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { steamCodeForUi } from "../../../i18n/languages";
import { Button, ConfirmModal, type StatBandItem } from "../../ui";
import { IconDlc, IconFamily, IconSteam } from "../icons";
import {
  GameTabChips,
  GameTabEmpty,
  GameTabSearch,
  GameTabShell,
  GameTabSkeleton,
  GameTabToolbar,
  GameTabViewSwitch,
  useGameTabState,
} from "../tabs";
import DlcCard from "./DlcCard";
import DlcDrawer from "./DlcDrawer";
import DlcTable from "./DlcTable";
import {
  DLC_FILTERS,
  DLC_SORTS,
  DLC_VIEWS,
  dlcCounts,
  filterDlcList,
  ownershipPercent,
  type DlcFilter,
  type DlcSort,
  type DlcView,
} from "./dlcData";
import "../../../styles/dlc-tab.css";

interface GameDlcTabProps {
  game?: Game | null;
  storeAppId?: number | null;
  gameName?: string;
}

interface DlcTabState {
  view: DlcView;
  filter: DlcFilter;
  sort: DlcSort;
  item: string;
}

const DEFAULT_STATE: DlcTabState = {
  view: "gallery",
  filter: "all",
  sort: "default",
  item: "",
};

/**
 * DLC & Add-ons — a workspace over Steam's add-on catalog.
 *
 * The header carries the collection figures (clickable, so a figure doubles as
 * a filter), the command row holds search/filter/sort/view, and the catalog
 * renders as an art gallery or a dense table. One add-on opens in a right-side
 * drawer instead of a centered modal, keeping the catalog in view.
 */
export default function GameDlcTab({ game, storeAppId }: GameDlcTabProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const appId = game?.steamAppId ?? storeAppId ?? null;

  const [data, setData] = useState<SteamGameDlcsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [markAllPending, setMarkAllPending] = useState(false);
  const [confirmMarkAll, setConfirmMarkAll] = useState(false);

  const requestRef = useRef(0);
  const [state, setState] = useGameTabState<DlcTabState>({
    prefix: "dlc",
    defaults: DEFAULT_STATE,
    allowed: { view: DLC_VIEWS, filter: DLC_FILTERS, sort: DLC_SORTS },
  });

  const load = useCallback(
    async (force = false) => {
      if (!appId) {
        setData(null);
        setLoading(false);
        return;
      }
      const request = ++requestRef.current;
      if (force) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await invoke<SteamGameDlcsResult>("steam_get_game_dlcs", {
          appId,
          lang: steamCodeForUi(language),
          forceRefresh: force || undefined,
        });
        if (requestRef.current === request) setData(result);
      } catch (err) {
        if (requestRef.current === request) {
          setError(String(err));
          if (!data) setData(null);
        }
      } finally {
        if (requestRef.current === request) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [appId, data, language],
  );

  useEffect(() => {
    setData(null);
    setSearch("");
    void load(false);
    // `load` intentionally only follows the app id / language; the ref guard
    // inside handles overlapping requests.
  }, [appId, language]); // eslint-disable-line react-hooks/exhaustive-deps

  const dlcs = data?.dlcs ?? [];
  const counts = useMemo(() => dlcCounts(dlcs), [dlcs]);
  const filtered = useMemo(
    () => filterDlcList(dlcs, { filter: state.filter, query: search, sort: state.sort }),
    [dlcs, state.filter, state.sort, search],
  );

  const selected = useMemo(
    () => dlcs.find((dlc) => String(dlc.appId) === state.item) ?? null,
    [dlcs, state.item],
  );

  const percent = ownershipPercent(data?.totalDlcs ?? 0, data?.ownedCount ?? 0);
  const truncatedTotal = data?.totalAvailable ?? 0;

  const patchDlc = useCallback(
    (appIdOfDlc: number, patch: Partial<SteamDlcItem>) => {
      setData((prev) => {
        if (!prev) return prev;
        const nextDlcs = prev.dlcs.map((dlc) =>
          dlc.appId === appIdOfDlc ? { ...dlc, ...patch } : dlc,
        );
        return {
          ...prev,
          ownedCount: nextDlcs.filter((dlc) => dlc.isOwned).length,
          installedCount: nextDlcs.filter((dlc) => dlc.isInstalled).length,
          dlcs: nextDlcs,
        };
      });
    },
    [],
  );

  const handleToggleOwned = useCallback(
    async (dlc: SteamDlcItem) => {
      if (!appId) return;
      const next = !dlc.isOwned;
      patchDlc(dlc.appId, { isOwned: next });
      try {
        await invoke("steam_toggle_dlc_owned", {
          appId,
          dlcAppId: dlc.appId,
          owned: next,
        });
        showToast(
          next
            ? t("dlc.markedAsOwned", { name: dlc.name })
            : t("dlc.markedAsUnowned", { name: dlc.name }),
          "info",
        );
      } catch (err) {
        console.error("Failed to toggle DLC ownership:", err);
        patchDlc(dlc.appId, { isOwned: dlc.isOwned });
        showToast(t("dlc.toggleFailed"), "error");
      }
    },
    [appId, patchDlc, showToast, t],
  );

  const handleToggleWatch = useCallback(
    async (dlc: SteamDlcItem) => {
      if (!appId) return;
      const next = !dlc.isWatched;
      patchDlc(dlc.appId, { isWatched: next });
      try {
        await invoke("steam_set_dlc_watch", {
          appId,
          dlcAppId: dlc.appId,
          watch: next,
        });
      } catch (err) {
        console.error("Failed to update DLC watchlist:", err);
        patchDlc(dlc.appId, { isWatched: dlc.isWatched });
        showToast(t("dlc.watchFailed"), "error");
      }
    },
    [appId, patchDlc, showToast, t],
  );

  const handleMarkAllOwned = useCallback(async () => {
    if (!appId || !data) return;
    const unowned = data.dlcs.filter((dlc) => !dlc.isOwned);
    if (unowned.length === 0) return;
    const ids = new Set(unowned.map((dlc) => dlc.appId));
    setMarkAllPending(true);
    const previous = data.dlcs;
    setData({
      ...data,
      ownedCount: data.dlcs.length,
      dlcs: data.dlcs.map((dlc) =>
        ids.has(dlc.appId) ? { ...dlc, isOwned: true } : dlc,
      ),
    });
    try {
      await invoke("steam_mark_dlcs_owned", {
        appId,
        dlcAppIds: [...ids],
        owned: true,
      });
      showToast(t("dlc.markedAllAsOwned", { count: ids.size }), "info");
      setConfirmMarkAll(false);
    } catch (err) {
      console.error("Failed to mark all DLCs as owned:", err);
      setData((prev) => (prev ? { ...prev, dlcs: previous } : prev));
      showToast(t("dlc.toggleFailed"), "error");
    } finally {
      setMarkAllPending(false);
    }
  }, [appId, data, showToast, t]);

  const handleOpenStore = useCallback((dlc: SteamDlcItem) => {
    openUrl(`https://store.steampowered.com/app/${dlc.appId}/`).catch((err) => {
      console.warn("Failed to open Steam store link:", err);
    });
  }, []);

  const filterItems = useMemo(
    () => [
      { id: "all" as const, label: t("dlc.filterAll"), count: counts.all },
      { id: "owned" as const, label: t("dlc.filterOwned"), count: counts.owned },
      { id: "unowned" as const, label: t("dlc.filterUnowned"), count: counts.unowned },
      { id: "onSale" as const, label: t("dlc.filterOnSale"), count: counts.onSale },
      { id: "free" as const, label: t("dlc.filterFree"), count: counts.free },
      { id: "watched" as const, label: t("dlc.filterWatched"), count: counts.watched },
    ],
    [counts, t],
  );

  const stats: StatBandItem[] | undefined = data
    ? [
        {
          id: "total",
          label: t("dlc.totalAvailable"),
          value: data.totalDlcs,
          icon: <Package size={14} />,
          onClick: () => setState({ filter: "all" }),
        },
        {
          id: "owned",
          label: t("dlc.inLibrary"),
          value: data.ownedCount,
          detail: t("dlc.kpiOwnedDetail", { pct: percent }),
          progress: percent,
          tone: "success" as const,
          icon: <CheckCircle2 size={14} />,
          onClick: () => setState({ filter: "owned" }),
        },
        {
          id: "unowned",
          label: t("dlc.unowned"),
          value: counts.unowned,
          icon: <ShoppingBag size={14} />,
          onClick: () => setState({ filter: "unowned" }),
        },
        {
          id: "sale",
          label: t("dlc.onSale"),
          value: counts.onSale,
          tone: counts.onSale > 0 ? ("warning" as const) : "default",
          icon: <Percent size={14} />,
          onClick: () => setState({ filter: "onSale" }),
        },
        {
          id: "watched",
          label: t("dlc.filterWatched"),
          value: counts.watched,
          tone: counts.watched > 0 ? ("info" as const) : "default",
          icon: <Star size={14} />,
          onClick: () => setState({ filter: "watched" }),
        },
      ]
    : undefined;

  if (!appId) {
    return (
      <GameTabShell
        eyebrow={t("game.tab.dlc")}
        title={t("dlc.cardTitle")}
        icon={<IconDlc size={20} />}
      >
        <GameTabEmpty
          icon={<IconSteam size={26} />}
          title={t("dlc.noSteamLinked")}
          description={t("dlc.noSteamLinkedDesc")}
        />
      </GameTabShell>
    );
  }

  return (
    <GameTabShell
      eyebrow={t("game.tab.dlc")}
      title={t("dlc.cardTitle")}
      description={
        data
          ? t("dlc.headerSummary", {
              total: data.totalDlcs,
              owned: data.ownedCount,
            })
          : t("dlc.loadingSummary")
      }
      icon={<IconDlc size={20} />}
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={
              <RefreshCw
                size={14}
                className={refreshing ? "spin-animation" : undefined}
              />
            }
            onClick={() => void load(true)}
            disabled={refreshing || loading}
          >
            {t("common.refresh")}
          </Button>
          {data && counts.unowned > 0 && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<CheckCircle2 size={14} />}
              onClick={() => setConfirmMarkAll(true)}
            >
              {t("dlc.markAllOwned")}
            </Button>
          )}
        </>
      }
      stats={stats}
      statsLabel={t("dlc.kpiLabel")}
      toolbar={
        <GameTabToolbar
          search={
            <GameTabSearch
              value={search}
              onChange={setSearch}
              placeholder={t("dlc.searchPlaceholder")}
              label={t("dlc.searchPlaceholder")}
              clearLabel={t("game.news.clearFilter")}
            />
          }
          filters={
            <GameTabChips
              items={filterItems}
              value={state.filter}
              onChange={(filter) => setState({ filter })}
              ariaLabel={t("dlc.filtersLabel")}
            />
          }
          view={
            <GameTabViewSwitch
              items={[
                { id: "gallery", label: t("dlc.viewGallery"), icon: LayoutGrid },
                { id: "table", label: t("dlc.viewTable"), icon: Rows3 },
              ]}
              value={state.view}
              onChange={(view) => setState({ view })}
              ariaLabel={t("dlc.viewLabel")}
            />
          }
          actions={
            <select
              className="game-tab-select"
              value={state.sort}
              onChange={(event) => setState({ sort: event.target.value as DlcSort })}
              aria-label={t("dlc.sortLabel")}
            >
              <option value="default">{t("dlc.sortDefault")}</option>
              <option value="priceAsc">{t("dlc.sortPriceAsc")}</option>
              <option value="priceDesc">{t("dlc.sortPriceDesc")}</option>
              <option value="discount">{t("dlc.sortDiscount")}</option>
              <option value="name">{t("dlc.sortName")}</option>
              <option value="release">{t("dlc.sortRelease")}</option>
            </select>
          }
          below={
            truncatedTotal > dlcs.length ? (
              <p className="dlc-truncated">
                {t("dlc.truncatedHint", { count: truncatedTotal })}
              </p>
            ) : null
          }
        />
      }
    >
      {data?.familyShare?.isShared && (
        <div className="dlc-family-share">
          <span className="dlc-family-share__avatar">
            {data.familyShare.ownerAvatarUrl ? (
              <img
                src={data.familyShare.ownerAvatarUrl}
                alt=""
                loading="lazy"
              />
            ) : (
              <IconFamily size={18} />
            )}
          </span>
          <span className="dlc-family-share__body">
            <strong>{t("dlc.familySharing")}</strong>
            <span>
              {t("dlc.sharedBy", {
                owner: data.familyShare.ownerName || t("dlc.familyMember"),
                group: data.familyShare.familyGroupName || t("dlc.steamFamily"),
              })}
            </span>
          </span>
          <IconFamily size={16} className="dlc-family-share__mark" />
        </div>
      )}

      {loading && !data ? (
        <GameTabSkeleton count={6} height={230} />
      ) : error && !data ? (
        <GameTabEmpty
          variant="error"
          icon={<IconDlc size={26} />}
          title={t("dlc.loadFailed")}
          description={t("dlc.loadFailedDesc")}
          actions={
            <Button variant="primary" size="sm" onClick={() => void load(true)}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : !data || data.totalDlcs === 0 ? (
        <GameTabEmpty
          icon={<IconDlc size={26} />}
          title={t("dlc.noneFoundTitle")}
          description={t("dlc.noneFoundDesc")}
        />
      ) : filtered.length === 0 ? (
        <GameTabEmpty
          variant="filtered"
          icon={<IconDlc size={26} />}
          title={t("dlc.noMatches")}
          description={t("dlc.noMatchesDesc")}
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setState({ filter: "all" });
              }}
            >
              {t("game.news.clearFilter")}
            </Button>
          }
        />
      ) : state.view === "table" ? (
        <DlcTable
          dlcs={filtered}
          onOpen={(dlc) => setState({ item: String(dlc.appId) })}
          onToggleWatch={(dlc) => void handleToggleWatch(dlc)}
          onToggleOwned={(dlc) => void handleToggleOwned(dlc)}
          onOpenStore={handleOpenStore}
        />
      ) : (
        <div className="dlc-gallery">
          {filtered.map((dlc) => (
            <DlcCard
              key={dlc.appId}
              dlc={dlc}
              onOpen={(next) => setState({ item: String(next.appId) })}
              onToggleWatch={(next) => void handleToggleWatch(next)}
              onToggleOwned={(next) => void handleToggleOwned(next)}
              onOpenStore={handleOpenStore}
            />
          ))}
        </div>
      )}

      <DlcDrawer
        dlc={selected}
        onClose={() => setState({ item: "" })}
        onToggleWatch={(dlc) => void handleToggleWatch(dlc)}
        onToggleOwned={(dlc) => void handleToggleOwned(dlc)}
        onOpenStore={handleOpenStore}
      />

      <ConfirmModal
        open={confirmMarkAll}
        busy={markAllPending}
        title={t("dlc.markAllConfirmTitle", { count: counts.unowned })}
        message={t("dlc.markAllConfirmBody")}
        confirmLabel={t("dlc.markAllOwned")}
        confirmVariant="primary"
        cancelLabel={t("common.cancel")}
        onConfirm={() => void handleMarkAllOwned()}
        onCancel={() => {
          if (!markAllPending) setConfirmMarkAll(false);
        }}
      />
    </GameTabShell>
  );
}
