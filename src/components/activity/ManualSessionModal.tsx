import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Game, SessionMetrics } from "../../types/game";
import { useActivity } from "../../context/ActivityContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { GameThumbnail } from "./GameThumbnail";
import * as Icons from "./Icons";

export interface ManualSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedGameId?: string;
  games: Game[];
  onSessionSaved?: () => void;
}

export function ManualSessionModal({
  isOpen,
  onClose,
  preselectedGameId,
  games,
  onSessionSaved,
}: ManualSessionModalProps) {
  const { t } = useLanguage();
  const { recordSession } = useActivity();
  const { setNote, setTags } = useSessionNotes();
  const { showToast } = useToast();

  const [selectedGameId, setSelectedGameId] = useState<string>(
    preselectedGameId || (games[0]?.id ?? ""),
  );
  const [gameSearch, setGameSearch] = useState("");
  const [dateStr, setDateStr] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [timeStr, setTimeStr] = useState<string>(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });
  const [durationHours, setDurationHours] = useState<string>("1");
  const [durationMinutes, setDurationMinutes] = useState<string>("0");
  const [avgFps, setAvgFps] = useState<string>("");
  const [avgCpu, setAvgCpu] = useState<string>("");
  const [avgGpu, setAvgGpu] = useState<string>("");
  const [resolution, setResolution] = useState<string>("");
  const [noteText, setNoteText] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const selectedGame = useMemo(() => {
    return games.find((g) => g.id === selectedGameId) ?? null;
  }, [games, selectedGameId]);

  const filteredGames = useMemo(() => {
    if (!gameSearch.trim()) return games;
    const q = gameSearch.toLowerCase();
    return games.filter((g) => g.name.toLowerCase().includes(q));
  }, [games, gameSearch]);

  if (!isOpen) return null;

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ("key" in e && e.key !== "Enter") return;
    const clean = tagInput.trim();
    if (clean && !tagsList.includes(clean)) {
      setTagsList([...tagsList, clean]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTagsList(tagsList.filter((t) => t !== tagToRemove));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGame) {
      showToast(t("activityManual.selectGameError"), "error");
      return;
    }

    const hrs = Math.max(0, parseInt(durationHours, 10) || 0);
    const mins = Math.max(0, parseInt(durationMinutes, 10) || 0);
    const totalMinutes = hrs * 60 + mins;

    if (totalMinutes <= 0) {
      showToast(t("activityManual.durationError"), "error");
      return;
    }

    const startDate = new Date(`${dateStr}T${timeStr || "12:00"}:00`);
    const startedAtMs = Number.isNaN(startDate.getTime()) ? Date.now() : startDate.getTime();

    const fpsNum = avgFps.trim() ? Math.max(0, parseInt(avgFps, 10)) : null;
    const cpuNum = avgCpu.trim() ? Math.max(0, Math.min(100, parseInt(avgCpu, 10))) : null;
    const gpuNum = avgGpu.trim() ? Math.max(0, Math.min(100, parseInt(avgGpu, 10))) : null;

    let metricsJson: string | null = null;
    if (fpsNum != null || cpuNum != null || gpuNum != null || resolution.trim()) {
      const metricsPayload: SessionMetrics = {
        avgFps: fpsNum ?? 0,
        minFps: fpsNum ? Math.round(fpsNum * 0.75) : 0,
        maxFps: fpsNum ? Math.round(fpsNum * 1.2) : 0,
        avgCpuUsage: cpuNum ?? 0,
        avgGpuUsage: gpuNum ?? 0,
        avgRamUsage: 0,
        avgCpuTemp: 0,
        avgGpuTemp: 0,
        resolution: resolution.trim(),
        samples: [],
      };
      metricsJson = JSON.stringify(metricsPayload);
    }

    setSaving(true);
    try {
      const insertedId: number = await invoke("insert_session", {
        gameId: selectedGame.id,
        gameName: selectedGame.name,
        startedAtMs,
        elapsedSeconds: totalMinutes * 60,
        avgFps: fpsNum,
        avgCpu: cpuNum,
        avgGpu: gpuNum,
        avgRam: null,
        metricsJson,
      });

      if (noteText.trim() || tagsList.length > 0) {
        const idStr = String(insertedId);
        if (noteText.trim()) setNote(idStr, noteText.trim());
        if (tagsList.length > 0) setTags(idStr, tagsList);
      }

      recordSession();
      showToast(t("activityManual.sessionLoggedSuccess", { name: selectedGame.name }), "success");
      onSessionSaved?.();
      onClose();
    } catch (err) {
      console.error("Failed to insert manual session:", err);
      showToast(t("activityManual.sessionLoggedError", { error: String(err) }), "error");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="act-modal-backdrop" onClick={onClose}>
      <div
        className="act-modal act-modal--manual"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="act-modal__header">
          <div className="act-modal__title-group">
            <div className="act-modal__icon-pill">
              <Icons.Plus size={16} />
            </div>
            <div>
              <h3 className="act-modal__title">{t("activityManual.title")}</h3>
              <span className="act-modal__sub">{t("activityManual.subtitle")}</span>
            </div>
          </div>
          <button
            type="button"
            className="act-modal__close-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icons.X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="act-modal__form">
          {/* Game Selection */}
          <div className="act-form-group">
            <label className="act-form-label">{t("activity.gameLabel")}</label>
            {preselectedGameId ? (
              <div className="act-selected-game-preview">
                <GameThumbnail
                  iconUrl={selectedGame?.iconUrl}
                  coverArtUrl={selectedGame?.coverArtUrl}
                  steamAppId={selectedGame?.steamAppId}
                  name={selectedGame?.name || ""}
                  className="act-selected-game-thumb"
                />
                <div className="act-selected-game-meta">
                  <span className="act-selected-game-name">{selectedGame?.name}</span>
                  <span className="act-selected-game-platform">{selectedGame?.platform || "Local"}</span>
                </div>
              </div>
            ) : (
              <div className="act-game-picker-container">
                <input
                  type="text"
                  className="act-form-input act-game-search-input"
                  placeholder={t("activityDash.searchGames")}
                  value={gameSearch}
                  onChange={(e) => setGameSearch(e.target.value)}
                />
                <select
                  className="act-form-select"
                  value={selectedGameId}
                  onChange={(e) => setSelectedGameId(e.target.value)}
                  required
                >
                  {filteredGames.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.platform || "Local"})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Date & Time Row */}
          <div className="act-form-row">
            <div className="act-form-group">
              <label className="act-form-label">
                <Icons.Calendar size={12} /> {t("activityCsv.datePlayed")}
              </label>
              <input
                type="date"
                className="act-form-input"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                required
              />
            </div>
            <div className="act-form-group">
              <label className="act-form-label">
                <Icons.Clock size={12} /> {t("activityManual.startTime")}
              </label>
              <input
                type="time"
                className="act-form-input"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Duration Row */}
          <div className="act-form-group">
            <label className="act-form-label">
              <Icons.Hourglass size={12} /> {t("activityManual.duration")}
            </label>
            <div className="act-duration-inputs">
              <div className="act-duration-field">
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="act-form-input"
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                />
                <span className="act-duration-unit">{t("activityManual.hoursUnit")}</span>
              </div>
              <div className="act-duration-field">
                <input
                  type="number"
                  min="0"
                  max="59"
                  className="act-form-input"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
                <span className="act-duration-unit">{t("activityManual.minutesUnit")}</span>
              </div>
            </div>
          </div>

          {/* Optional Telemetry Accordion */}
          <details className="act-form-collapsible">
            <summary className="act-form-collapsible-trigger">
              <Icons.BarChart3 size={13} /> {t("activityManual.optionalTelemetry")}
            </summary>
            <div className="act-form-collapsible-body">
              <div className="act-form-row act-form-row--3">
                <div className="act-form-group">
                  <label className="act-form-label">{t("activityPerf.avgFps")}</label>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    placeholder="e.g. 60"
                    className="act-form-input"
                    value={avgFps}
                    onChange={(e) => setAvgFps(e.target.value)}
                  />
                </div>
                <div className="act-form-group">
                  <label className="act-form-label">{t("activityPerf.cpuUsage")} (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 45"
                    className="act-form-input"
                    value={avgCpu}
                    onChange={(e) => setAvgCpu(e.target.value)}
                  />
                </div>
                <div className="act-form-group">
                  <label className="act-form-label">{t("activityPerf.gpuUsage")} (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 80"
                    className="act-form-input"
                    value={avgGpu}
                    onChange={(e) => setAvgGpu(e.target.value)}
                  />
                </div>
              </div>
              <div className="act-form-group">
                <label className="act-form-label">{t("activityGantt.resolution")}</label>
                <input
                  type="text"
                  placeholder="e.g. 2560x1440"
                  className="act-form-input"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                />
              </div>
            </div>
          </details>

          {/* Session Notes & Tags */}
          <div className="act-form-group">
            <label className="act-form-label">
              <Icons.FileText size={12} /> {t("sessionNotes.title")}
            </label>
            <textarea
              className="act-inspector-notes__textarea"
              rows={2}
              placeholder={t("sessionNotes.placeholder")}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
          </div>

          <div className="act-form-group">
            <label className="act-form-label">
              <Icons.Tag size={12} /> {t("sessionNotes.tagsTitle")}
            </label>
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
          </div>

          {/* Actions */}
          <div className="act-modal__actions">
            <button
              type="button"
              className="act-inspector-btn act-inspector-btn--ghost"
              onClick={onClose}
              disabled={saving}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="act-inspector-btn act-inspector-btn--primary"
              disabled={saving || !selectedGame}
            >
              <Icons.Check size={14} /> {saving ? t("common.saving") : t("activityManual.logSessionBtn")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
