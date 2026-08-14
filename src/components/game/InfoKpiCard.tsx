import { useCallback, useMemo, type ReactNode } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { KpiTile } from "../ui";
import {
  formatSize,
  type Game,
  type PlayStatus,
  type SizeUnit,
} from "../../types/game";
import {
  IconBuilding,
  IconCalendar,
  IconCheck,
  IconCollection,
  IconExternalLink,
  IconFolder,
  IconHardDrive,
  IconInfo,
  IconPencil,
  IconPlatform,
  IconStar,
  IconTag,
  IconUser,
  IconUsers,
  IconClock,
  IconX,
} from "./icons";
import GameStatusDropdown from "./GameStatusDropdown";
import { useSteamGameStats, formatSteamPrice } from "../../hooks/useSteamGameStats";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useGames } from "../../context/GameContext";

/**
 * InfoKpiCard
 *
 *  Right-sidebar "Info" card. Hybrid layout surfacing the
 *  highest-value metadata as a row of KPI tiles, with the
 *  remaining fields in a scannable definition list.
 */

interface InfoKpiCardProps {
  game: Game;
  sizeUnit: SizeUnit;
  onEditSize?: () => void;
  /** Hide the play-status KPI tile (used on store pages where "Backlog" is meaningless). */
  hideStatus?: boolean;
}

interface DetailRow {
  label: string;
  value: ReactNode;
  icon: ReactNode;
}

function getParentDir(filePath: string): string | null {
  if (!filePath) return null;
  const trimmed = filePath.replace(/[\\/]+$/, "");
  if (!trimmed) return null;
  const lastSep = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (lastSep < 0) return null;
  if (lastSep === 0) return null;
  const parent = trimmed.slice(0, lastSep);
  if (!parent) return null;
  if (/^[A-Za-z]:$/.test(parent)) return null;
  return parent;
}

const EXE_PATH_DISPLAY_MAX = 56;
function shortExePath(filePath: string): string {
  if (filePath.length <= EXE_PATH_DISPLAY_MAX) return filePath;
  const TAIL_LEN = EXE_PATH_DISPLAY_MAX - 2;
  return "…" + filePath.slice(-TAIL_LEN);
}

export default function InfoKpiCard({
  game,
  sizeUnit,
  onEditSize,
  hideStatus,
}: InfoKpiCardProps) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { updateGame } = useGames();

  const { data: steamStats } = useSteamGameStats(game.steamAppId);

  const priceCents = steamStats?.details?.priceCents ?? null;
  const priceCurrency = steamStats?.details?.currency ?? null;
  const priceIsFree = steamStats?.details?.isFree ?? false;
  const hasPrice =
    steamStats?.details != null &&
    (priceIsFree || (priceCents != null && priceCents > 0));

  const exePath = game.path?.trim() ?? "";
  const parentDir = exePath ? getParentDir(exePath) : null;
  const showExecutable = Boolean(parentDir);
  const displayPath = shortExePath(exePath);

  const handleOpenInExplorer = useCallback(async () => {
    if (!parentDir) return;
    try {
      await openPath(parentDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Could not open folder: ${message}`, "error");
    }
  }, [parentDir, showToast]);

  const handleCopyPath = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!exePath) return;
      try {
        await navigator.clipboard.writeText(exePath);
        showToast(t("common.copiedToClipboard", { label: t("info.executable") }), "success");
      } catch {
        showToast(t("common.copyFailed"), "error");
      }
    },
    [exePath, showToast, t]
  );

  const handleCopyAppId = useCallback(
    async (appId: number) => {
      try {
        await navigator.clipboard.writeText(String(appId));
        showToast(t("common.copiedToClipboard", { label: "AppID" }), "success");
      } catch {
        showToast(t("common.copyFailed"), "error");
      }
    },
    [showToast, t]
  );

  const handleStatusChange = useCallback(
    (status: PlayStatus) => updateGame(game.id, { playStatus: status }),
    [game.id, updateGame]
  );

  const kpis = useMemo(() => {
    const items: ReactNode[] = [];

    if (!hideStatus) {
      items.push(
        <KpiTile
          key="play-status"
          size="sm"
          label={t("hero.status")}
          icon={<IconStar size={12} />}
          value={<GameStatusDropdown game={game} onChange={handleStatusChange} />}
          intent={
            game.playStatus === "playing"
              ? "success"
              : game.playStatus === "completed"
                ? "info"
                : game.playStatus === "on_hold"
                  ? "warning"
                  : game.playStatus === "abandoned"
                    ? "danger"
                    : "default"
          }
        />
      );
    }

    items.push(
      <KpiTile
        key="play-time"
        size="sm"
        label={t("hero.playTime")}
        icon={<IconClock size={12} />}
        value={game.playTime}
        subtext={game.installed ? t("filter.installed") : t("game.notInstalled")}
        intent={game.installed ? "success" : "default"}
      />
    );

    if (game.sizeBytes != null) {
      items.push(
        <KpiTile
          key="size"
          size="sm"
          label={t("info.size")}
          icon={<IconHardDrive size={12} />}
          value={formatSize(game.sizeBytes, sizeUnit)}
          trailing={<IconPencil size={12} className="kpi-tile__pencil" />}
          {...(onEditSize
            ? {
                onClick: onEditSize,
                role: "button",
                tabIndex: 0,
                title: t("info.editSize"),
              }
            : {})}
          className="kpi-tile--clickable"
        />
      );
    }

    const showPrice = hasPrice;
    items.push(
      <KpiTile
        key="price"
        size="sm"
        label={t("info.price")}
        icon={<IconTag size={12} />}
        value={showPrice ? formatSteamPrice(priceCents, priceCurrency, priceIsFree) : "—"}
        subtext={showPrice ? (priceIsFree ? "Steam" : t("info.onSteam")) : t("common.loading")}
        intent={!showPrice ? "default" : priceIsFree ? "success" : "default"}
      />
    );

    return items;
  }, [
    game,
    sizeUnit,
    onEditSize,
    hasPrice,
    priceCents,
    priceCurrency,
    priceIsFree,
    hideStatus,
    handleStatusChange,
    t,
  ]);

  const rows = useMemo<DetailRow[]>(() => {
    const addedDate = new Date(game.addedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const out: DetailRow[] = [
      { label: t("info.platform"), value: game.platform, icon: <IconPlatform size={12} /> },
      { label: t("hero.added"), value: addedDate, icon: <IconCalendar size={12} /> },
    ];

    if (game.steamAppId) {
      out.push({
        label: "Steam AppID",
        value: (
          <span
            className="info-appid-pill"
            onClick={() => handleCopyAppId(game.steamAppId!)}
            title={t("gamePage.copyAppId")}
            role="button"
            tabIndex={0}
          >
            <span>{game.steamAppId}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 11, height: 11, opacity: 0.7 }}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </span>
        ),
        icon: <IconTag size={12} />,
      });
    }

    if (game.developer) {
      out.push({
        label: t("info.developer"),
        value: game.developer,
        icon: <IconUser size={12} />,
      });
    }
    if (game.publisher) {
      out.push({
        label: t("info.publisher"),
        value: game.publisher,
        icon: <IconBuilding size={12} />,
      });
    }
    if (game.releaseDate) {
      out.push({
        label: t("info.released"),
        value: game.releaseDate,
        icon: <IconCalendar size={12} />,
      });
    }
    if (game.collection) {
      out.push({
        label: t("info.series"),
        value: game.collection,
        icon: <IconCollection size={12} />,
      });
    }
    if (game.franchise) {
      out.push({
        label: t("info.franchise"),
        value: game.franchise,
        icon: <IconCollection size={12} />,
      });
    }
    if (game.gameCategory) {
      out.push({
        label: t("info.gameType"),
        value: game.gameCategory,
        icon: <IconInfo size={12} />,
      });
    }
    if (game.releaseStatus) {
      const isFutureRelease =
        !!game.releaseDate &&
        (() => {
          const tm = new Date(game.releaseDate).getTime();
          return Number.isFinite(tm) && tm > Date.now();
        })();
      const effectiveStatus =
        isFutureRelease && game.releaseStatus.toLowerCase().includes("released")
          ? "Upcoming"
          : game.releaseStatus;
      const intent = effectiveStatus.toLowerCase().includes("released")
        ? "success"
        : effectiveStatus.toLowerCase().includes("early")
          ? "warning"
          : effectiveStatus.toLowerCase() === "upcoming"
            ? "info"
            : "default";
      out.push({
        label: t("info.releaseStatus"),
        value: (
          <span className={`info-dl-value-tag info-dl-value-tag--${intent}`}>
            {effectiveStatus}
          </span>
        ),
        icon: <IconCheck size={12} />,
      });
    }
    if (game.alternativeNames && game.alternativeNames.length > 0) {
      out.push({
        label: t("info.aka"),
        value: game.alternativeNames.join(", "),
        icon: <IconUsers size={12} />,
      });
    }
    return out;
  }, [game, t, handleCopyAppId]);

  return (
    <section className="game-section info-kpi-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconInfo size={16} />
        </span>
        {t("info.title")}
      </h2>

      {kpis.length > 0 && <div className="kpi-row">{kpis}</div>}

      <dl className="info-dl">
        {rows.map((row) => (
          <div className="info-dl-row" key={row.label}>
            <dt className="info-dl-label">
              <span className="info-dl-icon" aria-hidden>
                {row.icon}
              </span>
              {row.label}
            </dt>
            <dd className="info-dl-value">{row.value}</dd>
          </div>
        ))}
        {!kpis.length && rows.length === 0 && (
          <div className="info-dl-empty">
            <IconX size={14} />
            {t("info.noMetadata")}
          </div>
        )}
      </dl>

      {showExecutable && (
        <div className="info-exe-path-container">
          <button
            type="button"
            className="info-exe-path"
            onClick={handleOpenInExplorer}
            title={t("info.openFolderTitle", { path: exePath })}
            aria-label={t("info.openFolderTitle", { path: exePath })}
          >
            <span className="info-exe-path__head">
              <span className="info-exe-path__folder" aria-hidden>
                <IconFolder size={12} />
              </span>
              <span className="info-exe-path__label">{t("info.executable")}</span>
            </span>
            <span className="info-exe-path__body">
              <span className="info-exe-path__text">{displayPath}</span>
              <span className="info-exe-path__arrow" aria-hidden>
                <IconExternalLink size={14} />
              </span>
            </span>
          </button>
          <button
            type="button"
            className="info-exe-copy-btn"
            onClick={handleCopyPath}
            title={t("gamePage.copyPath")}
            aria-label={t("gamePage.copyPath")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      )}

      {game.genres && game.genres.length > 0 && (
        <div className="info-genres">
          {game.genres.map((g) => (
            <span key={g} className="spec-pill">
              {g}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
