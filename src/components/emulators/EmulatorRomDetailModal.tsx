import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Game } from "../../types/game";
import type { Emulator } from "../../types/emulator";
import type {
  RomProfile,
  RomSaveEntry,
  SaveSnapshot,
  RomSavesStatus,
  RomMetadataCandidate,
} from "../../types/emulator";
import { formatBytesShort } from "../../types/download";
import { useGamepads, guessLayout, type ButtonLayout } from "../../hooks/useGamepads";
import { Button } from "../ui";

interface RomDetailModalProps {
  game: Game;
  emulator?: Emulator;
  isRunning: boolean;
  onClose: () => void;
  onLaunch: (game: Game) => void;
  onOpenLocation: (path: string) => void;
  onRename: (game: Game) => void;
  onDelete: (game: Game) => void;
  /** Sync an updated game row back into the library state. */
  onGameUpdated: (game: Game) => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type TabId = "overview" | "metadata" | "profile" | "saves";

function formatDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EmulatorRomDetailModal({
  game,
  emulator,
  isRunning,
  onClose,
  onLaunch,
  onOpenLocation,
  onRename,
  onDelete,
  onGameUpdated,
}: RomDetailModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleFavorite = () => {
    const updated = { ...game, favorite: !game.favorite };
    onGameUpdated(updated);
    showToast(
      updated.favorite ? t("emulators.roms.favoriteAdd") + " ✓" : t("emulators.roms.favoriteRemove"),
      "success"
    );
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: t("emulators.roms.overview"), icon: null },
    { id: "metadata", label: t("emulators.roms.metadata"), icon: null },
    { id: "profile", label: t("emulators.profile.title"), icon: null },
    { id: "saves", label: t("emulators.saves.title"), icon: null },
  ];

  return (
    <div className="modal-overlay emulators-modal-overlay" onMouseDown={onClose}>
      <div
        className="modal emulators-modal emu-rom-inspect-modal"
        role="dialog"
        aria-modal="true"
        aria-label={game.name}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-text">
            <h2 className="modal-title">{game.name}</h2>
            <span className="emu-rom-inspect-platform">
              {game.platform}
              {game.romDisc ? ` · ${t("emulators.roms.disc")} ${game.romDisc}` : ""}
            </span>
          </div>
          <button className="modal-close" aria-label={t("common.close")} onClick={onClose}>
            ×
          </button>
        </div>

        {/* Badge row */}
        <div className="emu-rom-badge-row">
          {game.favorite && <span className="emu-rom-badge emu-rom-badge--fav">★ {t("emulators.roms.favorite")}</span>}
          {game.romRegion && <span className="emu-rom-badge">🌍 {game.romRegion}</span>}
          {game.romLanguage && <span className="emu-rom-badge">🗣 {game.romLanguage}</span>}
          {game.romDisc && <span className="emu-rom-badge">💿 {t("emulators.roms.disc")} {game.romDisc}</span>}
          {game.romArchived && <span className="emu-rom-badge">📦 {t("emulators.roms.archived")}</span>}
          {game.compatNotes && <span className="emu-rom-badge emu-rom-badge--warn">⚠ {t("emulators.roms.notesShort")}</span>}
        </div>

        {/* Tabs */}
        <div className="emu-rom-tabs" role="tablist">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={tab === tb.id}
              className={`emu-rom-tab${tab === tb.id ? " is-active" : ""}`}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="modal-body emu-rom-inspect-body emu-rom-inspect-body--tabs">
          {tab === "overview" && (
            <OverviewTab
              game={game}
              onOpenLocation={onOpenLocation}
              onToggleFavorite={toggleFavorite}
              onGameUpdated={onGameUpdated}
            />
          )}
          {tab === "metadata" && <MetadataTab game={game} onGameUpdated={onGameUpdated} />}
          {tab === "profile" && <ProfileTab game={game} emulator={emulator} onGameUpdated={onGameUpdated} />}
          {tab === "saves" && <SavesTab game={game} emulator={emulator} />}
        </div>

        <div className="modal-footer">
          <div className="modal-footer-left">
            <Button
              variant="danger"
              size="sm"
              leftIcon={
                <svg {...ICON}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                </svg>
              }
              onClick={() => {
                onClose();
                onDelete(game);
              }}
            >
              {t("emulators.games.deleteRom")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                <svg {...ICON}>
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              }
              onClick={() => {
                onClose();
                onRename(game);
              }}
            >
              {t("emulators.games.rename")}
            </Button>
          </div>

          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button
              variant="primary"
              leftIcon={
                <svg {...ICON}>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              }
              onClick={() => {
                onClose();
                onLaunch(game);
              }}
              disabled={isRunning}
            >
              {isRunning ? "…" : t("emulators.games.launch")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Overview tab ───────────────────────────────────────────────────────────

function OverviewTab({
  game,
  onOpenLocation,
  onToggleFavorite,
  onGameUpdated,
}: {
  game: Game;
  onOpenLocation: (path: string) => void;
  onToggleFavorite: () => void;
  onGameUpdated: (game: Game) => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [compatNotes, setCompatNotes] = useState(game.compatNotes ?? "");

  const copyPath = () => {
    if (!game.romPath) return;
    navigator.clipboard.writeText(game.romPath);
    showToast(t("gameInfo.copied") + " ✓", "success");
  };

  const cover = game.coverArtUrl || game.iconUrl;

  return (
    <div className="emu-rom-inspect-info">
      <div className="emu-rom-inspect-media">
        {cover ? (
          <img src={cover} alt={game.name} className="emu-rom-inspect-cover" />
        ) : (
          <div className="emu-rom-inspect-fallback">
            <span className="emu-rom-inspect-fallback-glyph">🕹️</span>
            <span>{game.platform}</span>
          </div>
        )}
      </div>

      <div className="emu-rom-inspect-field">
        <span className="emu-rom-inspect-label">
          <svg {...ICON}>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          {t("bigscreen.emulators.romPath")}
        </span>
        <div className="emu-rom-inspect-path-box">
          <span className="emu-mono emu-rom-inspect-path" title={game.romPath}>
            {game.romPath || t("emulators.games.noRomPath")}
          </span>
          {game.romPath && (
            <div className="emu-rom-inspect-path-actions">
              <button type="button" className="emu-icon-btn" title={t("gameInfo.copyClipboard")} onClick={copyPath}>
                <svg {...ICON}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button
                type="button"
                className="emu-icon-btn"
                title={t("emulators.games.openLocation")}
                onClick={() => game.romPath && onOpenLocation(game.romPath)}
              >
                <svg {...ICON}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="emu-rom-inspect-meta-grid">
        <div className="emu-rom-inspect-meta-item">
          <span className="emu-rom-inspect-label">
            <svg {...ICON}>
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
            {t("emulators.games.size")}
          </span>
          <span className="emu-rom-inspect-val">
            {game.sizeBytes ? formatBytesShort(game.sizeBytes) : "—"}
            {game.modsSizeBytes ? (
              <span className="emu-game-mods"> + {formatBytesShort(game.modsSizeBytes)}</span>
            ) : null}
          </span>
        </div>

        <div className="emu-rom-inspect-meta-item">
          <span className="emu-rom-inspect-label">
            <svg {...ICON}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {t("game.playTime")}
          </span>
          <span className="emu-rom-inspect-val">{game.playTime || "0h"}</span>
        </div>

        {game.lastPlayed && (
          <div className="emu-rom-inspect-meta-item">
            <span className="emu-rom-inspect-label">
              <svg {...ICON}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {t("game.lastPlayed")}
            </span>
            <span className="emu-rom-inspect-val">{formatDate(game.lastPlayed)}</span>
          </div>
        )}

        {game.romHash && (
          <div className="emu-rom-inspect-meta-item">
            <span className="emu-rom-inspect-label">Hash</span>
            <span className="emu-mono emu-rom-inspect-val">{game.romHash}</span>
          </div>
        )}
      </div>

      {game.description && <p className="emu-rom-desc">{game.description}</p>}

      {game.launchArguments && (
        <div className="emu-rom-inspect-field">
          <span className="emu-rom-inspect-label">
            <svg {...ICON}>
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            {t("emulators.argumentsTemplate")}
          </span>
          <span className="emu-mono emu-rom-inspect-args">{game.launchArguments}</span>
        </div>
      )}

      <div className="emu-rom-inspect-field">
        <span className="emu-rom-inspect-label">
          <svg {...ICON}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          {t("emulators.roms.notes")}
        </span>
        <textarea
          className="modal-input emu-rom-notes-input"
          value={compatNotes}
          onChange={(e) => setCompatNotes(e.target.value)}
          rows={2}
          placeholder='e.g. "use Vulkan" / "requires BIOS file"'
        />
        <div className="emu-rom-notes-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onGameUpdated({ ...game, compatNotes: compatNotes.trim() || undefined });
              showToast(t("emulators.roms.saved") + " ✓", "success");
            }}
          >
            {t("emulators.roms.save")}
          </Button>
        </div>
      </div>

      <div className="emu-rom-actions-row">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={
            <svg {...ICON}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          }
          onClick={onToggleFavorite}
        >
          {game.favorite ? t("emulators.roms.favoriteRemove") : t("emulators.roms.favoriteAdd")}
        </Button>
      </div>
    </div>
  );
}

// ─── Metadata tab ───────────────────────────────────────────────────────────

function MetadataTab({ game, onGameUpdated }: { game: Game; onGameUpdated: (game: Game) => void }) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [candidates, setCandidates] = useState<RomMetadataCandidate[]>([]);
  const [fetching, setFetching] = useState(false);

  const [name, setName] = useState(game.name ?? "");
  const [region, setRegion] = useState(game.romRegion ?? "");
  const [language, setLanguage] = useState(game.romLanguage ?? "");
  const [description, setDescription] = useState(game.description ?? "");
  const [developer, setDeveloper] = useState(game.developer ?? "");
  const [publisher, setPublisher] = useState(game.publisher ?? "");
  const [releaseDate, setReleaseDate] = useState(game.releaseDate ?? "");
  const [genres, setGenres] = useState((game.genres ?? []).join(", "));
  const [coverUrl, setCoverUrl] = useState(game.coverSourceUrl ?? "");

  const fetchMetadata = async () => {
    setFetching(true);
    try {
      const results = await invoke<RomMetadataCandidate[]>("rom_scrape_metadata", { gameId: game.id });
      setCandidates(results);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setFetching(false);
    }
  };

  const applyCandidate = async (c: RomMetadataCandidate) => {
    try {
      const updated = await invoke<Game>("rom_apply_metadata", {
        gameId: game.id,
        patch: {
          name: c.title,
          coverArtUrl: c.coverUrl ?? undefined,
          description: c.description ?? undefined,
          developer: c.developer ?? undefined,
          publisher: c.publisher ?? undefined,
          releaseDate: c.releaseDate ?? undefined,
          genres: c.genres.length ? c.genres : undefined,
        },
      });
      onGameUpdated(updated);
      setName(updated.name ?? "");
      setDescription(updated.description ?? "");
      setDeveloper(updated.developer ?? "");
      setPublisher(updated.publisher ?? "");
      setReleaseDate(updated.releaseDate ?? "");
      setGenres((updated.genres ?? []).join(", "));
      setCoverUrl(updated.coverSourceUrl ?? "");
      showToast(t("emulators.roms.applyDone") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const saveManual = async () => {
    try {
      const updated = await invoke<Game>("rom_apply_metadata", {
        gameId: game.id,
        patch: {
          name: name.trim() || undefined,
          coverArtUrl: coverUrl.trim() || undefined,
          description: description.trim() || undefined,
          developer: developer.trim() || undefined,
          publisher: publisher.trim() || undefined,
          releaseDate: releaseDate.trim() || undefined,
          genres: genres.split(",").map((g) => g.trim()).filter(Boolean).length
            ? genres.split(",").map((g) => g.trim()).filter(Boolean)
            : undefined,
          region: region.trim() || undefined,
          language: language.trim() || undefined,
        },
      });
      onGameUpdated(updated);
      showToast(t("emulators.roms.saved") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  return (
    <div className="emu-rom-tab-panel">
      <div className="emu-panel-head">
        <h4>{t("emulators.roms.candidates")}</h4>
        <Button variant="secondary" size="sm" onClick={fetchMetadata} isLoading={fetching}>
          {fetching ? t("emulators.roms.fetching") : t("emulators.roms.fetch")}
        </Button>
      </div>

      {candidates.length === 0 && !fetching && (
        <p className="emu-panel-hint">{t("emulators.roms.none")}</p>
      )}
      <div className="emu-candidate-list">
        {candidates.map((c, i) => (
          <div key={`${c.title}-${i}`} className="emu-candidate">
            <div className="emu-candidate-info">
              <span className="emu-candidate-title">{c.title}</span>
              {c.releaseDate && <span className="emu-candidate-sub">{c.releaseDate}</span>}
              {c.genres.length > 0 && (
                <span className="emu-candidate-sub">{c.genres.slice(0, 3).join(", ")}</span>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={
                <svg {...ICON}>
                  <path d="M5 12l5 5L20 7" />
                </svg>
              }
              onClick={() => applyCandidate(c)}
            >
              {t("emulators.roms.apply")}
            </Button>
          </div>
        ))}
      </div>

      <div className="emu-panel-head emu-panel-head--spaced">
        <h4>{t("emulators.roms.manual")}</h4>
      </div>
      <div className="emu-manual-grid">
        <label className="emulators-field">
          <span>{t("emulators.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="emulators-field">
          <span>{t("emulators.roms.region")}</span>
          <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="USA" />
        </label>
        <label className="emulators-field">
          <span>{t("emulators.roms.language")}</span>
          <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="En,Fr" />
        </label>
        <label className="emulators-field">
          <span>{t("info.developer")}</span>
          <input value={developer} onChange={(e) => setDeveloper(e.target.value)} />
        </label>
        <label className="emulators-field">
          <span>{t("emulators.roms.publisher")}</span>
          <input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
        </label>
        <label className="emulators-field">
          <span>{t("gameInfo.releaseDate")}</span>
          <input value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} placeholder="1997-09-07" />
        </label>
        <label className="emulators-field emu-manual-wide">
          <span>{t("gameInfo.genre")}</span>
          <input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="RPG, Adventure" />
        </label>
        <label className="emulators-field emu-manual-wide">
          <span>{t("emulators.roms.coverUrl")}</span>
          <input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="emulators-field emu-manual-wide">
          <span>{t("game.description")}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
      </div>
      <div className="emu-manual-actions">
        <Button variant="primary" size="sm" onClick={saveManual}>
          {t("emulators.roms.save")}
        </Button>
      </div>
    </div>
  );
}

// ─── Launch profile tab ─────────────────────────────────────────────────────

function ProfileTab({ game, emulator, onGameUpdated }: { game: Game; emulator?: Emulator; onGameUpdated: (game: Game) => void }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const pads = useGamepads();

  const [argsOverride, setArgsOverride] = useState(game.romProfile?.argumentsOverride ?? "");
  const [graphicsBackend, setGraphicsBackend] = useState(game.romProfile?.graphicsBackend ?? "");
  const [resolution, setResolution] = useState(game.romProfile?.resolution ?? "");
  const [controllerLayout, setControllerLayout] = useState<ButtonLayout>(
    (game.romProfile?.controllerLayout as ButtonLayout) ?? "xbox"
  );
  const [shaders, setShaders] = useState(game.romProfile?.shaders ?? "");
  const [fullscreen, setFullscreen] = useState(game.romProfile?.fullscreen ?? false);

  const profileFromForm = (): RomProfile => ({
    argumentsOverride: argsOverride.trim() || undefined,
    graphicsBackend: graphicsBackend.trim() || undefined,
    resolution: resolution.trim() || undefined,
    controllerLayout: controllerLayout,
    shaders: shaders.trim() || undefined,
    fullscreen: fullscreen || undefined,
  });

  const saveProfile = async () => {
    try {
      const updated = await invoke<Game>("rom_profile_save", {
        gameId: game.id,
        profile: profileFromForm(),
      });
      onGameUpdated(updated);
      showToast(t("emulators.profile.saved") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const clearProfile = async () => {
    try {
      const updated = await invoke<Game>("rom_profile_save", {
        gameId: game.id,
        profile: {},
      });
      onGameUpdated(updated);
      setArgsOverride("");
      setGraphicsBackend("");
      setResolution("");
      setControllerLayout("xbox");
      setShaders("");
      setFullscreen(false);
      showToast(t("emulators.profile.saved") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const detected = pads.length > 0 ? pads[0] : null;
  const detectedLayout = detected ? guessLayout(detected.id) : null;

  return (
    <div className="emu-rom-tab-panel">
      <div className="emu-controller-strip">
        <span className="emu-controller-dot" />
        {detected ? (
          <span>{t("emulators.controllers.connected", { name: detected.id.split("(")[0].trim() })}</span>
        ) : (
          <span className="emu-controller-muted">{t("emulators.controllers.none")}</span>
        )}
      </div>

      <label className="emulators-field">
        <span>{t("emulators.profile.argsOverride")}</span>
        <input
          value={argsOverride}
          onChange={(e) => setArgsOverride(e.target.value)}
          placeholder={emulator?.argumentsTemplate || '\"%ROM%\"'}
        />
        <small className="emulators-hint">{t("emulators.profile.argsHint")}</small>
      </label>

      <div className="emulators-field-row">
        <label className="emulators-field">
          <span>{t("emulators.profile.graphicsBackend")}</span>
          <input value={graphicsBackend} onChange={(e) => setGraphicsBackend(e.target.value)} placeholder="vulkan" list="emu-gfx-backends" />
          <datalist id="emu-gfx-backends">
            <option value="vulkan" />
            <option value="opengl" />
            <option value="direct3d11" />
            <option value="direct3d12" />
            <option value="metal" />
            <option value="software" />
          </datalist>
        </label>
        <label className="emulators-field">
          <span>{t("emulators.profile.resolution")}</span>
          <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="4x / 1080p" />
        </label>
      </div>

      <div className="emulators-field-row">
        <label className="emulators-field">
          <span>{t("emulators.profile.shaders")}</span>
          <input value={shaders} onChange={(e) => setShaders(e.target.value)} placeholder="crt-royale" />
        </label>
        <label className="emulators-field">
          <span>{t("emulators.controllers.layout")}</span>
          <select value={controllerLayout} onChange={(e) => setControllerLayout(e.target.value as ButtonLayout)}>
            <option value="xbox">{t("emulators.controllers.layouts.xbox")}</option>
            <option value="ps">{t("emulators.controllers.layouts.ps")}</option>
            <option value="nintendo">{t("emulators.controllers.layouts.nintendo")}</option>
          </select>
        </label>
      </div>

      <label className="emulators-checkbox">
        <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} />
        <span>{t("emulators.profile.fullscreen")}</span>
      </label>

      {detectedLayout && (
        <p className="emu-panel-hint">
          {t("emulators.controllers.detectedHint")}: {detectedLayout}
        </p>
      )}

      <div className="emu-manual-actions">
        <Button variant="primary" size="sm" onClick={saveProfile}>
          {t("emulators.profile.save")}
        </Button>
        <Button variant="ghost" size="sm" onClick={clearProfile}>
          {t("emulators.profile.clear")}
        </Button>
      </div>
    </div>
  );
}

// ─── Saves tab ──────────────────────────────────────────────────────────────

function SavesTab({ game, emulator }: { game: Game; emulator?: Emulator }) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [status, setStatus] = useState<RomSavesStatus | null>(null);
  const [entries, setEntries] = useState<RomSaveEntry[]>([]);
  const [snapshots, setSnapshots] = useState<SaveSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, e, snaps] = await Promise.all([
        invoke<RomSavesStatus>("rom_saves_status", { gameId: game.id }),
        invoke<RomSaveEntry[]>("rom_saves_list", { gameId: game.id }),
        invoke<SaveSnapshot[]>("rom_saves_snapshots", { gameId: game.id }),
      ]);
      setStatus(s);
      setEntries(e);
      setSnapshots(snaps);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setLoading(false);
    }
  }, [game.id, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const backup = async () => {
    try {
      const count = await invoke<number>("rom_saves_backup", {
        gameId: game.id,
        name: snapshotName.trim() || null,
      });
      setSnapshotName("");
      await load();
      showToast(t("emulators.saves.backupDone", { count }) + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const restore = async (name: string) => {
    try {
      const count = await invoke<number>("rom_saves_restore", { gameId: game.id, name });
      await load();
      showToast(t("emulators.saves.restoreDone", { count }) + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const removeSnapshot = async (name: string) => {
    try {
      await invoke("rom_saves_delete", { gameId: game.id, name });
      await load();
      showToast(t("emulators.saves.deleteDone") + " ✓", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  if (!emulator?.savesFolder) {
    return (
      <div className="emu-rom-tab-panel">
        <p className="emu-panel-hint">{t("emulators.saves.notConfigured")}</p>
        <p className="emu-panel-hint">{t("emulators.saves.folderHint")}</p>
      </div>
    );
  }

  return (
    <div className="emu-rom-tab-panel">
      {loading && <p className="emu-panel-hint">…</p>}

      {status && (
        <div className={`emu-save-status${status.outdated ? " is-outdated" : " is-ok"}`}>
          <span className="emu-controller-dot" />
          {status.outdated ? t("emulators.saves.outdated") : t("emulators.saves.upToDate")}
          <span className="emu-save-status-sub">
            {status.hasSaves
              ? t("emulators.saves.count", { count: status.saveCount })
              : t("emulators.saves.none")}
            {status.lastSaveMtime ? ` · ${t("emulators.saves.lastSave")}: ${formatDateTime(status.lastSaveMtime)}` : ""}
            {status.lastBackupMtime ? ` · ${t("emulators.saves.lastBackup")}: ${formatDateTime(status.lastBackupMtime)}` : ""}
          </span>
        </div>
      )}

      {entries.length > 0 && (
        <div className="emu-save-list">
          {entries.map((e) => (
            <div key={e.path} className="emu-save-entry">
              <div className="emu-save-entry-info">
                <span className="emu-save-entry-name" title={e.relativePath}>
                  {e.relativePath}
                </span>
                <span className="emu-save-entry-sub">
                  {formatBytesShort(e.sizeBytes)} · {formatDateTime(e.modifiedAtMs)}
                </span>
              </div>
              {e.backedUp && <span className="emu-rom-badge">✓</span>}
            </div>
          ))}
        </div>
      )}

      <div className="emu-save-actions">
        <input
          className="modal-input"
          value={snapshotName}
          onChange={(e) => setSnapshotName(e.target.value)}
          placeholder={t("emulators.saves.snapshotName")}
        />
        <Button variant="secondary" size="sm" onClick={backup} disabled={!status?.hasSaves}>
          {t("emulators.saves.backup")}
        </Button>
      </div>

      {snapshots.length > 0 && (
        <div className="emu-snapshot-list">
          <h4>{t("emulators.saves.title")}</h4>
          {snapshots.map((s) => (
            <div key={s.name} className="emu-snapshot-entry">
              <div className="emu-save-entry-info">
                <span className="emu-save-entry-name">{s.name}</span>
                <span className="emu-save-entry-sub">
                  {s.fileCount} · {formatBytesShort(s.sizeBytes)} · {formatDateTime(s.createdAtMs)}
                </span>
              </div>
              <div className="emu-snapshot-actions">
                <Button variant="secondary" size="sm" onClick={() => restore(s.name)}>
                  {t("emulators.saves.restore")}
                </Button>
                <Button variant="danger" size="sm" onClick={() => removeSnapshot(s.name)}>
                  {t("emulators.saves.delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
