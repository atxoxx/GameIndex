// Profiles tab — one hub for every saved mod state in the library. Applying
// is atomic enough for daily use: every mod's enabled flag is written, then
// the saved load order is restored when the engine supports it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  CalendarDays,
  Check,
  Layers,
  Play,
  Save,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { useGames } from "../../../context/GameContext";
import { Button, ConfirmModal, Panel } from "../../ui";
import { getGamePresets } from "../ModPresetsModal";
import { gameDisplayName, type Game } from "../../../types/game";
import type { GameModsPayload, ModProfile } from "../../../types/mods";

interface ProfilesTabProps {
  game: Game;
  onChanged: () => void;
}

function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ModProfilesTab({ game, onChanged }: ProfilesTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { games } = useGames();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ModProfile[]>([]);
  const [mods, setMods] = useState<GameModsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"game" | "all">("game");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ModProfile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, payload] = await Promise.all([
        invoke<ModProfile[]>("mods_profiles_all"),
        invoke<GameModsPayload>("mods_list", { gameId: game.id }),
      ]);
      const normalized = rows.map((row) => ({
        ...row,
        createdAt: row.createdAt < 1e12 ? row.createdAt * 1000 : row.createdAt,
        updatedAt: row.updatedAt < 1e12 ? row.updatedAt * 1000 : row.updatedAt,
      }));
      // Presets saved before the DB profile table existed still live in
      // localStorage; surface them until the next save mirrors them.
      const legacy = games.flatMap((g) =>
        getGamePresets(g.id).map((preset) => ({
          id: preset.id,
          gameId: preset.gameId ?? g.id,
          name: preset.name,
          modStates: preset.modStates,
          loadOrder: preset.order ?? [],
          createdAt: preset.createdAt,
          updatedAt: preset.createdAt,
        }))
      );
      const byId = new Map<string, ModProfile>();
      for (const profile of [...legacy, ...normalized]) byId.set(profile.id, profile);
      setProfiles([...byId.values()]);
      setMods(payload);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setLoading(false);
    }
  }, [game.id, games, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const gameName = useCallback(
    (id: string) => {
      const g = games.find((row) => row.id === id);
      return g ? gameDisplayName(g) : id;
    },
    [games]
  );

  const visible = useMemo(() => {
    const list = scope === "game" ? profiles.filter((p) => p.gameId === game.id) : profiles;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [profiles, scope, game.id]);

  const saveCurrent = useCallback(async () => {
    const name = newName.trim();
    if (!name || !mods) return;
    setSaving(true);
    const now = Date.now();
    const states: Record<string, boolean> = {};
    for (const mod of mods.mods) states[mod.id] = mod.enabled;
    const profile: ModProfile = {
      id: `preset_${now}_${Math.random().toString(36).slice(2, 6)}`,
      gameId: game.id,
      name,
      modStates: states,
      loadOrder: mods.mods.map((m) => m.id),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await invoke("mods_profile_save", { profile });
      setNewName("");
      await load();
      showToast(t("mods.profiles.saved"), "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSaving(false);
    }
  }, [newName, mods, game.id, load, showToast, t]);

  const applyProfile = useCallback(
    async (profile: ModProfile) => {
      if (!mods) return;
      setBusyId(profile.id);
      try {
        const known = new Set(mods.mods.map((m) => m.id));
        for (const [modId, enabled] of Object.entries(profile.modStates)) {
          if (!known.has(modId)) continue;
          await invoke("mods_set_enabled", { modId, enabled });
        }
        if (mods.supportsReorder && profile.loadOrder.length > 0) {
          const ordered = profile.loadOrder.filter((id) => known.has(id));
          if (ordered.length > 0) {
            await invoke("mods_reorder", { gameId: game.id, orderedIds: ordered });
          }
        }
        showToast(t("mods.profiles.applied", { name: profile.name }), "success");
        onChanged();
        await load();
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        setBusyId(null);
      }
    },
    [mods, game.id, onChanged, load, showToast, t]
  );

  const deleteProfile = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      await invoke("mods_profile_delete", { profileId: confirmDelete.id });
      setConfirmDelete(null);
      await load();
      showToast(t("mods.profiles.deleted"), "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }, [confirmDelete, load, showToast, t]);

  return (
    <div className="mods-tab-body mods-profiles">
      <div className="mods-profiles-head">
        <div>
          <h3>{t("mods.profiles.title")}</h3>
          <p>{t("mods.profiles.desc")}</p>
        </div>
        <div className="mods-profiles-scope" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={scope === "game"}
            className={scope === "game" ? "is-active" : ""}
            onClick={() => setScope("game")}
          >
            {t("mods.profiles.thisGame")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === "all"}
            className={scope === "all" ? "is-active" : ""}
            onClick={() => setScope("all")}
          >
            {t("mods.profiles.allGames")}
          </button>
        </div>
      </div>

      <Panel
        tone="raised"
        heading={t("mods.profiles.saveTitle")}
        eyebrow={gameDisplayName(game)}
        icon={<Save size={16} />}
      >
        <div className="mods-profiles-save">
          <input
            type="text"
            value={newName}
            placeholder={t("mods.profiles.namePlaceholder")}
            aria-label={t("mods.profiles.namePlaceholder")}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveCurrent();
            }}
          />
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Save size={14} />}
            isLoading={saving}
            disabled={!newName.trim() || !mods?.mods.length}
            onClick={() => void saveCurrent()}
          >
            {t("mods.profiles.saveCurrent")}
          </Button>
        </div>
        <p className="mods-hint">
          {t("mods.profiles.saveHint", { count: mods?.mods.length ?? 0 })}
        </p>
      </Panel>

      <Panel
        tone="plain"
        heading={t("mods.profiles.savedTitle")}
        icon={<Layers size={16} />}
        actions={<span className="mods-profiles-count">{visible.length}</span>}
      >
        {loading ? (
          <p className="mods-hint">{t("common.loading")}</p>
        ) : visible.length === 0 ? (
          <div className="mods-profiles-empty">
            <Layers size={24} />
            <p>
              {scope === "game"
                ? t("mods.profiles.emptyGame")
                : t("mods.profiles.emptyAll")}
            </p>
          </div>
        ) : (
          <ul className="mods-profiles-list">
            {visible.map((profile) => {
              const enabled = Object.values(profile.modStates).filter(Boolean).length;
              const total = Object.keys(profile.modStates).length;
              const isHere = profile.gameId === game.id;
              return (
                <li key={profile.id} className="mods-profiles-row">
                  <span className="mods-profiles-icon" aria-hidden>
                    <Layers size={15} />
                  </span>
                  <div className="mods-profiles-info">
                    <strong>{profile.name}</strong>
                    <span>
                      {gameName(profile.gameId)} · {t("mods.profiles.state", { enabled, total })}
                    </span>
                    <span className="mods-profiles-date">
                      <CalendarDays size={11} /> {fmtDate(profile.updatedAt)}
                    </span>
                  </div>
                  <div className="mods-profiles-actions">
                    {isHere ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<Play size={13} />}
                        isLoading={busyId === profile.id}
                        onClick={() => void applyProfile(profile)}
                      >
                        {t("mods.profiles.apply")}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/mods?game=${profile.gameId}&tab=profiles`)}
                      >
                        {t("mods.profiles.openGame")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      leftIcon={<Trash2 size={14} />}
                      aria-label={t("mods.profiles.delete")}
                      title={t("mods.profiles.delete")}
                      onClick={() => setConfirmDelete(profile)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {mods && mods.mods.length > 0 && (
        <p className="mods-profiles-note">
          <Check size={12} /> {t("mods.profiles.note")}
        </p>
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        title={`${t("mods.profiles.delete")}?`}
        message={
          confirmDelete
            ? t("mods.profiles.deleteConfirm", { name: confirmDelete.name })
            : undefined
        }
        confirmLabel="mods.profiles.delete"
        onConfirm={() => void deleteProfile()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
