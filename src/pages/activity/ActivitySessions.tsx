import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import LineChart from "../../components/charts/LineChart";
import { ActivitySparkline } from "./ActivitySparkline";
import { GameThumbnail } from "./GameThumbnail";
import PlayerCountBadge from "../../components/PlayerCountBadge";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useSettings } from "../../context/SettingsContext";
import { useActivity } from "../../context/ActivityContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import { buildSingleSessionSeries } from "../../utils/perfSamples";
import {
  formatTemp,
  toDisplayTemp,
  toDisplayTemps,
  tempUnitLabel,
  tempThreshold,
  tempMinY,
  tempMaxY,
} from "../../utils/temp";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime, type Game, type GameSession } from "../../types/game";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useToast } from "../../context/ToastContext";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { generateEstimatedTimeline } from "./performance/perfData";
import { EmptyState, ManualSessionModal, SessionComparisonModal, LinkGameModal, AddActivityGameModal } from "../../components/activity";
import * as Icons from "./Icons";

export interface ActivitySessionsProps {
  sessions: GameSession[];
  games: Game[];
  onDeleteSession: (id: string) => void;
  onLaunchGame?: (game: Game) => void;
}

type SortField = "date" | "duration" | "fps" | "gpuTemp";
type SortOrder = "asc" | "desc";

export function ActivitySessions({
  sessions,
  games,
  onDeleteSession,
  onLaunchGame,
}: ActivitySessionsProps) {
  const { t, language } = useLanguage();
  const { getAllNotes } = useSessionNotes();
  const { showToast } = useToast();
  const { tempUnit } = useSettings();

  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<"all" | "7d" | "30d" | "90d">("all");
  const [telemetryFilter, setTelemetryFilter] = useState<"all" | "telemetry" | "notes">("all");
  const [durationFilter, setDurationFilter] = useState<"all" | "quick" | "medium" | "long">("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [pendingDeleteSession, setPendingDeleteSession] = useState<GameSession | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [manualSessionOpen, setManualSessionOpen] = useState(false);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [linkModalTarget, setLinkModalTarget] = useState<{ id: string; title: string } | null>(null);
  const [addModalTarget, setAddModalTarget] = useState<{ id: string; title: string } | null>(null);

  // ── Windowed rendering ───────────────────────────────────────
  // Session history can grow to thousands of rows, and every row mounts
  // live components (GameThumbnail, PlayerCountBadge, per-metric hooks),
  // so mounting all of them at once stalls the initial render even before
  // layout. Only the first `visibleLimit` rows mount; a sentinel at the
  // bottom extends the window as the user scrolls (IntersectionObserver,
  // generous rootMargin so the next batch is ready before it scrolls in).
  const [visibleLimit, setVisibleLimit] = useState(60);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const gameById = useMemo(() => {
    const map = new Map<string, Game>();
    games.forEach((g) => map.set(g.id, g));
    return map;
  }, [games]);

  const allNotes = useMemo(() => getAllNotes(), [getAllNotes]);

  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => {
      if (g.platform) set.add(g.platform);
    });
    return Array.from(set).sort();
  }, [games]);

  const filteredAndSortedSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = sessions.filter((s) => {
      if (q && !s.gameName.toLowerCase().includes(q)) return false;

      if (sourceFilter !== "all") {
        const game = gameById.get(s.gameId);
        if ((game?.platform || "Local").toLowerCase() !== sourceFilter.toLowerCase()) return false;
      }

      if (telemetryFilter === "telemetry" && (!s.metrics || s.metrics.avgCpuUsage === 0)) {
        return false;
      }
      if (telemetryFilter === "notes") {
        const note = allNotes[s.id];
        if (!note || (!note.note && note.tags.length === 0)) return false;
      }

      if (dateRangeFilter !== "all") {
        const days = dateRangeFilter === "7d" ? 7 : dateRangeFilter === "30d" ? 30 : 90;
        const cutoff = Date.now() - days * 86_400_000;
        if (new Date(s.date).getTime() < cutoff) return false;
      }

      if (durationFilter === "quick" && s.durationMin >= 30) return false;
      if (durationFilter === "medium" && (s.durationMin < 30 || s.durationMin > 120)) return false;
      if (durationFilter === "long" && s.durationMin <= 120) return false;

      return true;
    });

    return list.sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      if (sortField === "duration") {
        return (a.durationMin - b.durationMin) * dir;
      }
      if (sortField === "fps") {
        const fpsA = a.metrics?.avgFps || 0;
        const fpsB = b.metrics?.avgFps || 0;
        return (fpsA - fpsB) * dir;
      }
      if (sortField === "gpuTemp") {
        const tempA = a.metrics?.avgGpuTemp || 0;
        const tempB = b.metrics?.avgGpuTemp || 0;
        return (tempA - tempB) * dir;
      }
      // Date default
      return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir;
    });
  }, [
    sessions,
    searchQuery,
    sourceFilter,
    dateRangeFilter,
    telemetryFilter,
    durationFilter,
    sortField,
    sortOrder,
    gameById,
    allNotes,
  ]);

  // Any change to the filtered/sorted list (new filter, new sort, a session
  // deleted) resets the window so the user starts back at the top batch.
  useEffect(() => {
    setVisibleLimit(60);
  }, [filteredAndSortedSessions]);

  const visibleSessions = useMemo(
    () => filteredAndSortedSessions.slice(0, visibleLimit),
    [filteredAndSortedSessions, visibleLimit]
  );

  // Extend the window when the sentinel scrolls near the viewport. Re-runs on
  // every increase so the observer keeps watching the (still-mounted) sentinel.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleLimit((prev) => prev + 120);
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibleLimit]);

  const selectedPair = useMemo(() => {
    if (selectedSessionIds.size !== 2) return null;
    const arr = Array.from(selectedSessionIds);
    return { a: arr[0], b: arr[1] };
  }, [selectedSessionIds]);

  const handleExportSelectedCSV = () => {
    const list = sessions.filter((s) => selectedSessionIds.has(s.id));
    if (list.length === 0) return;

    const headers = [
      t("activityCsv.sessionId"),
      t("activityCsv.gameName"),
      t("activityCsv.gameId"),
      t("activityCsv.datePlayed"),
      t("activityCsv.durationMinutes"),
      t("activityCsv.platform"),
      t("activityCsv.avgFps"),
      t("activityCsv.minFps"),
      t("activityCsv.maxFps"),
      t("activityCsv.avgCpuUsage"),
      t("activityCsv.avgGpuUsage"),
      t("activityCsv.avgRamUsage"),
      t("activityCsv.avgCpuTemp", { unit: tempUnitLabel(tempUnit) }),
      t("activityCsv.avgGpuTemp", { unit: tempUnitLabel(tempUnit) }),
      t("sessionNotes.title"),
    ];

    const rows = list.map((s) => {
      const game = games.find((g) => g.id === s.gameId);
      const note = allNotes[s.id]?.note || "";
      return [
        s.id,
        s.gameName,
        s.gameId,
        s.date,
        s.durationMin,
        game?.platform || "Local",
        s.metrics?.avgFps || "—",
        s.metrics?.minFps || "—",
        s.metrics?.maxFps || "—",
        s.metrics?.avgCpuUsage || "—",
        s.metrics?.avgGpuUsage || "—",
        s.metrics?.avgRamUsage || "—",
        s.metrics?.avgCpuTemp || "—",
        s.metrics?.avgGpuTemp || "—",
        note,
      ];
    });

    const csvContent = [headers.join(","), ...rows.map((row) => row.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `gamelib_selected_sessions_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(t("activity.exportedAs", { format: "CSV" }), "success");
  };

  const handleExportSelectedJSON = async () => {
    const list = sessions.filter((s) => selectedSessionIds.has(s.id));
    if (list.length === 0) return;

    try {
      const exportData = {
        exportedAt: new Date().toISOString(),
        totalSessions: list.length,
        sessions: list.map((s) => ({
          ...s,
          platform: games.find((g) => g.id === s.gameId)?.platform || "Local",
          notes: allNotes[s.id] || null,
        })),
      };

      const suggestedName = `gamelib_selected_sessions_${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = await save({
        defaultPath: suggestedName,
        filters: [{ name: "JSON File", extensions: ["json"] }],
      });

      if (filePath) {
        await invoke("save_text_file", {
          filePath,
          contents: JSON.stringify(exportData, null, 2),
        });
        showToast(t("activity.exportedAs", { format: "JSON" }), "success");
      }
    } catch (err) {
      console.error("JSON export failed:", err);
      showToast(t("activity.exportFailed", { error: String(err) }), "error");
    }
  };

  const toggleSelectAll = () => {
    if (selectedSessionIds.size === filteredAndSortedSessions.length) {
      setSelectedSessionIds(new Set());
    } else {
      setSelectedSessionIds(new Set(filteredAndSortedSessions.map((s) => s.id)));
    }
  };

  const toggleSelectSession = (id: string) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = () => {
    selectedSessionIds.forEach((id) => onDeleteSession(id));
    setSelectedSessionIds(new Set());
    setConfirmBatchDelete(false);
  };

  return (
    <div className="activity-sessions-page">
      {/* ── Filter & Search Toolbar ──────────────────────────────── */}
      <div className="activity-sessions-toolbar">
        <div className="activity-sessions-toolbar__search">
          <Icons.Search size={13} className="activity-sessions-toolbar__search-icon" />
          <input
            type="text"
            className="activity-sessions-toolbar__search-input"
            placeholder={t("activityDash.searchGames")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="activity-sessions-toolbar__clear-btn"
              onClick={() => setSearchQuery("")}
            >
              <Icons.X size={12} />
            </button>
          )}
        </div>

        <div className="activity-sessions-toolbar__filters">
          <select
            className="act-toolbar__select"
            value={dateRangeFilter}
            onChange={(e) => setDateRangeFilter(e.target.value as "all" | "7d" | "30d" | "90d")}
            aria-label={t("activity.range")}
          >
            <option value="all">{t("activity.allTime")}</option>
            <option value="7d">{t("activity.7d")}</option>
            <option value="30d">{t("activity.30d")}</option>
            <option value="90d">{t("activity.90d")}</option>
          </select>

          <select
            className="act-toolbar__select"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label={t("activityPage.source")}
          >
            <option value="all">{t("activity.sourceAll")}</option>
            {availablePlatforms.map((plat) => (
              <option key={plat} value={plat}>
                {plat}
              </option>
            ))}
          </select>

          <select
            className="act-toolbar__select"
            value={telemetryFilter}
            onChange={(e) => setTelemetryFilter(e.target.value as "all" | "telemetry" | "notes")}
            aria-label={t("activitySessions.filterType")}
          >
            <option value="all">{t("activitySessions.filterAll")}</option>
            <option value="telemetry">{t("activitySessions.filterWithTelemetry")}</option>
            <option value="notes">{t("activitySessions.filterWithNotes")}</option>
          </select>

          <select
            className="act-toolbar__select"
            value={durationFilter}
            onChange={(e) => setDurationFilter(e.target.value as "all" | "quick" | "medium" | "long")}
            aria-label={t("activitySessions.durationFilter")}
          >
            <option value="all">{t("activitySessions.allDurations")}</option>
            <option value="quick">&lt; 30m ({t("activityInsights.sessionBucket.quick")})</option>
            <option value="medium">30m – 2h ({t("activityInsights.sessionBucket.short")})</option>
            <option value="long">&gt; 2h ({t("activityInsights.sessionBucket.long")})</option>
          </select>

          <div className="activity-sessions-toolbar__sort">
            <select
              className="act-toolbar__select"
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              aria-label={t("activitySessions.sortBy")}
            >
              <option value="date">{t("activitySessions.sortDate")}</option>
              <option value="duration">{t("activitySessions.sortDuration")}</option>
              <option value="fps">{t("activitySessions.sortFps")}</option>
              <option value="gpuTemp">{t("activitySessions.sortGpuTemp")}</option>
            </select>
            <button
              type="button"
              className="activity-sessions-toolbar__sort-dir-btn"
              onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
              title={sortOrder === "asc" ? t("activitySessions.ascending") : t("activitySessions.descending")}
            >
              {sortOrder === "asc" ? <Icons.ChevronUp size={13} /> : <Icons.ChevronDown size={13} />}
            </button>
          </div>

          <button
            type="button"
            className="act-inspector-btn act-inspector-btn--primary act-inspector-btn--sm"
            onClick={() => setManualSessionOpen(true)}
            title={t("activityManual.logSessionBtn")}
          >
            <Icons.Plus size={12} /> {t("activityManual.logSessionBtn")}
          </button>
        </div>
      </div>

      {/* ── Batch Actions Bar ────────────────────────────────────── */}
      {selectedSessionIds.size > 0 && (
        <div className="activity-sessions-batch-bar">
          <span className="activity-sessions-batch-bar__count">
            {t("activitySessions.selectedCount", { count: selectedSessionIds.size })}
          </span>
          <div className="activity-sessions-batch-bar__actions">
            {selectedSessionIds.size === 2 && (
              <button
                type="button"
                className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
                onClick={() => setCompareModalOpen(true)}
              >
                <Icons.ArrowRightLeft size={12} /> {t("activityCompare.compareBtn")}
              </button>
            )}
            <button
              type="button"
              className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
              onClick={handleExportSelectedCSV}
              title={t("activity.exportCsv")}
            >
              <Icons.Download size={12} /> CSV
            </button>
            <button
              type="button"
              className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
              onClick={handleExportSelectedJSON}
              title={t("activity.exportJson")}
            >
              <Icons.FileText size={12} /> JSON
            </button>
            <button
              type="button"
              className="act-inspector-btn act-inspector-btn--danger act-inspector-btn--sm"
              onClick={() => setConfirmBatchDelete(true)}
            >
              <Icons.Trash2 size={12} /> {t("activitySessions.deleteSelected")}
            </button>
            <button
              type="button"
              className="act-inspector-btn act-inspector-btn--ghost act-inspector-btn--sm"
              onClick={() => setSelectedSessionIds(new Set())}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* ── Sessions List ────────────────────────────────────────── */}
      {filteredAndSortedSessions.length === 0 ? (
        <div className="section-panel">
          <EmptyState
            icon={<Icons.History size={24} />}
            title={t("activitySessions.noMatchingSessions")}
            hint={t("activitySessions.noMatchingHint")}
          />
        </div>
      ) : (
        <div className="activity-sessions-list">
          <div className="activity-sessions-list__header">
            <button
              type="button"
              className="activity-sessions-list__select-all"
              onClick={toggleSelectAll}
            >
              {selectedSessionIds.size === filteredAndSortedSessions.length ? (
                <Icons.CheckSquare size={14} />
              ) : (
                <Icons.Square size={14} />
              )}
              <span>{t("activitySessions.selectAll")}</span>
            </button>
            <span className="activity-sessions-list__total-count">
              {t("activitySessions.showingCount", {
                count: filteredAndSortedSessions.length,
                total: sessions.length,
              })}
            </span>
          </div>

          {visibleSessions.map((session) => {
            const game = gameById.get(session.gameId);
            const isSelected = selectedSessionIds.has(session.id);

            return (
              <ActivitySessionItem
                key={session.id}
                session={session}
                game={game}
                isSelected={isSelected}
                onToggleSelect={() => toggleSelectSession(session.id)}
                onRequestDelete={(s) => setPendingDeleteSession(s)}
                onLaunchGame={onLaunchGame}
                onRequestLink={(id, title) => setLinkModalTarget({ id, title })}
                onRequestAdd={(id, title) => setAddModalTarget({ id, title })}
              />
            );
          })}
          {filteredAndSortedSessions.length > visibleLimit && (
            <div
              ref={sentinelRef}
              className="activity-sessions-list__sentinel"
              aria-hidden="true"
            />
          )}
        </div>
      )}

      {/* ── Delete Single Session Confirmation ───────────────────── */}
      {pendingDeleteSession && (
        <ConfirmModal
          open={true}
          title={t("activitySessions.deleteConfirmTitle")}
          message={t("activitySessions.deleteConfirmBody", {
            game: pendingDeleteSession.gameName,
            date: new Date(pendingDeleteSession.date).toLocaleDateString(language, {
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
          })}
          confirmLabel={t("common.delete")}
          onConfirm={() => {
            onDeleteSession(pendingDeleteSession.id);
            setPendingDeleteSession(null);
          }}
          onCancel={() => setPendingDeleteSession(null)}
        />
      )}

      {/* ── Batch Delete Confirmation ────────────────────────────── */}
      {confirmBatchDelete && (
        <ConfirmModal
          open={true}
          title={t("activitySessions.batchDeleteConfirmTitle")}
          message={t("activitySessions.batchDeleteConfirmBody", {
            count: selectedSessionIds.size,
          })}
          confirmLabel={t("common.delete")}
          onConfirm={handleBatchDelete}
          onCancel={() => setConfirmBatchDelete(false)}
        />
      )}

      <ManualSessionModal
        isOpen={manualSessionOpen}
        onClose={() => setManualSessionOpen(false)}
        games={games}
      />

      <SessionComparisonModal
        isOpen={compareModalOpen}
        onClose={() => setCompareModalOpen(false)}
        sessions={sessions}
        initialSessionAId={selectedPair?.a}
        initialSessionBId={selectedPair?.b}
      />

      {linkModalTarget && (
        <LinkGameModal
          isOpen={true}
          onClose={() => setLinkModalTarget(null)}
          unlinkedGameId={linkModalTarget.id}
          unlinkedGameTitle={linkModalTarget.title}
          games={games}
        />
      )}

      {addModalTarget && (
        <AddActivityGameModal
          isOpen={true}
          onClose={() => setAddModalTarget(null)}
          unlinkedGameId={addModalTarget.id}
          unlinkedGameTitle={addModalTarget.title}
        />
      )}
    </div>
  );
}

interface SessionItemProps {
  session: GameSession;
  game: Game | undefined;
  isSelected: boolean;
  onToggleSelect: () => void;
  onRequestDelete: (session: GameSession) => void;
  onLaunchGame?: (game: Game) => void;
  onRequestLink?: (gameId: string, gameTitle: string) => void;
  onRequestAdd?: (gameId: string, gameTitle: string) => void;
}

function ActivitySessionItem({
  session,
  game,
  isSelected,
  onToggleSelect,
  onRequestDelete,
  onLaunchGame,
  onRequestLink,
  onRequestAdd,
}: SessionItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeChartTab, setActiveChartTab] = useState<"usage" | "temps" | "ram" | "fps">("usage");
  const [isEditingNote, setIsEditingNote] = useState(false);
  const { tempUnit } = useSettings();
  const { totalRamGb } = useActivity();
  const { getNote, setNote, setTags } = useSessionNotes();
  const { t, language } = useLanguage();
  const navigate = useNavigate();

  const noteData = getNote(session.id);
  const [noteText, setNoteText] = useState(noteData.note);
  const [tagsList, setTagsList] = useState(noteData.tags);
  const [tagInput, setTagInput] = useState("");

  const { appId: resolvedSteamAppId } = useSteamAppId(game ?? null);
  const steamAppId =
    typeof resolvedSteamAppId === "number"
      ? resolvedSteamAppId
      : game?.steamAppId ?? null;

  const durationMs = session.durationMin * 60 * 1000;

  const formattedDate = useMemo(() => {
    const d = new Date(session.date);
    return d.toLocaleDateString(language, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [session.date, language]);

  const formattedTime = useMemo(() => {
    const d = new Date(session.date);
    const start = new Date(d.getTime() - durationMs);
    const fmt = (date: Date) => date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
    return `${fmt(start)} – ${fmt(d)}`;
  }, [session.date, durationMs, language]);

  const formattedDuration = useMemo(() => {
    return formatPlayTime(session.durationMin);
  }, [session.durationMin]);

  const chartProps = useMemo(() => {
    if (!session.metrics) return null;
    const m = session.metrics;
    const pts = 45;

    const real = buildSingleSessionSeries(m, pts);
    let fps: number[], cpu: number[], gpu: number[], cpuTemp: number[], gpuTemp: number[], ram: number[];

    if (real) {
      fps = real.fps;
      cpu = real.cpu;
      gpu = real.gpu;
      cpuTemp = real.cpuTemp;
      gpuTemp = real.gpuTemp;
      ram = real.ram;
    } else {
      const seedKey = `session-${session.id}`;
      fps = generateEstimatedTimeline(m.avgFps, m.minFps, m.maxFps, pts, `fps:${seedKey}`);
      cpu = generateEstimatedTimeline(
        m.avgCpuUsage,
        Math.round(m.avgCpuUsage * 0.4),
        Math.round(m.avgCpuUsage * 1.5),
        pts,
        `cpu:${seedKey}`,
      ).map((v) => Math.min(100, Math.max(0, v)));
      gpu = generateEstimatedTimeline(
        m.avgGpuUsage,
        Math.round(m.avgGpuUsage * 0.3),
        Math.round(m.avgGpuUsage * 1.6),
        pts,
        `gpu:${seedKey}`,
      ).map((v) => Math.min(100, Math.max(0, v)));
      cpuTemp = generateEstimatedTimeline(m.avgCpuTemp, m.avgCpuTemp - 7, m.avgCpuTemp + 11, pts, `cputemp:${seedKey}`);
      gpuTemp = generateEstimatedTimeline(m.avgGpuTemp, m.avgGpuTemp - 6, m.avgGpuTemp + 9, pts, `gputemp:${seedKey}`);
      ram = generateEstimatedTimeline(
        m.avgRamUsage,
        Math.round(m.avgRamUsage * 0.8),
        Math.round(m.avgRamUsage * 1.15),
        pts,
        `ram:${seedKey}`,
      ).map((v) => Math.min(100, Math.max(0, v)));
    }

    const labels = Array.from({ length: pts }).map((_, i) => `${Math.round((i / (pts - 1)) * 100)}%`);

    return { fps, cpu, gpu, cpuTemp, gpuTemp, ram, labels, real: Boolean(real) };
  }, [session.metrics, session.id]);

  const chartSeries = useMemo(() => {
    if (!chartProps) return [];
    if (activeChartTab === "usage") {
      return [
        { data: chartProps.cpu, color: "var(--color-brand-blue)", label: t("activity.sessions.cpuLoad") },
        { data: chartProps.gpu, color: "var(--color-accent)", label: t("activity.sessions.gpuLoad") },
      ];
    } else if (activeChartTab === "temps") {
      return [
        { data: toDisplayTemps(chartProps.cpuTemp, tempUnit), color: "var(--color-danger)", label: t("activityPerf.cpuTemp") },
        { data: toDisplayTemps(chartProps.gpuTemp, tempUnit), color: "var(--color-warning)", label: t("activityPerf.gpuTemp") },
      ];
    } else if (activeChartTab === "ram") {
      const totalRam = totalRamGb || 16;
      const ramGb = chartProps.ram.map((v) => Math.round((totalRam * v) / 10) / 10);
      return [{ data: ramGb, color: "var(--color-success)", label: t("activityPerf.ramUsage") }];
    } else {
      return [{ data: chartProps.fps, color: "var(--color-brand-teal)", label: t("activityPerf.fps") }];
    }
  }, [chartProps, activeChartTab, tempUnit, totalRamGb, t]);

  const yValFormatter = (val: number) => {
    if (activeChartTab === "usage") return `${Math.round(val)}%`;
    if (activeChartTab === "temps") return formatTemp(val, tempUnit);
    if (activeChartTab === "ram") return `${val.toFixed(1)} GB`;
    return `${Math.round(val)} FPS`;
  };

  const chartExtra = useMemo<Partial<ComponentProps<typeof LineChart>>>(() => {
    if (activeChartTab === "usage") {
      return {
        smooth: true,
        minY: 0,
        maxY: 100,
        thresholds: [{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }],
      };
    }
    if (activeChartTab === "temps") {
      return {
        smooth: true,
        minY: tempMinY(tempUnit),
        maxY: tempMaxY(tempUnit),
        bands: [
          { from: tempThreshold(85, tempUnit), to: tempMaxY(tempUnit), color: "var(--color-danger)", opacity: 0.1 },
        ],
        thresholds: [
          { value: tempThreshold(75, tempUnit), label: t("activityPerf.warmThreshold"), color: "var(--color-warning)" },
          { value: tempThreshold(85, tempUnit), label: t("activityPerf.hotThreshold"), color: "var(--color-danger)" },
        ],
      };
    }
    if (activeChartTab === "ram") {
      return { smooth: true, niceMax: true };
    }
    return {
      smooth: true,
      minY: 0,
      niceMax: true,
      thresholds: [{ value: 60, label: t("activityPerf.threshold60fps"), color: "var(--color-success)" }],
    };
  }, [activeChartTab, tempUnit, t]);

  const sparklineData = useMemo(() => {
    if (!chartProps) return null;
    const formatSpark = (arr: number[]) => arr.map((y, x) => ({ x, y }));
    return {
      cpu: formatSpark(chartProps.cpu),
      gpu: formatSpark(chartProps.gpu),
      cpuTemp: formatSpark(chartProps.cpuTemp),
      gpuTemp: formatSpark(chartProps.gpuTemp),
      ram: formatSpark(chartProps.ram),
      fps: formatSpark(chartProps.fps),
    };
  }, [chartProps]);

  const handleSaveNotes = () => {
    setNote(session.id, noteText);
    setTags(session.id, tagsList);
    setIsEditingNote(false);
  };

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ("key" in e && e.key !== "Enter") return;
    const clean = tagInput.trim();
    if (clean && !tagsList.includes(clean)) {
      const next = [...tagsList, clean];
      setTagsList(next);
      setTags(session.id, next);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    const next = tagsList.filter((t) => t !== tag);
    setTagsList(next);
    setTags(session.id, next);
  };

  const m = session.metrics;

  return (
    <div className={`activity-session-item ${isExpanded ? "activity-session-item--expanded" : ""}`}>
      <div
        className="activity-session-item__row"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div
          className="activity-session-item__checkbox"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          {isSelected ? <Icons.CheckSquare size={14} /> : <Icons.Square size={14} />}
        </div>

        <div className="activity-session-item__header-left">
          <span className="activity-session-item__chevron" aria-hidden="true">
            {isExpanded ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}
          </span>
          <div className="activity-session-item__game-icon-container">
            <GameThumbnail
              iconUrl={game?.iconUrl}
              coverArtUrl={game?.coverArtUrl}
              steamAppId={steamAppId}
              name={session.gameName}
              className="activity-session-item__game-icon"
            />
            {steamAppId != null ? (
              <div className="activity-session-item__player-chip" aria-hidden={false}>
                <PlayerCountBadge appId={steamAppId} className="activity-session-item__player-chip-badge" />
              </div>
            ) : null}
          </div>
          <div className="activity-session-item__info">
            <span className="activity-session-item__date">{session.gameName}</span>
            <span className="activity-session-item__time">
              {formattedDate} · {formattedTime}
            </span>
          </div>
        </div>

        <div className="activity-session-item__header-right">
          {/* Quick telemetry preview chips on row */}
          <div className="activity-session-item__quick-chips">
            {m?.avgFps && m.avgFps > 0 ? (
              <span className="activity-session-item__pill activity-session-item__pill--fps">
                {m.avgFps} FPS
              </span>
            ) : null}
            {m?.avgGpuTemp && m.avgGpuTemp > 0 ? (
              <span className="activity-session-item__pill activity-session-item__pill--temp">
                {formatTemp(m.avgGpuTemp, tempUnit)}
              </span>
            ) : null}
            {m?.resolution ? (
              <span className="activity-session-item__pill activity-session-item__pill--res">
                {m.resolution}
              </span>
            ) : null}
            {noteData.note || noteData.tags.length > 0 ? (
              <span className="activity-session-item__pill activity-session-item__pill--note" title={noteData.note}>
                <Icons.FileText size={10} /> {noteData.tags.length > 0 ? `${noteData.tags.length} tags` : "Note"}
              </span>
            ) : null}
          </div>

          <span className="activity-session-item__duration">{formattedDuration}</span>

          <button
            type="button"
            className="activity-session-item__delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(session);
            }}
            title={t("activitySessions.delete")}
            aria-label={t("activitySessions.delete")}
          >
            <Icons.Trash2 size={13} />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="activity-session-item__collapsible">
          {session.metrics && sparklineData && chartProps ? (
            <div className="activity-hardware-card">
              <h4 className="activity-hardware-card__title">{t("activitySessions.hardwareSummary")}</h4>
              <div className="activity-hardware-card__metrics">
                <ActivitySparkline
                  data={sparklineData.cpu}
                  label={t("activity.sessions.cpuLoad")}
                  unit="%"
                  value={session.metrics.avgCpuUsage}
                />
                <ActivitySparkline
                  data={sparklineData.gpu}
                  label={t("activity.sessions.gpuLoad")}
                  unit="%"
                  value={session.metrics.avgGpuUsage}
                />
                <ActivitySparkline
                  data={sparklineData.ram}
                  label={t("activityPerf.ramUsage")}
                  unit="%"
                  value={session.metrics.avgRamUsage}
                />
                <ActivitySparkline
                  data={sparklineData.fps}
                  label={t("activityPerf.fps")}
                  unit="FPS"
                  value={session.metrics.avgFps}
                />
                {session.metrics.avgCpuTemp > 0 && (
                  <ActivitySparkline
                    data={sparklineData.cpuTemp.map((p) => ({ ...p, y: toDisplayTemp(p.y, tempUnit) }))}
                    label={t("activityPerf.cpuTemp")}
                    unit={tempUnitLabel(tempUnit)}
                    value={toDisplayTemp(session.metrics.avgCpuTemp, tempUnit)}
                  />
                )}
                {session.metrics.avgGpuTemp > 0 && (
                  <ActivitySparkline
                    data={sparklineData.gpuTemp.map((p) => ({ ...p, y: toDisplayTemp(p.y, tempUnit) }))}
                    label={t("activityPerf.gpuTemp")}
                    unit={tempUnitLabel(tempUnit)}
                    value={toDisplayTemp(session.metrics.avgGpuTemp, tempUnit)}
                  />
                )}
              </div>

              <div className="activity-chart-tab-container">
                <div className="activity-chart-tabs">
                  <button
                    type="button"
                    className={`activity-chart-tab ${activeChartTab === "usage" ? "activity-chart-tab--active" : ""}`}
                    onClick={() => setActiveChartTab("usage")}
                  >
                    {t("activity.sessions.usageTab")}
                  </button>
                  <button
                    type="button"
                    className={`activity-chart-tab ${activeChartTab === "temps" ? "activity-chart-tab--active" : ""}`}
                    onClick={() => setActiveChartTab("temps")}
                  >
                    {t("activityPerf.tempsUnit", { unit: tempUnitLabel(tempUnit) })}
                  </button>
                  <button
                    type="button"
                    className={`activity-chart-tab ${activeChartTab === "ram" ? "activity-chart-tab--active" : ""}`}
                    onClick={() => setActiveChartTab("ram")}
                  >
                    {t("activityPerf.ramUsage")}
                  </button>
                  <button
                    type="button"
                    className={`activity-chart-tab ${activeChartTab === "fps" ? "activity-chart-tab--active" : ""}`}
                    onClick={() => setActiveChartTab("fps")}
                  >
                    {t("activityPerf.fps")}
                  </button>
                </div>

                <div className="activity-chart-wrapper">
                  <LineChart
                    series={chartSeries}
                    labels={chartProps.labels}
                    formatValue={yValFormatter}
                    height={160}
                    {...chartExtra}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="activity-empty activity-empty--compact">
              <div className="activity-empty__title">{t("activity.noTelemetryCaptured")}</div>
              <div className="activity-empty__hint">{t("activitySessions.enableHardwareHint")}</div>
            </div>
          )}

          {/* Inline Session Notes Section */}
          <div className="activity-session-item__notes-box">
            <div className="activity-session-item__notes-head">
              <span className="activity-session-item__notes-title">
                <Icons.FileText size={13} /> {t("sessionNotes.title")}
              </span>
              {!isEditingNote && (
                <button
                  type="button"
                  className="act-inspector-btn act-inspector-btn--sm"
                  onClick={() => setIsEditingNote(true)}
                >
                  <Icons.Edit3 size={11} /> {noteText ? t("common.edit") : t("sessionNotes.addNote")}
                </button>
              )}
            </div>

            {isEditingNote ? (
              <div className="act-inspector-notes__editor">
                <textarea
                  className="act-inspector-notes__textarea"
                  rows={2}
                  placeholder={t("sessionNotes.placeholder")}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <div className="act-inspector-notes__tags-input-row">
                  <input
                    type="text"
                    className="act-inspector-notes__tag-input"
                    placeholder={t("sessionNotes.tagPlaceholder")}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                  />
                  <button
                    type="button"
                    className="act-inspector-btn act-inspector-btn--sm"
                    onClick={handleAddTag}
                  >
                    <Icons.Tag size={11} /> {t("sessionNotes.addTag")}
                  </button>
                </div>
                {tagsList.length > 0 && (
                  <div className="act-inspector-notes__tags">
                    {tagsList.map((tag) => (
                      <span key={tag} className="act-inspector-tag">
                        <Icons.Tag size={10} /> {tag}
                        <button
                          type="button"
                          className="act-inspector-tag-del"
                          onClick={() => handleRemoveTag(tag)}
                          aria-label={`Remove ${tag}`}
                        >
                          <Icons.X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="act-inspector-notes__editor-actions">
                  <button
                    type="button"
                    className="act-inspector-btn act-inspector-btn--primary act-inspector-btn--sm"
                    onClick={handleSaveNotes}
                  >
                    <Icons.Check size={12} /> {t("common.save")}
                  </button>
                  <button
                    type="button"
                    className="act-inspector-btn act-inspector-btn--ghost act-inspector-btn--sm"
                    onClick={() => setIsEditingNote(false)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="activity-session-item__notes-content">
                {noteText ? (
                  <p className="activity-session-item__notes-text">{noteText}</p>
                ) : (
                  <p className="activity-session-item__notes-empty">{t("sessionNotes.noNotes")}</p>
                )}
                {tagsList.length > 0 && (
                  <div className="act-inspector-notes__tags">
                    {tagsList.map((tag) => (
                      <span key={tag} className="act-inspector-tag">
                        <Icons.Tag size={10} /> {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Actions Footer */}
          {game ? (
            <div className="activity-session-item__actions-footer">
              <button
                type="button"
                className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
                onClick={() => navigate(`/library/${game.id}`)}
              >
                <Icons.ExternalLink size={12} /> {t("gameActivity.viewGamePage")}
              </button>
              {onLaunchGame && (
                <button
                  type="button"
                  className="act-inspector-btn act-inspector-btn--primary act-inspector-btn--sm"
                  onClick={() => onLaunchGame(game)}
                >
                  <Icons.Play size={12} /> {t("game.play")}
                </button>
              )}
            </div>
          ) : (
            <div className="activity-session-item__actions-footer">
              {onRequestLink && (
                <button
                  type="button"
                  className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
                  onClick={() => onRequestLink(session.gameId, session.gameName)}
                  title={t("activity.linkToLibrary")}
                >
                  <Icons.Link2 size={12} /> {t("activity.linkToLibrary")}
                </button>
              )}
              {onRequestAdd && (
                <button
                  type="button"
                  className="act-inspector-btn act-inspector-btn--primary act-inspector-btn--sm"
                  onClick={() => onRequestAdd(session.gameId, session.gameName)}
                  title={t("activity.addToLibrary")}
                >
                  <Icons.Plus size={12} /> {t("activity.addToLibrary")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
