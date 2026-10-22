// Reels — the highlight-reel builder (v1: registry + playlists).
//
// Left: the reel list (create / rename / delete). Right: the selected
// reel's clips in order, plus the registry of all clips (import from
// the capture folder, favorite, remove from reel, reorder, play in the
// OS player). No video is copied or re-encoded — a reel is an ordered
// reference list, so playing it means opening each clip in turn.

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  FolderOpen,
  Heart,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { Button, ConfirmModal, PageHeader } from "../components/ui";
import type { Clip, Reel, ReelsSnapshot } from "../types/reels";
import "../styles/page-reels.css";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Duration/size formatting kept local to the page (the registry only
 *  stores raw values; clips can also come from outside native capture). */
function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export default function ReelsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [snapshot, setSnapshot] = useState<ReelsSnapshot | null>(null);
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newReelName, setNewReelName] = useState("");
  const [renaming, setRenaming] = useState<Reel | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteReel, setConfirmDeleteReel] = useState<Reel | null>(null);
  const [confirmRemoveClip, setConfirmRemoveClip] = useState<Clip | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await invoke<ReelsSnapshot>("reels_get_snapshot");
      setSnapshot(data);
      setSelectedReelId((prev) => {
        if (prev && data.reels.some((r) => r.id === prev)) return prev;
        return data.reels[0]?.id ?? null;
      });
    } catch (err) {
      showToast(String(err), "error");
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const reels = snapshot?.reels ?? [];
  const clips = snapshot?.clips ?? [];
  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  const selectedReel = reels.find((r) => r.id === selectedReelId) ?? null;

  const createReel = async () => {
    const name = newReelName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const id = newId();
      await invoke("create_reel", { id, name, description: null });
      setNewReelName("");
      setCreating(false);
      setSelectedReelId(id);
      await load();
      showToast(t("reels.created", { name }), "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const renameReel = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      await invoke("rename_reel", {
        id: renaming.id,
        name,
        description: renaming.description ?? null,
      });
      setRenaming(null);
      await load();
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteReel = async () => {
    if (!confirmDeleteReel) return;
    try {
      await invoke("delete_reel", { id: confirmDeleteReel.id });
      setConfirmDeleteReel(null);
      await load();
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  /** Import every clip the native capture folder exposes that isn't in
   *  the registry yet. Files already registered are skipped by the
   *  backend's path upsert. */
  const importCaptures = async () => {
    setBusy(true);
    try {
      const paths = await invoke<string[]>("capture_get_recent_clips", { gameTitle: null });
      let added = 0;
      for (const path of paths) {
        if (clips.some((c) => c.path === path)) continue;
        const title = fileNameOf(path).replace(/\.[^.]+$/, "");
        await invoke<Clip>("register_clip", {
          clip: { id: newId(), path, title, kind: "import", createdAt: Date.now() },
        });
        added += 1;
      }
      await load();
      showToast(t("reels.imported", { count: added }), added > 0 ? "success" : "info");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleFavorite = async (clip: Clip) => {
    try {
      await invoke("update_clip", { update: { id: clip.id, favorite: !clip.favorite } });
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              clips: prev.clips.map((c) =>
                c.id === clip.id ? { ...c, favorite: !c.favorite } : c
              ),
            }
          : prev
      );
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const addToReel = async (clip: Clip) => {
    if (!selectedReel) return;
    try {
      const inserted = await invoke<boolean>("add_clip_to_reel", {
        reelId: selectedReel.id,
        clipId: clip.id,
      });
      if (!inserted) {
        showToast(t("reels.alreadyInReel"), "info");
        return;
      }
      await load();
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const removeFromReel = async () => {
    if (!selectedReel || !confirmRemoveClip) return;
    try {
      await invoke("remove_clip_from_reel", {
        reelId: selectedReel.id,
        clipId: confirmRemoveClip.id,
      });
      setConfirmRemoveClip(null);
      await load();
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const moveClip = async (index: number, delta: -1 | 1) => {
    if (!selectedReel) return;
    const ids = [...selectedReel.clipIds];
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await invoke("reorder_reel", { reelId: selectedReel.id, clipIds: ids });
      await load();
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const playClip = async (clip: Clip) => {
    try {
      await openPath(clip.path);
    } catch (err) {
      showToast(t("reels.playFailed", { error: String(err) }), "error");
    }
  };

  const revealFile = async (clip: Clip) => {
    const folder = clip.path.slice(0, Math.max(clip.path.lastIndexOf("\\"), clip.path.lastIndexOf("/")));
    try {
      await openPath(folder || clip.path);
    } catch (err) {
      showToast(t("reels.playFailed", { error: String(err) }), "error");
    }
  };

  const selectedClips = useMemo(
    () =>
      (selectedReel?.clipIds ?? [])
        .map((id) => clipById.get(id))
        .filter((c): c is Clip => Boolean(c)),
    [selectedReel, clipById]
  );

  return (
    <div className="reels-page">
      <PageHeader
        eyebrow={t("reels.eyebrow")}
        title={t("reels.title")}
        description={t("reels.subtitle")}
        actions={
          <div className="reels-header-actions">
            <Button
              variant="secondary"
              leftIcon={<RefreshCw size={15} />}
              onClick={() => void importCaptures()}
              disabled={busy}
            >
              {t("reels.importCaptures")}
            </Button>
            <Button
              variant="primary"
              leftIcon={<Plus size={15} />}
              onClick={() => setCreating(true)}
            >
              {t("reels.newReel")}
            </Button>
          </div>
        }
      />

      <div className="reels-split">
        <aside className="reels-list" aria-label={t("reels.listTitle")}>
          <h2 className="reels-list__title">{t("reels.listTitle")}</h2>
          {reels.length === 0 ? (
            <p className="reels-empty">{t("reels.noReels")}</p>
          ) : (
            <ul className="reels-list__items">
              {reels.map((reel) => (
                <li key={reel.id}>
                  <button
                    type="button"
                    className={`reels-list__item${reel.id === selectedReelId ? " reels-list__item--active" : ""}`}
                    onClick={() => setSelectedReelId(reel.id)}
                  >
                    <Clapperboard size={14} />
                    <span className="reels-list__name">{reel.name}</span>
                    <span className="reels-list__count">{reel.clipIds.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="reels-detail">
          {creating && (
            <div className="reels-inline-form">
              <input
                className="reels-input"
                autoFocus
                value={newReelName}
                placeholder={t("reels.namePlaceholder")}
                onChange={(e) => setNewReelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createReel();
                  if (e.key === "Escape") setCreating(false);
                }}
              />
              <Button variant="primary" size="sm" onClick={() => void createReel()} disabled={busy}>
                {t("reels.create")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          )}

          {renaming && (
            <div className="reels-inline-form">
              <input
                className="reels-input"
                autoFocus
                value={renameValue}
                placeholder={t("reels.namePlaceholder")}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void renameReel();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
              <Button variant="primary" size="sm" onClick={() => void renameReel()} disabled={busy}>
                {t("reels.rename")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          )}

          {!selectedReel ? (
            <p className="reels-empty">{t("reels.noSelection")}</p>
          ) : (
            <>
              <div className="reels-detail__head">
                <div>
                  <h2 className="reels-detail__title">{selectedReel.name}</h2>
                  <p className="reels-detail__meta">
                    {t("reels.clipCount", { count: selectedReel.clipIds.length })}
                  </p>
                </div>
                <div className="reels-detail__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<RefreshCw size={13} />}
                    onClick={() => {
                      setRenaming(selectedReel);
                      setRenameValue(selectedReel.name);
                    }}
                  >
                    {t("reels.rename")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 size={13} />}
                    onClick={() => setConfirmDeleteReel(selectedReel)}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </div>

              {selectedClips.length === 0 ? (
                <p className="reels-empty">{t("reels.reelEmpty")}</p>
              ) : (
                <ol className="reels-clips">
                  {selectedClips.map((clip, idx) => (
                    <li key={clip.id} className="reels-clips__row">
                      <span className="reels-clips__rank">{idx + 1}</span>
                      <div className="reels-clips__info">
                        <span className="reels-clips__title">{clip.title}</span>
                        <span className="reels-clips__meta">
                          {formatDuration(clip.durationMs)} · {formatSize(clip.sizeBytes)}
                        </span>
                      </div>
                      <div className="reels-clips__actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          title={t("reels.moveUp")}
                          aria-label={t("reels.moveUp")}
                          leftIcon={<ArrowUp size={13} />}
                          disabled={idx === 0}
                          onClick={() => void moveClip(idx, -1)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          title={t("reels.moveDown")}
                          aria-label={t("reels.moveDown")}
                          leftIcon={<ArrowDown size={13} />}
                          disabled={idx === selectedClips.length - 1}
                          onClick={() => void moveClip(idx, 1)}
                        />
                        <Button variant="secondary" size="sm" onClick={() => void playClip(clip)}>
                          {t("reels.play")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          title={t("reels.removeFromReel")}
                          aria-label={t("reels.removeFromReel")}
                          leftIcon={<X size={13} />}
                          onClick={() => setConfirmRemoveClip(clip)}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}

          <section className="reels-registry" aria-label={t("reels.registryTitle")}>
            <h3 className="reels-registry__title">{t("reels.registryTitle")}</h3>
            {clips.length === 0 ? (
              <p className="reels-empty">{t("reels.registryEmpty")}</p>
            ) : (
              <ul className="reels-registry__items">
                {clips.map((clip) => {
                  const inReel = selectedReel?.clipIds.includes(clip.id) ?? false;
                  return (
                    <li key={clip.id} className="reels-registry__row">
                      <div className="reels-registry__info">
                        <span className="reels-registry__name">{clip.title}</span>
                        <span className="reels-registry__meta">
                          {clip.gameName ? `${clip.gameName} · ` : ""}
                          {formatDuration(clip.durationMs)} · {formatSize(clip.sizeBytes)}
                        </span>
                      </div>
                      <div className="reels-registry__actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          title={clip.favorite ? t("reels.unfavorite") : t("reels.favorite")}
                          aria-label={clip.favorite ? t("reels.unfavorite") : t("reels.favorite")}
                          leftIcon={<Heart size={13} fill={clip.favorite ? "currentColor" : "none"} />}
                          onClick={() => void toggleFavorite(clip)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          title={t("reels.reveal")}
                          aria-label={t("reels.reveal")}
                          leftIcon={<FolderOpen size={13} />}
                          onClick={() => void revealFile(clip)}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!selectedReel || inReel}
                          onClick={() => void addToReel(clip)}
                        >
                          {inReel ? t("reels.inReel") : t("reels.addToReel")}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </main>
      </div>

      <ConfirmModal
        open={confirmDeleteReel !== null}
        title={t("reels.deleteTitle", { name: confirmDeleteReel?.name ?? "" })}
        message={t("reels.deleteBody")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void deleteReel()}
        onCancel={() => setConfirmDeleteReel(null)}
      />
      <ConfirmModal
        open={confirmRemoveClip !== null}
        title={t("reels.removeTitle", { name: confirmRemoveClip?.title ?? "" })}
        message={t("reels.removeBody")}
        confirmLabel={t("reels.removeFromReel")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void removeFromReel()}
        onCancel={() => setConfirmRemoveClip(null)}
      />
    </div>
  );
}
