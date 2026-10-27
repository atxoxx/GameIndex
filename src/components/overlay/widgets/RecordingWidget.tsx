import { useEffect, useMemo, useState } from "react";
import {
  Video,
  Circle,
  Square,
  Save,
  FolderOpen,
  Trash2,
  Play,
  Loader2,
  Clapperboard,
} from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useVisibleInterval } from "../../../hooks/useVisibleInterval";
import { useIncrementalList } from "../useIncrementalList";
import { Card, Button } from "../../ui";
import { OverlayClipPreview } from "./OverlayClipPreview";

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * RecordingWidget — in-game video capture controls: manual record/stop, a
 * rolling replay buffer with an instant save, and the recent clip list.
 */
export default function RecordingWidget() {
  const {
    captureSupported,
    recordingState,
    isRecording,
    isReplayBuffering,
    recentClips,
    startRecording,
    stopRecording,
    startReplay,
    stopReplay,
    saveReplay,
    deleteClip,
    openClipsFolder,
    settings,
  } = useOverlay();
  const { t } = useLanguage();

  const {
    visible: visibleClips,
    hasMore,
    showMore,
  } = useIncrementalList(recentClips);

  const [busy, setBusy] = useState(false);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(recordingState.durationMs);

  // Tick a local timer while recording so the badge shows a live duration even
  // though the backend only reports on state changes.
  const recStartedAt = recordingState.startedAt;
  const recActive = isRecording && recStartedAt !== undefined;
  useVisibleInterval(
    () => setElapsed(Date.now() - (recStartedAt ?? Date.now())),
    500,
    recActive
  );
  useEffect(() => {
    if (!recActive) setElapsed(recordingState.durationMs);
  }, [recActive, recordingState.durationMs]);

  const clipCount = recentClips.length;

  // Pre-roll countdown: the backend broadcasts a `countdownMs` state, then the
  // recorder starts after that delay. Tick the remaining time locally so the
  // label counts down live instead of showing every one-second snapshot.
  const countdownTotal =
    isRecording || isReplayBuffering ? 0 : recordingState.countdownMs ?? 0;
  const [countdownLeft, setCountdownLeft] = useState(0);
  useEffect(() => {
    if (countdownTotal <= 0) {
      setCountdownLeft(0);
      return;
    }
    const endAt = Date.now() + countdownTotal;
    // 250 ms is well below one displayed-countdown digit — a 100 ms tick
    // just quadrupled the re-renders of this widget during pre-roll.
    const id = window.setInterval(() => {
      const left = Math.max(0, endAt - Date.now());
      setCountdownLeft(left);
      if (left === 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [countdownTotal]);

  const handleToggleRecord = async () => {
    setBusy(true);
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleReplay = async () => {
    setBusy(true);
    try {
      if (isReplayBuffering) {
        await stopReplay();
      } else {
        await startReplay();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveReplay = async () => {
    setBusy(true);
    try {
      await saveReplay();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (path: string) => {
    if (confirmDeletePath === path) {
      setConfirmDeletePath(null);
      if (previewIndex !== null && visibleClips[previewIndex] === path) {
        setPreviewIndex(null);
      }
      await deleteClip(path);
    } else {
      setConfirmDeletePath(path);
      window.setTimeout(() => {
        setConfirmDeletePath((curr) => (curr === path ? null : curr));
      }, 3000);
    }
  };

  useEffect(() => {
    if (previewIndex === null) return;
    if (previewIndex >= visibleClips.length) {
      setPreviewIndex(visibleClips.length > 0 ? visibleClips.length - 1 : null);
    }
  }, [previewIndex, visibleClips.length]);

  const statusTone = useMemo(() => {
    if (countdownTotal > 0 || countdownLeft > 0) return "countdown";
    if (recordingState.error) return "error";
    if (isRecording) return "recording";
    if (isReplayBuffering) return "replay";
    return "idle";
  }, [countdownTotal, countdownLeft, recordingState.error, isRecording, isReplayBuffering]);

  return (
    <Card variant="glass" className="overlay-widget overlay-recording-widget">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <Video />
        </span>
        <h3 className="overlay-widget__title">
          {t("overlay.widget.recording")}
        </h3>
        <span className="overlay-widget__badge">
          {t("overlay.recording.clipCount", { count: clipCount })}
        </span>
        <div className="overlay-widget__head-actions">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => void openClipsFolder()}
            title={t("overlay.recording.openFolder")}
            aria-label={t("overlay.recording.openFolder")}
          >
            <FolderOpen size={14} />
          </Button>
          <Button
            variant={isRecording ? "danger" : "primary"}
            size="sm"
            onClick={() => void handleToggleRecord()}
            disabled={busy || !captureSupported}
            title={
              isRecording
                ? t("overlay.recording.stop")
                : t("overlay.recording.start")
            }
            className="overlay-capture-btn"
          >
            {busy ? (
              <Loader2 size={13} className="overlay-spin" />
            ) : isRecording ? (
              <Square size={13} />
            ) : (
              <Circle size={13} />
            )}
            <span>
              {isRecording
                ? t("overlay.recording.stop")
                : t("overlay.recording.start")}
            </span>
          </Button>
        </div>
      </div>

      {!captureSupported ? (
        <div className="overlay-record-status overlay-record-status--unsupported">
          {t("overlay.recording.unsupported")}
        </div>
      ) : (
        <>
          <div className={`overlay-record-status overlay-record-status--${statusTone}`}>
            <span className="overlay-record-status__dot" aria-hidden />
            <span className="overlay-record-status__label">
              {recordingState.error && countdownLeft === 0
                ? t("overlay.recording.error", { error: recordingState.error })
                : countdownLeft > 0
                  ? t("overlay.recording.countdown", {
                      seconds: Math.ceil(countdownLeft / 1000),
                    })
                  : isRecording
                  ? t("overlay.recording.recordingFor", {
                      time: formatDuration(elapsed),
                    })
                  : isReplayBuffering
                    ? t("overlay.recording.replayArmed", {
                        seconds: settings.replayBufferSeconds,
                      })
                    : t("overlay.recording.idle")}
            </span>
          </div>

          <div className="overlay-record-actions">
            <Button
              variant={isReplayBuffering ? "secondary" : "ghost"}
              size="sm"
              onClick={() => void handleToggleReplay()}
              disabled={busy}
            >
              <Clapperboard size={13} />
              <span>
                {isReplayBuffering
                  ? t("overlay.recording.disableReplay")
                  : t("overlay.recording.enableReplay")}
              </span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSaveReplay()}
              disabled={busy || !isReplayBuffering}
              title={t("overlay.recording.saveReplayHint", {
                seconds: settings.replayBufferSeconds,
              })}
            >
              <Save size={13} />
              <span>{t("overlay.recording.saveReplay")}</span>
            </Button>
          </div>

          {clipCount === 0 ? (
            <div className="overlay-screenshots-empty">
              <div className="overlay-screenshots-empty__icon">
                <Play size={30} />
              </div>
              <p className="overlay-screenshots-empty__text">
                {t("overlay.recording.noClips")}
              </p>
              <p className="overlay-screenshots-empty__hint">
                {t("overlay.recording.noClipsHint")}
              </p>
            </div>
          ) : (
            <div className="overlay-clips-list">
              {visibleClips.map((path, index) => {
                const fileName = path.split(/[/\\]/).pop() ?? "Clip";
                const isConfirming = confirmDeletePath === path;
                return (
                  <div key={path} className="overlay-clip-row">
                    <span className="overlay-clip-row__icon" aria-hidden>
                      <Video size={14} />
                    </span>
                    <span className="overlay-clip-row__name" title={fileName}>
                      {fileName}
                    </span>
                    <div className="overlay-clip-row__actions">
                      <button
                        type="button"
                        className="overlay-btn-mini"
                        onClick={() => setPreviewIndex(index)}
                        title={t("overlay.recording.preview")}
                        aria-label={t("overlay.recording.preview")}
                      >
                        <Play size={12} />
                      </button>
                      <button
                        type="button"
                        className="overlay-btn-mini"
                        onClick={() => void openClipsFolder(path)}
                        title={t("overlay.recording.openFolder")}
                        aria-label={t("overlay.recording.openFolder")}
                      >
                        <FolderOpen size={12} />
                      </button>
                      <button
                        type="button"
                        className={`overlay-btn-mini overlay-btn-danger${
                          isConfirming ? " active" : ""
                        }`}
                        onClick={() => void handleDelete(path)}
                        title={t("overlay.recording.delete")}
                        aria-label={t("overlay.recording.delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {clipCount > 0 && hasMore && (
            <Button
              variant="ghost"
              size="sm"
              className="overlay-list-more"
              onClick={showMore}
            >
              {t("overlay.list.showMore")}
            </Button>
          )}
        </>
      )}

      {previewIndex !== null && (
        <OverlayClipPreview
          paths={visibleClips}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onOpenFolder={(path) => void openClipsFolder(path)}
        />
      )}
    </Card>
  );
}
