// Dual-pane mod manager (Vortex/MO2-inspired), shared by the game
// page "Mods" tab and the main Mods page.
//
// Left pane  — load-order list: enable checkboxes, drag-to-reorder
//              (when the engine supports write-back), engine chips,
//              update/conflict badges.
// Right pane — detail of the selected mod: metadata grid, Nexus
//              linkage, file listing, conflicts, actions.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Game } from "../../types/game";
import {
  ENGINE_LABELS,
  type GameMod,
  type ModConflict,
  type ModEngine,
  type NexusStatus,
} from "../../types/mods";
import { useGameMods } from "../../hooks/useGameMods";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button, ConfirmModal } from "../ui";
import "../../styles/page-mods.css";

function formatModSize(bytes?: number): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function EngineChip({ engine }: { engine: ModEngine | string }) {
  const label = ENGINE_LABELS[engine as ModEngine] ?? engine;
  return <span className={`mods-engine-chip mods-engine-${engine}`}>{label}</span>;
}

export default function ModManager({
  game,
  onChanged,
  onModsSized,
}: {
  game: Game;
  /** Fired after any mutation (scan/toggle/delete/update-check) so
   *  hosts (the Mods page overview rail) can refresh their counts. */
  onChanged?: () => void;
  /** Fired whenever the total on-disk mods footprint changes. Hosts
   *  (the game page) persist this back to the game record so the
   *  Storage tab can read the already-calculated size instead of
   *  re-measuring the mods folder itself. */
  onModsSized?: (info: { totalBytes: number; folder?: string }) => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const {
    payload,
    conflicts,
    loading,
    scanning,
    checkingUpdates,
    error,
    scan,
    setEnabled,
    reorder,
    remove,
    checkUpdates,
    setCustomRoot,
    setNexusDomain,
  } = useGameMods(game);

  const [search, setSearch] = useState("");
  const [modSort, setModSort] = useState<"order" | "name" | "size:desc" | "size:asc">("order");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GameMod | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [nexusOpen, setNexusOpen] = useState(false);
  const [nexusKey, setNexusKey] = useState("");
  const [nexusStatus, setNexusStatus] = useState<NexusStatus | null>(null);
  const [domainDraft, setDomainDraft] = useState("");
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const mods = payload?.mods ?? [];
  const enabledCount = mods.filter((m) => m.enabled).length;
  const updateCount = mods.filter((m) => m.updateAvailable).length;
  const supportsReorder = payload?.supportsReorder ?? false;
  const totalModsBytes = mods.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mods;
    return mods.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.author ?? "").toLowerCase().includes(q) ||
        m.engine.toLowerCase().includes(q)
    );
  }, [mods, search]);

  // Sort the visible list (independently of the search filter). The
  // default "order" keeps the engine load order; the other options let
  // the user rank mods by name or on-disk size.
  const sortedMods = useMemo(() => {
    const list = [...filtered];
    switch (modSort) {
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "size:desc":
        list.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
        break;
      case "size:asc":
        list.sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
        break;
      case "order":
      default:
        break;
    }
    return list;
  }, [filtered, modSort]);

  const conflictsByMod = useMemo(() => {
    const map = new Map<string, ModConflict[]>();
    for (const c of conflicts) {
      for (const id of c.modIds) {
        const list = map.get(id) ?? [];
        list.push(c);
        map.set(id, list);
      }
    }
    return map;
  }, [conflicts]);

  const selected = mods.find((m) => m.id === selectedId) ?? null;

  // Persist the total mods footprint to the game record whenever the
  // scan/load payload changes. The Storage tab reads `game.modsSizeBytes`
  // from here rather than re-measuring the mods folder itself.
  const onModsSizedRef = useRef(onModsSized);
  onModsSizedRef.current = onModsSized;
  useEffect(() => {
    if (!onModsSizedRef.current) return;
    const total = (payload?.mods ?? []).reduce(
      (sum, m) => sum + (m.sizeBytes ?? 0),
      0
    );
    const folder =
      payload?.settings?.modsRoot ?? payload?.settings?.customRoot ?? undefined;
    onModsSizedRef.current({ totalBytes: total, folder });
  }, [payload]);

  // Keep a sane selection when the list changes.
  useEffect(() => {
    if (selectedId && !mods.some((m) => m.id === selectedId)) {
      setSelectedId(mods[0]?.id ?? null);
    }
  }, [mods, selectedId]);

  // Reset the file listing when the selection changes.
  useEffect(() => {
    setFiles(null);
    setShowFiles(false);
  }, [selectedId]);

  // Sync the Nexus-domain draft with the loaded settings.
  useEffect(() => {
    setDomainDraft(payload?.settings?.nexusDomain ?? "");
  }, [payload?.settings?.nexusDomain]);

  const refreshNexusStatus = useCallback(() => {
    invoke<NexusStatus>("nexus_get_status")
      .then(setNexusStatus)
      .catch(() => setNexusStatus({ connected: false }));
  }, []);

  useEffect(() => {
    if (nexusOpen) refreshNexusStatus();
  }, [nexusOpen, refreshNexusStatus]);

  const handleScan = async () => {
    try {
      const p = await scan();
      if (p) {
        showToast(t("mods.scanComplete", { count: String(p.mods.length) }), "success");
      }
      onChanged?.();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleToggle = async (mod: GameMod) => {
    try {
      await setEnabled(mod.id, !mod.enabled);
      onChanged?.();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleCheckUpdates = async () => {
    try {
      const p = await checkUpdates();
      const n = p?.mods.filter((m) => m.updateAvailable).length ?? 0;
      showToast(
        n > 0 ? t("mods.updatesFound", { count: String(n) }) : t("mods.noUpdates"),
        n > 0 ? "info" : "success"
      );
      onChanged?.();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      showToast(t("mods.deleted", { name: deleteTarget.name }), "success");
      setDeleteTarget(null);
      onChanged?.();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleOpenFolder = (path?: string) => {
    const target = path ?? payload?.settings?.modsRoot;
    if (!target) return;
    invoke("open_folder", { path: target }).catch((e) => showToast(String(e), "error"));
  };

  // Manually pick a mods folder (for games none of the engine
  // detectors recognize). Saved as customRoot, then re-scanned.
  const handlePickFolder = async () => {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: t("mods.setFolder"),
        defaultPath:
          payload?.settings?.customRoot ??
          payload?.settings?.modsRoot ??
          game.path?.replace(/[\\/][^\\/]+$/, ""),
      });
      if (typeof picked !== "string" || !picked) return;
      await setCustomRoot(picked);
      showToast(t("mods.folderSaved"), "success");
      await handleScan();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleSaveNexusKey = async () => {
    try {
      await invoke("nexus_set_api_key", { key: nexusKey });
      showToast(
        nexusKey.trim() ? t("mods.nexusKeySaved") : t("mods.nexusKeyCleared"),
        "success"
      );
      setNexusKey("");
      refreshNexusStatus();
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const handleSaveDomain = async () => {
    try {
      await setNexusDomain(domainDraft);
      showToast(t("mods.domainSaved"), "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const loadFiles = async (mod: GameMod) => {
    if (showFiles) {
      setShowFiles(false);
      return;
    }
    setShowFiles(true);
    if (files === null) {
      try {
        setFiles(await invoke<string[]>("mods_list_files", { modId: mod.id }));
      } catch {
        setFiles([]);
      }
    }
  };

  // ── Drag & drop reorder (only meaningful in load-order view) ─────
  const dragEnabled = supportsReorder && search.trim() === "" && modSort === "order";

  const handleDrop = async (targetId: string) => {
    const sourceId = dragId.current;
    dragId.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = mods.map((m) => m.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    try {
      await reorder(ids);
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const nexusUrlFor = (mod: GameMod): string | null => {
    const domain = mod.nexusDomain ?? payload?.settings?.nexusDomain;
    if (!mod.nexusModId || !domain) return null;
    return `https://www.nexusmods.com/${domain}/mods/${mod.nexusModId}`;
  };

  const selectedConflicts = selected ? conflictsByMod.get(selected.id) ?? [] : [];
  const modNameById = useMemo(
    () => new Map(mods.map((m) => [m.id, m.name])),
    [mods]
  );

  return (
    <div className="mods-manager">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="mods-toolbar">
        <div className="mods-toolbar-info">
          {(payload?.engines ?? []).map((e) => (
            <EngineChip key={e} engine={e} />
          ))}
          <span className="mods-count">
            {t("mods.enabledCount", {
              enabled: String(enabledCount),
              total: String(mods.length),
            })}
          </span>
          <span className="mods-total-size" title={t("mods.totalSize")}>
            {t("mods.totalSize", { size: formatModSize(totalModsBytes) })}
          </span>
          {updateCount > 0 && (
            <span className="mods-update-pill">
              {t("mods.updatesAvailable", { count: String(updateCount) })}
            </span>
          )}
        </div>
        <div className="mods-toolbar-actions">
          <input
            type="text"
            className="mods-search"
            placeholder={t("mods.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="mods-sort"
            value={modSort}
            onChange={(e) => setModSort(e.target.value as typeof modSort)}
            title={t("mods.sortBy")}
          >
            <option value="order">{t("mods.sort.order")}</option>
            <option value="name">{t("mods.sort.name")}</option>
            <option value="size:desc">{t("mods.sort.sizeDesc")}</option>
            <option value="size:asc">{t("mods.sort.sizeAsc")}</option>
          </select>
          <Button variant="secondary" size="sm" onClick={handleScan} isLoading={scanning}>
            {scanning ? t("mods.scanning") : mods.length > 0 ? t("mods.rescan") : t("mods.scan")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCheckUpdates}
            isLoading={checkingUpdates}
            title={t("mods.checkUpdates")}
          >
            {checkingUpdates ? t("mods.checkingUpdates") : t("mods.checkUpdates")}
          </Button>
          {payload?.settings?.modsRoot && (
            <Button variant="ghost" size="sm" onClick={() => handleOpenFolder()}>
              {t("mods.openFolder")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handlePickFolder()}
            title={payload?.settings?.customRoot ?? undefined}
          >
            {t("mods.setFolder")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            active={nexusOpen}
            onClick={() => setNexusOpen((v) => !v)}
          >
            {t("mods.nexus")}
          </Button>
        </div>
      </div>

      {/* ── Nexus settings panel ────────────────────────────────── */}
      {nexusOpen && (
        <div className="mods-nexus-panel">
          <div className="mods-nexus-status">
            {nexusStatus?.connected ? (
              <span className="mods-nexus-connected">
                {t("mods.nexusConnected", { name: nexusStatus.userName ?? "?" })}
                {nexusStatus.isPremium ? ` · ${t("mods.nexusPremium")}` : ""}
              </span>
            ) : (
              <span className="mods-nexus-disconnected">
                {t("mods.nexusNotConnected")}
                {nexusStatus?.error ? ` (${nexusStatus.error})` : ""}
              </span>
            )}
          </div>
          <div className="mods-nexus-row">
            <input
              type="password"
              className="mods-nexus-input"
              placeholder={t("mods.nexusApiKey")}
              value={nexusKey}
              onChange={(e) => setNexusKey(e.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={handleSaveNexusKey}>
              {t("mods.nexusSaveKey")}
            </Button>
          </div>
          <p className="mods-nexus-hint">{t("mods.nexusApiKeyHint")}</p>
          <div className="mods-nexus-row">
            <input
              type="text"
              className="mods-nexus-input"
              placeholder={t("mods.nexusDomain")}
              value={domainDraft}
              onChange={(e) => setDomainDraft(e.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={handleSaveDomain}>
              {t("common.save")}
            </Button>
          </div>
          <p className="mods-nexus-hint">{t("mods.nexusDomainHint")}</p>
        </div>
      )}

      {error && <div className="mods-error">{error}</div>}

      {/* ── Empty / loading states ──────────────────────────────── */}
      {mods.length === 0 ? (
        <div className="mods-empty">
          <div className="mods-empty-glyph">🧩</div>
          <h3>{t("mods.emptyTitle")}</h3>
          <p>{loading ? t("common.loading") : t("mods.emptySubtitle")}</p>
          <div className="mods-empty-actions">
            <Button variant="primary" size="sm" onClick={handleScan} isLoading={scanning}>
              {scanning ? t("mods.scanning") : t("mods.scan")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handlePickFolder()}>
              {t("mods.setFolder")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mods-split">
          {/* ── Left pane: load order list ─────────────────────── */}
          <div className="mods-list-pane">
            <div className="mods-list-header">
              <span>{t("mods.loadOrder")}</span>
              <span className="mods-list-header-hint">
                {supportsReorder ? t("mods.loadOrderHint") : t("mods.loadOrderReadOnly")}
              </span>
            </div>
            <div className="mods-list">
              {sortedMods.map((mod) => {
                const hasConflict = conflictsByMod.has(mod.id);
                const orderIndex = mods.indexOf(mod);
                return (
                  <div
                    key={mod.id}
                    className={[
                      "mods-row",
                      mod.id === selectedId ? "selected" : "",
                      mod.enabled ? "" : "disabled",
                      dragOverId === mod.id ? "drag-over" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setSelectedId(mod.id)}
                    draggable={dragEnabled}
                    onDragStart={() => {
                      dragId.current = mod.id;
                    }}
                    onDragOver={(e) => {
                      if (!dragEnabled) return;
                      e.preventDefault();
                      setDragOverId(mod.id);
                    }}
                    onDragLeave={() => setDragOverId((v) => (v === mod.id ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault();
                      void handleDrop(mod.id);
                    }}
                  >
                    {dragEnabled && (
                      <span className="mods-drag-handle" aria-hidden>
                        ⋮⋮
                      </span>
                    )}
                    <span className="mods-order-num">{orderIndex + 1}</span>
                    <input
                      type="checkbox"
                      className="mods-row-toggle"
                      checked={mod.enabled}
                      disabled={mod.engine === "workshop"}
                      title={
                        mod.engine === "workshop" ? t("mods.workshopManaged") : undefined
                      }
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => void handleToggle(mod)}
                    />
                    <div className="mods-row-main">
                      <span className="mods-row-name">{mod.name}</span>
                      {mod.version && (
                        <span className="mods-row-version">v{mod.version}</span>
                      )}
                    </div>
                    <div className="mods-row-badges">
                      {mod.updateAvailable && (
                        <span
                          className="mods-badge mods-badge-update"
                          title={t("mods.updateAvailable")}
                        >
                          ↑
                        </span>
                      )}
                      {hasConflict && (
                        <span
                          className="mods-badge mods-badge-conflict"
                          title={t("mods.conflicts")}
                        >
                          ⚠
                        </span>
                      )}
                      <EngineChip engine={mod.engine} />
                      <span className="mods-row-size">
                        {formatModSize(mod.sizeBytes)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Right pane: mod detail ─────────────────────────── */}
          <div className="mods-detail-pane">
            {selected ? (
              <>
                <div className="mods-detail-header">
                  <div className="mods-detail-title">
                    <h3>{selected.name}</h3>
                    <span
                      className={`mods-state-pill ${selected.enabled ? "on" : "off"}`}
                    >
                      {selected.enabled ? t("mods.enabled") : t("mods.disabled")}
                    </span>
                  </div>
                  <div className="mods-detail-actions">
                    {selected.engine !== "workshop" && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleToggle(selected)}
                        >
                          {selected.enabled ? t("mods.disable") : t("mods.enable")}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setDeleteTarget(selected)}
                        >
                          {t("mods.delete")}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleOpenFolder(
                          selected.kind === "folder"
                            ? selected.path
                            : selected.path.replace(/[\\/][^\\/]+$/, "")
                        )
                      }
                    >
                      {t("mods.openLocation")}
                    </Button>
                  </div>
                </div>

                {selected.engine === "workshop" && (
                  <div className="mods-detail-note">{t("mods.workshopManaged")}</div>
                )}

                <div className="mods-detail-grid">
                  <div className="mods-detail-item">
                    <span className="mods-detail-label">{t("mods.version")}</span>
                    <span>{selected.version ?? "—"}</span>
                  </div>
                  <div className="mods-detail-item">
                    <span className="mods-detail-label">{t("mods.latestVersion")}</span>
                    <span className={selected.updateAvailable ? "mods-text-update" : ""}>
                      {selected.latestVersion ?? "—"}
                    </span>
                  </div>
                  <div className="mods-detail-item">
                    <span className="mods-detail-label">{t("mods.author")}</span>
                    <span>{selected.author ?? "—"}</span>
                  </div>
                  <div className="mods-detail-item">
                    <span className="mods-detail-label">{t("mods.engine")}</span>
                    <EngineChip engine={selected.engine} />
                  </div>
                  <div className="mods-detail-item">
                    <span className="mods-detail-label">{t("mods.kind")}</span>
                    <span>{selected.kind}</span>
                  </div>
                  <div className="mods-detail-item">
                    <span className="mods-detail-label">{t("mods.order")}</span>
                    <span>#{mods.indexOf(selected) + 1}</span>
                  </div>
                  <div className="mods-detail-item">
                    <span className="mods-detail-label">{t("mods.size")}</span>
                    <span>{formatModSize(selected.sizeBytes)}</span>
                  </div>
                  <div className="mods-detail-item">
                    <span className="mods-detail-label">{t("mods.files")}</span>
                    <span>{selected.fileCount ?? "—"}</span>
                  </div>
                </div>

                <div className="mods-detail-path" title={selected.path}>
                  <span className="mods-detail-label">{t("mods.path")}</span>
                  <code>{selected.path}</code>
                </div>

                {nexusUrlFor(selected) && (
                  <button
                    type="button"
                    className="mods-nexus-link"
                    onClick={() => void openUrl(nexusUrlFor(selected)!)}
                  >
                    {t("mods.viewOnNexus")}
                    {selected.updateAvailable
                      ? ` · ${t("mods.updateAvailable")}`
                      : ""}
                  </button>
                )}

                {/* Conflicts involving this mod */}
                <div className="mods-detail-section">
                  <h4>{t("mods.conflicts")}</h4>
                  {selectedConflicts.length === 0 ? (
                    <p className="mods-detail-muted">{t("mods.noConflicts")}</p>
                  ) : (
                    <ul className="mods-conflict-list">
                      {selectedConflicts.slice(0, 30).map((c) => (
                        <li key={c.relativePath}>
                          <code>{c.relativePath}</code>
                          <span>
                            {c.modIds
                              .filter((id) => id !== selected.id)
                              .map((id) => modNameById.get(id) ?? id)
                              .join(", ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* File listing */}
                <div className="mods-detail-section">
                  <button
                    type="button"
                    className="mods-files-toggle"
                    onClick={() => void loadFiles(selected)}
                  >
                    {showFiles ? t("mods.hideFiles") : t("mods.showFiles")}
                  </button>
                  {showFiles && (
                    <ul className="mods-file-list">
                      {(files ?? []).map((f) => (
                        <li key={f}>
                          <code>{f}</code>
                        </li>
                      ))}
                      {files === null && <li>{t("common.loading")}</li>}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <div className="mods-detail-empty">{t("mods.selectMod")}</div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("mods.deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        message={t("mods.deleteConfirmMessage")}
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
