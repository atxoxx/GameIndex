import { Gamepad2, HardDrive, CalendarPlus, Clock } from "lucide-react";
import { useMemo } from "react";
import { StatBand, type StatBandItem } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime, parsePlayTime, type Game } from "../../types/game";

interface LibraryStatBandProps {
  games: Game[];
  installedCount: number;
  onToggleInstalled: () => void;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * LibraryStatBand — the four-figure overview under the page header.
 *
 * Uses the shared `StatBand` so the numbers read as part of the page rather
 * than as a row of widgets. The installed figure doubles as the fastest way
 * into the "Installed" scope, which is the one metric people act on.
 */
export default function LibraryStatBand({
  games,
  installedCount,
  onToggleInstalled,
}: LibraryStatBandProps) {
  const { t } = useLanguage();

  const totalPlaytime = useMemo(
    () => formatPlayTime(games.reduce((sum, game) => sum + parsePlayTime(game.playTime), 0)),
    [games]
  );

  const addedThisWeek = useMemo(() => {
    const cutoff = Date.now() - WEEK_MS;
    return games.filter((game) => (game.addedAt ?? 0) >= cutoff).length;
  }, [games]);

  const installedPct = games.length > 0 ? Math.round((installedCount / games.length) * 100) : 0;

  const items: StatBandItem[] = useMemo(() => [
    {
      id: "total",
      label: t("lib.hero.stat.total"),
      value: games.length,
      icon: <Gamepad2 size={14} />,
      tone: "accent",
    },
    {
      id: "installed",
      label: t("lib.hero.stat.installed"),
      value: installedCount,
      icon: <HardDrive size={14} />,
      tone: "success",
      detail:
        games.length > 0
          ? t("lib.hero.stat.pctOfLibrary", { count: installedPct })
          : t("lib.hero.stat.installedPct"),
      onClick: onToggleInstalled,
      hint: t("filter.installed"),
    },
    {
      id: "playtime",
      label: t("lib.hero.stat.playtime"),
      value: totalPlaytime,
      icon: <Clock size={14} />,
      tone: "info",
    },
    {
      id: "added",
      label: t("lib.hero.stat.addedWeek"),
      value: addedThisWeek,
      icon: <CalendarPlus size={14} />,
      tone: "warning",
      detail: addedThisWeek === 1 ? t("lib.hero.stat.addedWeekSub") : undefined,
    },
  ], [games.length, installedCount, installedPct, totalPlaytime, addedThisWeek, t, onToggleInstalled]);
 
  return (
    <StatBand
      className="library-stat-band"
      ariaLabel={t("library.overviewAria")}
      items={items}
    />
  );
}
