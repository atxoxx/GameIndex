import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import {
  type Game,
  type GameMetadataResult,
  type CompanionApp,
  type SimilarGame,
  type ReleaseDateInfo,
  type LanguageSupportInfo,
  formatSize,
  formatPlayTime,
  parsePlayTime,
  type PlayStatus,
  PLAY_STATUS_DETAILS,
  extractSteamAppIdFromWebsites,
} from "../../types/game";
import type { SteamLaunchOption } from "../../types/steam";
import { Button } from "../../components/ui";
import { EditImageSlot } from "./EditImageSlot";
import { MediaFetchBrowser } from "./MediaFetchBrowser";
import { UrlListEditor } from "./UrlListEditor";
import { TagInput } from "../../components/ui/TagInput";
import { ArrayEditor } from "../../components/ui/ArrayEditor";
import { toWebviewAssetUrl } from "../../utils/artworkUrl";
import "./EditGameModal.css";

const GENRE_SUGGESTIONS = [
  "Action", "Adventure", "RPG", "Shooter", "Strategy", "Puzzle", "Platformer",
  "Simulation", "Sports", "Racing", "Fighting", "Horror", "Indie", "Casual", "MMO"
];
const THEME_SUGGESTIONS = [
  "Sci-Fi", "Fantasy", "Horror", "Open World", "Sandbox", "Survival",
  "Story Rich", "Atmospheric", "Pixel Graphics", "Post-Apocalyptic", "Cyberpunk", "Comedy"
];
const MODE_SUGGESTIONS = [
  "Singleplayer", "Multiplayer", "Co-op", "Online Co-Op", "Split Screen", "PvP", "PvE", "Massively Multiplayer"
];
const PERSPECTIVE_SUGGESTIONS = [
  "First-Person", "Third-Person", "Top-Down", "Side View", "Isometric", "Bird's-Eye", "Text"
];
const LANGUAGE_SUPPORT_TYPES = ["Audio", "Subtitles", "Interface"];

const COMMON_LAUNCH_ARGS = [
  { label: "-windowed", desc: "Windowed mode" },
  { label: "-fullscreen", desc: "Fullscreen" },
  { label: "-novid", desc: "Skip intro video" },
  { label: "-dx11", desc: "Force DirectX 11" },
  { label: "-vulkan", desc: "Force Vulkan" },
  { label: "-dev", desc: "Developer console" },
  { label: "-high", desc: "High CPU priority" },
];

type EditTab = "details" | "media" | "launch";

interface EditGameModalProps {
  game: Game;
  onClose: () => void;
}

export function EditGameModal({ game, onClose }: EditGameModalProps) {
  const { showToast } = useToast();
  const { updateGame, isGameUntracked, toggleGameTracking } = useGames();
  const { unit: sizeUnit } = useSizeUnit();
  const { t } = useLanguage();

  const [editTab, setEditTab] = useState<EditTab>("details");

  const [editName, setEditName] = useState(game.name);
  const [editPlatform, setEditPlatform] = useState(game.platform);
  const [editPlayStatus, setEditPlayStatus] = useState<PlayStatus>(game.playStatus || "backlog");
  const [editUntracked, setEditUntracked] = useState(game.untracked ?? isGameUntracked(game.id));
  const [editDeveloper, setEditDeveloper] = useState(game.developer || "");
  const [editPublisher, setEditPublisher] = useState(game.publisher || "");
  const [editReleaseDate, setEditReleaseDate] = useState(game.releaseDate || "");
  const [editDescription, setEditDescription] = useState(game.description || "");
  const [editStoryline, setEditStoryline] = useState(game.storyline || "");
  const [editNotes, setEditNotes] = useState(game.notes || "");

  const [editIgdbRating, setEditIgdbRating] = useState(game.igdbRating || 0);
  const [editCriticRating, setEditCriticRating] = useState(game.criticRating || 0);
  const [editGenres, setEditGenres] = useState<string[]>(game.genres || []);
  const [editThemes, setEditThemes] = useState<string[]>(game.themes || []);
  const [editGameModes, setEditGameModes] = useState<string[]>(game.gameModes || []);
  const [editPlayerPerspectives, setEditPlayerPerspectives] = useState<string[]>(game.playerPerspectives || []);
  const [editTimeToBeatMain, setEditTimeToBeatMain] = useState(game.timeToBeat?.normally ? Math.round(game.timeToBeat.normally / 3600) : 0);
  const [editTimeToBeatExtra, setEditTimeToBeatExtra] = useState(game.timeToBeat?.hastily ? Math.round(game.timeToBeat.hastily / 3600) : 0);
  const [editTimeToBeatComple, setEditTimeToBeatComple] = useState(game.timeToBeat?.completely ? Math.round(game.timeToBeat.completely / 3600) : 0);
  const [editSimilarGamesNames, setEditSimilarGamesNames] = useState<string[]>(
    game.similarGames ? game.similarGames.map((g) => g.name) : []
  );
  const [editCollection, setEditCollection] = useState(game.collection || "");
  const [editFranchise, setEditFranchise] = useState(game.franchise || "");
  const [editGameCategory, setEditGameCategory] = useState(game.gameCategory || "");
  const [editReleaseStatus, setEditReleaseStatus] = useState(game.releaseStatus || "");
  const [editAlternativeNames, setEditAlternativeNames] = useState<string[]>(game.alternativeNames || []);

  const [editIcon, setEditIcon] = useState(game.iconUrl || "");
  const [editCover, setEditCover] = useState(game.coverArtUrl || "");
  const [editHero, setEditHero] = useState(game.bannerUrl || "");
  const [editLogo, setEditLogo] = useState(game.logoUrl || "");
  const [editScreenshots, setEditScreenshots] = useState<string[]>(game.screenshots || []);
  const [editVideos, setEditVideos] = useState<string[]>(game.videos || []);
  const [editWebsites, setEditWebsites] = useState<string[]>(game.websites || []);

  const [editSizeBytes, setEditSizeBytes] = useState<number | undefined>(game.sizeBytes);
  const [editSizeRootPath, setEditSizeRootPath] = useState<string | undefined>(game.sizeRootPath);
  const [detectingSize, setDetectingSize] = useState(false);
  const [editMetadataSource, setEditMetadataSource] = useState(game.metadataSource || "");
  const [editMetadataUrl, setEditMetadataUrl] = useState(game.metadataUrl || "");
  const [editReleases, setEditReleases] = useState<ReleaseDateInfo[]>(game.releases || []);
  const [editLanguageSupports, setEditLanguageSupports] = useState<LanguageSupportInfo[]>(game.languageSupports || []);

  const [editPlaytimeHours, setEditPlaytimeHours] = useState<number>(
    Math.floor(parsePlayTime(game.playTime) / 60)
  );
  const [editPlaytimeMinutes, setEditPlaytimeMinutes] = useState<number>(
    parsePlayTime(game.playTime) % 60
  );

  function resetPlaytimeEdits() {
    setEditPlaytimeHours(0);
    setEditPlaytimeMinutes(0);
  }

  const lastSeenPlaytimeRef = useRef(game.playTime);
  useEffect(() => {
    if (game.playTime === lastSeenPlaytimeRef.current) return;
    lastSeenPlaytimeRef.current = game.playTime;
    const total = parsePlayTime(game.playTime);
    setEditPlaytimeHours(Math.floor(total / 60));
    setEditPlaytimeMinutes(total % 60);
  }, [game.playTime]);

  const [editPath, setEditPath] = useState(game.path || "");
  const [editLaunchArguments, setEditLaunchArguments] = useState(game.launchArguments || "");
  const [editRunAsAdmin, setEditRunAsAdmin] = useState(game.runAsAdmin || false);
  const [editShowSteamLaunchSelection, setEditShowSteamLaunchSelection] = useState(game.showSteamLaunchSelection || false);
  const [editPreLaunchScript, setEditPreLaunchScript] = useState(game.preLaunchScript || "");
  const [editPreLaunchAdmin, setEditPreLaunchAdmin] = useState(game.preLaunchAdmin || false);
  const [editPostExitScript, setEditPostExitScript] = useState(game.postExitScript || "");
  const [editPostExitAdmin, setEditPostExitAdmin] = useState(game.postExitAdmin || false);
  const [editCompanionApps, setEditCompanionApps] = useState<CompanionApp[]>(
    game.companionApps && game.companionApps.length > 0
      ? game.companionApps.map((c) => ({ ...c }))
      : []
  );

  const [steamLaunchOptions, setSteamLaunchOptions] = useState<SteamLaunchOption[] | null>(null);
  useEffect(() => {
    if (game.platform !== "Steam" || !game.steamAppId) {
      setSteamLaunchOptions(null);
      return;
    }
    let cancelled = false;
    invoke<SteamLaunchOption[]>("steam_launch_options", { steamAppId: game.steamAppId })
      .then((options) => {
        if (!cancelled) setSteamLaunchOptions(options);
      })
      .catch(() => {
        if (!cancelled) setSteamLaunchOptions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [game.platform, game.steamAppId]);

  const steamLaunchListLabel = steamLaunchOptions
    ? steamLaunchOptions
        .map((o) => o.description.trim() || `Option ${o.index}`)
        .join(", ")
    : "";

  const [fetchingMetadata, setFetchingMetadata] = useState(false);
  const [metadataResults, setMetadataResults] = useState<GameMetadataResult[]>([]);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [applyingMetadata, setApplyingMetadata] = useState(false);

  const [mediaFetchSlot, setMediaFetchSlot] = useState<
    "icon" | "cover" | "hero" | "logo" | null
  >(null);
  const [fetchingImageKey, setFetchingImageKey] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setImageSlot(key: "icon" | "cover" | "hero" | "banner" | "logo", value: string) {
    const slot = key === "banner" ? "hero" : key;
    if (slot === "icon") setEditIcon(value);
    else if (slot === "cover") setEditCover(value);
    else if (slot === "hero") setEditHero(value);
    else setEditLogo(value);
  }

  async function searchMetadata(): Promise<GameMetadataResult[]> {
    return invoke("search_game_metadata", {
      gameName: editName.trim() || game.name,
      steamAppId: editName.trim() ? undefined : game.steamAppId,
    });
  }

  async function applyRemoteImage(slot: "icon" | "cover" | "hero" | "banner" | "logo", url: string): Promise<boolean> {
    setImageSlot(slot, url);
    const relativePath = await invoke<string | null>("download_artwork", {
      gameId: game.id,
      slot: slot === "banner" ? "hero" : slot,
      url,
    });
    if (relativePath) {
      const assetUrl = toWebviewAssetUrl(
        await invoke<string>("artwork_asset_url", { relativePath })
      );
      setImageSlot(slot, assetUrl);
      showToast(`Applied and saved image as ${slot}`, "success");
      return true;
    }
    showToast("Failed to download image", "error");
    return false;
  }

  async function handleFetchMetadata() {
    setFetchingMetadata(true);
    setMetadataResults([]);
    setShowMetadataPanel(true);
    try {
      const results: GameMetadataResult[] = await searchMetadata();
      setMetadataResults(results);
      if (results.length === 0) showToast("No metadata found for this game", "info");
    } catch (err) {
      showToast(`Failed to search metadata: ${err}`, "error");
    } finally {
      setFetchingMetadata(false);
    }
  }

  function handleFetchImage(key: "icon" | "cover" | "hero" | "logo") {
    // Open the media browser so the user can pick a jpg/jpeg/png/webp from
    // Steam, IGDB and SteamGridDB for this slot (no longer auto-fetches).
    setMediaFetchSlot(key);
  }

  async function handleApplyFetchedImage(url: string): Promise<void> {
    const slot = mediaFetchSlot;
    if (!slot) return;
    await applyRemoteImage(slot, url);
  }

  async function handleApplyMetadata(result: GameMetadataResult) {
    setApplyingMetadata(true);
    try {
      const imageKeys = ["icon", "cover", "hero", "banner", "logo"] as const;
      const imageEntries = imageKeys
        .map((key) => [key, result.images[key]] as const)
        .filter(([, url]) => url != null);
      const downloadedEntries = await Promise.all(
        imageEntries.map(async ([key, url]) => {
          const relativePath = await invoke<string | null>("download_artwork", {
            gameId: game.id,
            slot: key === "banner" ? "hero" : key,
            url,
          });
          const assetUrl = relativePath
            ? toWebviewAssetUrl(await invoke<string>("artwork_asset_url", { relativePath }))
            : undefined;
          return [key, assetUrl] as const;
        }),
      );
      const downloaded: Record<string, string | undefined> = Object.fromEntries(downloadedEntries);

      const iconUrl = downloaded.icon;
      const coverUrl = downloaded.cover || game.coverArtUrl;
      const heroUrl = downloaded.hero;
      const bannerUrl = downloaded.banner;
      const logoUrl = downloaded.logo;
      const finalBannerUrl = bannerUrl ?? heroUrl ?? undefined;

      setEditName(result.title || game.name);
      setEditDescription(result.description || "");
      setEditDeveloper(result.developer || "");
      setEditPublisher(result.publisher || "");
      setEditReleaseDate(result.releaseDate || "");
      setEditGenres(result.genres || []);
      setEditStoryline(result.storyline || "");
      setEditIgdbRating(result.igdbRating || 0);
      setEditCriticRating(result.criticRating || 0);
      setEditThemes(result.themes || []);
      setEditGameModes(result.gameModes || []);
      setEditPlayerPerspectives(result.playerPerspectives || []);

      if (iconUrl) setEditIcon(iconUrl);
      if (coverUrl) setEditCover(coverUrl);
      if (finalBannerUrl) setEditHero(finalBannerUrl);
      if (logoUrl) setEditLogo(logoUrl);

      setEditScreenshots(result.screenshots || []);
      setEditVideos(result.videos || []);
      setEditWebsites(result.websites || []);

      setEditTimeToBeatMain(result.timeToBeat?.normally ? Math.round(result.timeToBeat.normally / 3600) : 0);
      setEditTimeToBeatExtra(result.timeToBeat?.hastily ? Math.round(result.timeToBeat.hastily / 3600) : 0);
      setEditTimeToBeatComple(result.timeToBeat?.completely ? Math.round(result.timeToBeat.completely / 3600) : 0);
      setEditSimilarGamesNames(result.similarGames ? result.similarGames.map((g) => g.name) : []);
      setEditReleases(result.releases || []);
      setEditLanguageSupports(result.languageSupports || []);

      setEditCollection(result.collection || "");
      setEditFranchise(result.franchise || "");
      setEditGameCategory(result.gameCategory || "");
      setEditReleaseStatus(result.releaseStatus || "");
      setEditAlternativeNames(result.alternativeNames || []);

      setEditMetadataSource(result.sourceName);
      setEditMetadataUrl(result.sourceUrl);

      showToast(`Autofilled metadata from ${result.sourceName}. Review and save!`, "success");
      setShowMetadataPanel(false);
    } catch (err) {
      showToast(`Failed to apply metadata: ${err}`, "error");
    } finally {
      setApplyingMetadata(false);
    }
  }

  async function handlePickImage(key: "icon" | "cover" | "hero" | "logo") {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: `Select ${key.charAt(0).toUpperCase() + key.slice(1)} Image`,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      if (filePath && typeof filePath === "string") {
        const relativePath = await invoke<string | null>("store_artwork_file", {
          gameId: game.id,
          slot: key,
          filePath,
        });
        if (relativePath) {
          const assetUrl = toWebviewAssetUrl(
            await invoke<string>("artwork_asset_url", { relativePath })
          );
          setImageSlot(key, assetUrl);
        }
      }
    } catch (err) {
      showToast("Failed to load image", "error");
    }
  }

  function handleRemoveImage(key: "icon" | "cover" | "hero" | "logo") {
    setImageSlot(key, "");
  }

  async function handleApplyIgdbImage(imageUrl: string, slot: "icon" | "cover" | "hero" | "banner" | "logo") {
    setFetchingImageKey(slot);
    try {
      await applyRemoteImage(slot, imageUrl);
    } catch (err) {
      showToast(`Failed to apply image: ${err}`, "error");
    } finally {
      setFetchingImageKey(null);
    }
  }

  async function openFolderAndDetectSize() {
    if (detectingSize) return;
    setDetectingSize(true);
    try {
      const picked = await open({ directory: true, multiple: false, title: "Select game folder" });
      if (!picked || Array.isArray(picked)) return;
      const folder = picked as string;
      const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
        exePath: "",
        gameName: (editName || game.name || "").trim(),
        rootOverride: folder,
      });
      setEditSizeBytes(result.sizeBytes);
      setEditSizeRootPath(result.rootPath);
      showToast(`Detected ${formatSize(result.sizeBytes, sizeUnit)}`, "success");
    } catch (err) {
      console.error("detect_game_size failed", err);
      showToast(`Could not read folder size: ${err}`, "error");
    } finally {
      setDetectingSize(false);
    }
  }

  function clearSize() {
    setEditSizeBytes(undefined);
    setEditSizeRootPath(undefined);
  }

  async function handlePickExecutable() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Select Game Executable",
        filters: [
          { name: "Executables", extensions: ["exe", "bat", "lnk", "cmd"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (filePath && typeof filePath === "string") setEditPath(filePath);
    } catch (err) {
      showToast("Failed to select executable", "error");
    }
  }

  async function handlePickScript(setter: (path: string) => void, title: string) {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title,
        filters: [
          { name: "Scripts", extensions: ["bat", "cmd", "ps1", "exe"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (filePath && typeof filePath === "string") setter(filePath);
    } catch (err) {
      showToast("Failed to select file", "error");
    }
  }

  async function handlePickCompanion(index: number) {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Select Companion Executable",
        filters: [
          { name: "Executables", extensions: ["exe", "bat", "lnk", "cmd"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (filePath && typeof filePath === "string") {
        setEditCompanionApps((prev) =>
          prev.map((c, i) => (i === index ? { ...c, path: filePath } : c))
        );
      }
    } catch (err) {
      showToast("Failed to select file", "error");
    }
  }

  function addCompanionApp() {
    setEditCompanionApps((prev) => [
      ...prev,
      { path: "", arguments: "", delayMs: 0, runAsAdmin: false },
    ]);
  }

  function updateCompanionApp(index: number, patch: Partial<CompanionApp>) {
    setEditCompanionApps((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
    );
  }

  function removeCompanionApp(index: number) {
    setEditCompanionApps((prev) => prev.filter((_, i) => i !== index));
  }

  function appendLaunchArg(arg: string) {
    const trimmed = editLaunchArguments.trim();
    if (!trimmed) {
      setEditLaunchArguments(arg);
    } else if (!trimmed.includes(arg)) {
      setEditLaunchArguments(`${trimmed} ${arg}`);
    }
  }

  function saveEdits() {
    const newName = editName.trim() || game.name;
    const newPlatform = editPlatform.trim() || game.platform;
    const newIcon = editIcon || undefined;
    const newSizeBytes = editSizeBytes;
    const newSizeRootPath = editSizeRootPath;
    const newSizeDetectedAt = editSizeBytes != null ? new Date().toISOString() : undefined;
    const newCover = editCover || undefined;
    const newHero = editHero || undefined;
    const newLogo = editLogo || undefined;
    const newNotes = editNotes.trim() || undefined;

    const newDescription = editDescription.trim() || undefined;
    const newDeveloper = editDeveloper.trim() || undefined;
    const newPublisher = editPublisher.trim() || undefined;
    const newReleaseDate = editReleaseDate.trim() || undefined;
    const newGenres = editGenres.length > 0 ? editGenres : undefined;
    const newStoryline = editStoryline.trim() || undefined;
    const newIgdbRating = editIgdbRating > 0 ? Number(editIgdbRating) : undefined;
    const newCriticRating = editCriticRating > 0 ? Number(editCriticRating) : undefined;
    const newThemes = editThemes.length > 0 ? editThemes : undefined;
    const newGameModes = editGameModes.length > 0 ? editGameModes : undefined;
    const newPlayerPerspectives = editPlayerPerspectives.length > 0 ? editPlayerPerspectives : undefined;

    const existingSims = game.similarGames || [];
    const newSimilarGames: SimilarGame[] = editSimilarGamesNames
      .map((name, index) => {
        const existing = existingSims.find((g) => g.name.toLowerCase() === name.toLowerCase());
        return {
          id: existing ? existing.id : index,
          name,
          coverUrl: existing ? existing.coverUrl : undefined,
        };
      });

    const newReleases = editReleases.filter((r) => r.platform);
    const newLanguageSupports = editLanguageSupports.length > 0 ? editLanguageSupports : undefined;
    const newAlternativeNames = editAlternativeNames.filter(Boolean);

    const newSteamAppId =
      game.steamAppId ?? extractSteamAppIdFromWebsites(editWebsites) ?? undefined;

    updateGame(game.id, {
      name: newName,
      platform: newPlatform,
      steamAppId: newSteamAppId,
      iconUrl: newIcon,
      coverArtUrl: newCover,
      coverSourceUrl: /^https:\/\//i.test(newCover || "") ? newCover : undefined,
      bannerUrl: newHero,
      logoUrl: newLogo,
      notes: newNotes,
      description: newDescription,
      sizeBytes: newSizeBytes,
      sizeRootPath: newSizeRootPath,
      sizeDetectedAt: newSizeDetectedAt,
      developer: newDeveloper,
      publisher: newPublisher,
      releaseDate: newReleaseDate,
      genres: newGenres,
      storyline: newStoryline,
      igdbRating: newIgdbRating,
      criticRating: newCriticRating,
      themes: newThemes,
      gameModes: newGameModes,
      playerPerspectives: newPlayerPerspectives,
      screenshots: editScreenshots.length > 0 ? editScreenshots : undefined,
      videos: editVideos.length > 0 ? editVideos : undefined,
      websites: editWebsites.length > 0 ? editWebsites : undefined,
      timeToBeat: {
        normally: editTimeToBeatMain > 0 ? editTimeToBeatMain * 3600 : undefined,
        hastily: editTimeToBeatExtra > 0 ? editTimeToBeatExtra * 3600 : undefined,
        completely: editTimeToBeatComple > 0 ? editTimeToBeatComple * 3600 : undefined,
      },
      similarGames: newSimilarGames.length > 0 ? newSimilarGames : undefined,
      releases: newReleases.length > 0 ? newReleases : undefined,
      igdbReviews: game.igdbReviews,
      alternativeNames: newAlternativeNames.length > 0 ? newAlternativeNames : undefined,
      collection: editCollection.trim() || undefined,
      franchise: editFranchise.trim() || undefined,
      gameCategory: editGameCategory.trim() || undefined,
      releaseStatus: editReleaseStatus.trim() || undefined,
      languageSupports: newLanguageSupports,
      metadataSource: editMetadataSource ? editMetadataSource : undefined,
      metadataUrl: editMetadataUrl ? editMetadataUrl : undefined,
      path: editPath.trim() || undefined,
      // Attaching an executable means the game is present on disk — flip
      // it to installed. One-way only: clearing a path never downgrades
      // installed (launcher titles stay installed without a local exe).
      installed: editPath.trim() ? true : game.installed,
      launchArguments: editLaunchArguments.trim() || undefined,
      runAsAdmin: editRunAsAdmin || undefined,
      showSteamLaunchSelection: editShowSteamLaunchSelection || undefined,
      preLaunchScript: editPreLaunchScript.trim() || undefined,
      preLaunchAdmin: editPreLaunchAdmin || undefined,
      postExitScript: editPostExitScript.trim() || undefined,
      postExitAdmin: editPostExitAdmin || undefined,
      companionApps:
        editCompanionApps.length > 0
          ? editCompanionApps
              .filter((c) => c.path.trim())
              .map((c) => ({
                path: c.path.trim(),
                arguments: c.arguments?.trim() || undefined,
                delayMs: Math.max(0, Number(c.delayMs) || 0),
                runAsAdmin: c.runAsAdmin || undefined,
              }))
          : undefined,
      playStatus: editPlayStatus,
      playTime: formatPlayTime(
        Math.max(0, Math.floor(editPlaytimeHours)) * 60 +
        Math.max(0, Math.min(59, Math.floor(editPlaytimeMinutes)))
      ),
    });
    if (editUntracked !== (game.untracked ?? isGameUntracked(game.id))) {
      toggleGameTracking(game.id, editUntracked);
    }
    onClose();
    showToast("Game updated", "success");
  }

  const tabs: { key: EditTab; label: string; icon: ReactNode }[] = [
    {
      key: "details",
      label: t("edit.tab.details"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      ),
    },
    {
      key: "media",
      label: t("edit.tab.media"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      ),
    },
    {
      key: "launch",
      label: t("edit.tab.launch"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      ),
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="edit-modal-preview">
          <div className="edit-modal-preview-art">
            <div className="edit-preview-hero" style={editHero ? { backgroundImage: `url(${editHero})` } : undefined}>
              {!editHero && <span className="edit-preview-hero-ph">{t("edit.label.hero")}</span>}
            </div>
            <div className="edit-preview-cover" style={editCover ? { backgroundImage: `url(${editCover})` } : undefined}>
              {!editCover && <span>{t("edit.label.cover")}</span>}
            </div>
            {editIcon && <img className="edit-preview-icon" src={editIcon} alt="icon" />}
          </div>
          <div className="edit-modal-preview-meta">
            <div className="edit-preview-eyebrow-row">
              <span className="edit-preview-platform">{editPlatform || "Platform"}</span>
              <span className={`edit-preview-status-pill status-${editPlayStatus}`}>
                {t(PLAY_STATUS_DETAILS[editPlayStatus].labelKey)}
              </span>
            </div>
            <h3 className="edit-preview-title">{editName || game.name}</h3>
            {(editDeveloper || editPublisher) && (
              <p className="edit-preview-sub">
                {[editDeveloper, editPublisher].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="edit-modal-preview-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={handleFetchMetadata}
              disabled={fetchingMetadata}
              isLoading={fetchingMetadata}
              leftIcon={
                !fetchingMetadata ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                ) : undefined
              }
            >
              {fetchingMetadata ? t("edit.searching") : t("edit.fetchMetadata")}
            </Button>
            <button className="metadata-panel-close" onClick={onClose} aria-label={t("common.close")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="edit-modal-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={editTab === tab.key}
              className={`edit-modal-tab ${editTab === tab.key ? "active" : ""}`}
              onClick={() => setEditTab(tab.key)}
            >
              <span className="edit-modal-tab-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="edit-modal-body">
          {editTab === "details" && (
            <div className="edit-form">
              {showMetadataPanel && (
                <div className="metadata-panel">
                  <div className="metadata-panel-header">
                    <h3>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      {t("edit.metadataSearchResults")}
                    </h3>
                    <button className="metadata-panel-close" onClick={() => setShowMetadataPanel(false)} aria-label="Close results">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  <div className="metadata-panel-body">
                    {fetchingMetadata ? (
                      <div className="metadata-loading">
                        <div className="metadata-spinner" />
                        <p>Searching for "{game.name}"...</p>
                      </div>
                    ) : metadataResults.length === 0 ? (
                      <div className="metadata-empty">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <p>{t("edit.noResults")}</p>
                      </div>
                    ) : (
                      <div className="metadata-results">
                        {metadataResults.map((result, idx) => (
                          <div key={idx} className="metadata-result-card">
                            <div className="metadata-result-header">
                              <span className="metadata-result-source">{result.sourceName}</span>
                              <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="metadata-result-link" title="Open source page">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                  <polyline points="15 3 21 3 21 9" />
                                  <line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                              </a>
                            </div>
                            <div className="metadata-result-title">{result.title}</div>
                            {result.description && <p className="metadata-result-desc">{result.description}</p>}
                            <div className="metadata-result-details">
                              {result.developer && <span><strong>Dev:</strong> {result.developer}</span>}
                              {result.publisher && <span><strong>Pub:</strong> {result.publisher}</span>}
                              {result.releaseDate && <span><strong>Released:</strong> {result.releaseDate}</span>}
                            </div>
                            {result.genres.length > 0 && (
                              <div className="metadata-result-genres">
                                {result.genres.map((g) => (
                                  <span key={g} className="metadata-genre-tag">{g}</span>
                                ))}
                              </div>
                            )}
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={applyingMetadata}
                              isLoading={applyingMetadata}
                              onClick={() => handleApplyMetadata(result)}
                              leftIcon={
                                !applyingMetadata ? (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : undefined
                              }
                            >
                              {t("edit.applyMetadata")}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <fieldset className="edit-fieldset">
                <legend className="edit-fieldset-legend">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  {t("edit.coreIdentity")}
                </legend>
                <div className="edit-form-grid">
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-name">{t("edit.label.name")}</label>
                    <input id="edit-name" className="edit-input" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Game name" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-play-status">{t("edit.label.playStatus")}</label>
                    <select id="edit-play-status" className="edit-input edit-select" value={editPlayStatus} onChange={(e) => setEditPlayStatus(e.target.value as PlayStatus)}>
                      {Object.entries(PLAY_STATUS_DETAILS).map(([key, details]) => (
                        <option key={key} value={key}>{t(details.labelKey)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-platform">{t("edit.label.platform")}</label>
                    <input id="edit-platform" className="edit-input" type="text" value={editPlatform} onChange={(e) => setEditPlatform(e.target.value)} placeholder="e.g., Steam, GOG, Epic, Local" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-release-date">{t("edit.label.releaseDate")}</label>
                    <input id="edit-release-date" className="edit-input" type="text" value={editReleaseDate} onChange={(e) => setEditReleaseDate(e.target.value)} placeholder="e.g., YYYY-MM-DD" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-developer">{t("edit.label.developer")}</label>
                    <input id="edit-developer" className="edit-input" type="text" value={editDeveloper} onChange={(e) => setEditDeveloper(e.target.value)} placeholder="Developer studio" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-publisher">{t("edit.label.publisher")}</label>
                    <input id="edit-publisher" className="edit-input" type="text" value={editPublisher} onChange={(e) => setEditPublisher(e.target.value)} placeholder="Publisher company" />
                  </div>
                </div>
                <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                  <label className="edit-label" htmlFor="edit-description">{t("edit.label.description")}</label>
                  <textarea id="edit-description" className="edit-input edit-textarea" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Short overview and gameplay summary..." rows={3} />
                </div>
              </fieldset>

              <fieldset className="edit-fieldset">
                <legend className="edit-fieldset-legend">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                  {t("edit.storageAndPlaytime")}
                </legend>
                <div className="edit-field full-width" data-storage-row>
                  <label className="edit-label">{t("edit.label.size")}</label>
                  <div className="size-edit-row">
                    <input className="edit-input size-readonly" type="text" readOnly value={editSizeBytes != null ? formatSize(editSizeBytes, sizeUnit) : "Not set"} placeholder="Not set" />
                    <button type="button" className="edit-btn edit-btn-secondary" onClick={openFolderAndDetectSize} disabled={detectingSize}>
                      {detectingSize ? (
                        <>
                          <div className="edit-slot-spinner" style={{ width: 12, height: 12 }} />
                          {t("community.detecting") || "Detecting..."}
                        </>
                      ) : (
                        t("edit.autoDetect") || "Auto-detect"
                      )}
                    </button>
                    <button type="button" className="edit-btn edit-btn-ghost" onClick={clearSize} disabled={editSizeBytes == null}>
                      {t("common.clear")}
                    </button>
                  </div>
                  {editSizeRootPath && <span className="size-edit-hint" title={editSizeRootPath}>Folder: {editSizeRootPath}</span>}
                </div>

                <div className="edit-field full-width" data-storage-row style={{ marginTop: "var(--space-md)" }}>
                  <label className="edit-label">{t("edit.label.playtime")}</label>
                  <div className="edit-form-grid" style={{ gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-playtime-hours">{t("edit.playtime.hours")}</label>
                      <input
                        id="edit-playtime-hours"
                        className="edit-input"
                        type="number"
                        min={0}
                        step={1}
                        value={editPlaytimeHours || ""}
                        onChange={(e) => setEditPlaytimeHours(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                        placeholder="0"
                      />
                    </div>
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-playtime-minutes">{t("edit.playtime.minutes")}</label>
                      <input
                        id="edit-playtime-minutes"
                        className="edit-input"
                        type="number"
                        min={0}
                        max={59}
                        step={1}
                        value={editPlaytimeMinutes || ""}
                        onChange={(e) => setEditPlaytimeMinutes(Math.max(0, Math.min(59, Math.floor(Number(e.target.value) || 0))))}
                        placeholder="0"
                      />
                    </div>
                    <div className="edit-field">
                      <button
                        type="button"
                        className="edit-btn edit-btn-ghost"
                        onClick={resetPlaytimeEdits}
                        disabled={editPlaytimeHours === 0 && editPlaytimeMinutes === 0}
                        title={t("edit.playtime.resetTitle")}
                      >
                        {t("common.reset")}
                      </button>
                    </div>
                  </div>
                  <span className="size-edit-hint">{t("edit.playtime.hint")}</span>
                </div>
              </fieldset>

              <fieldset className="edit-fieldset">
                <legend className="edit-fieldset-legend">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  {t("edit.tagsAndThemes")}
                </legend>
                <div className="edit-form-grid">
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-genres">{t("edit.label.genres")}</label>
                    <TagInput id="edit-genres" value={editGenres} onChange={setEditGenres} placeholder="Add a genre, press Enter" suggestions={GENRE_SUGGESTIONS} ariaLabel="Genres" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-themes">{t("edit.label.themes")}</label>
                    <TagInput id="edit-themes" value={editThemes} onChange={setEditThemes} placeholder="Add a theme, press Enter" suggestions={THEME_SUGGESTIONS} ariaLabel="Themes" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-modes">{t("edit.label.gameModes")}</label>
                    <TagInput id="edit-modes" value={editGameModes} onChange={setEditGameModes} placeholder="Add a mode, press Enter" suggestions={MODE_SUGGESTIONS} ariaLabel="Game Modes" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-perspectives">{t("edit.label.perspectives")}</label>
                    <TagInput id="edit-perspectives" value={editPlayerPerspectives} onChange={setEditPlayerPerspectives} placeholder="Add a perspective, press Enter" suggestions={PERSPECTIVE_SUGGESTIONS} ariaLabel="Player Perspectives" />
                  </div>
                </div>
              </fieldset>

              <fieldset className="edit-fieldset">
                <legend className="edit-fieldset-legend">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  {t("edit.storyAndNotes")}
                </legend>
                <div className="edit-field full-width">
                  <label className="edit-label" htmlFor="edit-storyline">{t("edit.label.storyline")}</label>
                  <textarea id="edit-storyline" className="edit-input edit-textarea" value={editStoryline} onChange={(e) => setEditStoryline(e.target.value)} placeholder="Deep storyline and narrative context..." rows={3} />
                </div>
                <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                  <label className="edit-label" htmlFor="edit-notes">{t("edit.label.notes")}</label>
                  <textarea id="edit-notes" className="edit-input edit-textarea" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Personal notes, walkthrough reminders, cheats..." rows={3} />
                </div>
              </fieldset>

              <details className="edit-disclosure">
                <summary className="edit-disclosure-summary">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span>{t("edit.moreDetails")}</span>
                </summary>
                <div className="edit-disclosure-body">
                  <div className="edit-subgroup">
                    <h5 className="edit-subgroup-title">{t("edit.ratings")}</h5>
                    <div className="edit-form-grid">
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-igdb-rating">{t("edit.label.igdbRating")}</label>
                        <input id="edit-igdb-rating" className="edit-input" type="number" min={0} max={100} value={editIgdbRating || ""} onChange={(e) => setEditIgdbRating(Number(e.target.value))} placeholder="0-100" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-critic-rating">{t("edit.label.criticRating")}</label>
                        <input id="edit-critic-rating" className="edit-input" type="number" min={0} max={100} value={editCriticRating || ""} onChange={(e) => setEditCriticRating(Number(e.target.value))} placeholder="0-100" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-hltb-main">{t("edit.label.hltbMain")}</label>
                        <input id="edit-hltb-main" className="edit-input" type="number" min={0} value={editTimeToBeatMain || ""} onChange={(e) => setEditTimeToBeatMain(Number(e.target.value))} placeholder="Hours" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-hltb-extra">{t("edit.label.hltbExtra")}</label>
                        <input id="edit-hltb-extra" className="edit-input" type="number" min={0} value={editTimeToBeatExtra || ""} onChange={(e) => setEditTimeToBeatExtra(Number(e.target.value))} placeholder="Hours" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-hltb-comple">{t("edit.label.hltbComple")}</label>
                        <input id="edit-hltb-comple" className="edit-input" type="number" min={0} value={editTimeToBeatComple || ""} onChange={(e) => setEditTimeToBeatComple(Number(e.target.value))} placeholder="Hours" />
                      </div>
                    </div>
                  </div>

                  <div className="edit-subgroup">
                    <h5 className="edit-subgroup-title">{t("edit.catalog")}</h5>
                    <div className="edit-form-grid">
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-collection">{t("edit.label.series")}</label>
                        <input id="edit-collection" className="edit-input" type="text" value={editCollection} onChange={(e) => setEditCollection(e.target.value)} placeholder="Series or Collection" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-franchise">{t("edit.label.franchise")}</label>
                        <input id="edit-franchise" className="edit-input" type="text" value={editFranchise} onChange={(e) => setEditFranchise(e.target.value)} placeholder="Franchise name" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-game-category">{t("edit.label.gameType")}</label>
                        <input id="edit-game-category" className="edit-input" type="text" value={editGameCategory} onChange={(e) => setEditGameCategory(e.target.value)} placeholder="e.g. Main Game, Expansion, DLC" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-release-status">{t("edit.label.releaseStatus")}</label>
                        <input id="edit-release-status" className="edit-input" type="text" value={editReleaseStatus} onChange={(e) => setEditReleaseStatus(e.target.value)} placeholder="e.g. Released, Early Access" />
                      </div>
                    </div>
                    <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                      <label className="edit-label" htmlFor="edit-similar-games">{t("edit.label.similarGames")}</label>
                      <TagInput id="edit-similar-games" value={editSimilarGamesNames} onChange={setEditSimilarGamesNames} placeholder="Add a similar game, press Enter" ariaLabel="Similar Games" />
                    </div>
                    <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                      <label className="edit-label" htmlFor="edit-alternative-names">{t("edit.label.alternativeNames")}</label>
                      <TagInput id="edit-alternative-names" value={editAlternativeNames} onChange={setEditAlternativeNames} placeholder="Add an alias or alternative title, press Enter" ariaLabel="Alternative Names" />
                    </div>
                  </div>

                  <div className="edit-subgroup">
                    <h5 className="edit-subgroup-title">{t("edit.metadata")}</h5>
                    <div className="edit-form-grid">
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-metadata-source">{t("edit.label.metadataSource")}</label>
                        <input id="edit-metadata-source" className="edit-input" type="text" value={editMetadataSource} onChange={(e) => setEditMetadataSource(e.target.value)} placeholder="e.g., IGDB, Steam, LaunchBox" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-metadata-url">{t("edit.label.metadataUrl")}</label>
                        <input id="edit-metadata-url" className="edit-input" type="text" value={editMetadataUrl} onChange={(e) => setEditMetadataUrl(e.target.value)} placeholder="https://..." />
                      </div>
                    </div>
                  </div>

                  <div className="edit-subgroup">
                    <h5 className="edit-subgroup-title">{t("edit.structuredData")}</h5>
                    <div className="edit-field full-width">
                      <label className="edit-label">{t("edit.label.releases")}</label>
                      <ArrayEditor<ReleaseDateInfo>
                        value={editReleases}
                        onChange={setEditReleases}
                        createEmpty={() => ({ platform: "", dateStr: "", region: "" })}
                        addLabel="Add release"
                        emptyText="No release entries yet."
                        columns={[
                          { key: "platform", label: "Platform", placeholder: "PC", width: "40%" },
                          { key: "dateStr", label: "Date", placeholder: "YYYY-MM-DD", width: "30%" },
                          { key: "region", label: "Region", placeholder: "Worldwide", width: "30%" },
                        ]}
                      />
                    </div>
                    <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                      <label className="edit-label">{t("edit.label.supportedLanguages")}</label>
                      <ArrayEditor<LanguageSupportInfo>
                        value={editLanguageSupports}
                        onChange={setEditLanguageSupports}
                        createEmpty={() => ({ language: "", supportType: "" })}
                        addLabel="Add language"
                        emptyText="No languages yet."
                        columns={[
                          { key: "language", label: "Language", placeholder: "English", width: "55%" },
                          { key: "supportType", label: "Support", type: "select", options: LANGUAGE_SUPPORT_TYPES, width: "45%" },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}

          {editTab === "media" && (
            <div className="edit-form">
              <div className="edit-media-header-block">
                <h4 className="edit-modal-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  {t("edit.images")}
                </h4>
              </div>

              <div className="edit-images-grid">
                <EditImageSlot
                  label={t("edit.label.icon")}
                  subtitle={t("edit.label.sidebar")}
                  imageUrl={editIcon}
                  previewSize={{ w: 64, h: 64 }}
                  transparent
                  isFetching={false}
                  onChooseFile={() => handlePickImage("icon")}
                  onFetchWeb={() => handleFetchImage("icon")}
                  onRemove={() => handleRemoveImage("icon")}
                />
                <EditImageSlot
                  label={t("edit.label.cover")}
                  subtitle={t("edit.label.libraryCards")}
                  imageUrl={editCover}
                  previewSize={{ w: 120, h: 160 }}
                  isFetching={false}
                  onChooseFile={() => handlePickImage("cover")}
                  onFetchWeb={() => handleFetchImage("cover")}
                  onRemove={() => handleRemoveImage("cover")}
                />
                <EditImageSlot
                  label={t("edit.label.hero")}
                  subtitle={t("edit.label.gamePageTop")}
                  imageUrl={editHero}
                  previewSize={{ w: 240, h: 100 }}
                  isFetching={false}
                  onChooseFile={() => handlePickImage("hero")}
                  onFetchWeb={() => handleFetchImage("hero")}
                  onRemove={() => handleRemoveImage("hero")}
                />
                <EditImageSlot
                  label={t("edit.label.logo")}
                  subtitle={t("edit.label.titleImage")}
                  imageUrl={editLogo}
                  previewSize={{ w: 200, h: 60 }}
                  transparent
                  isFetching={false}
                  onChooseFile={() => handlePickImage("logo")}
                  onFetchWeb={() => handleFetchImage("logo")}
                  onRemove={() => handleRemoveImage("logo")}
                />
              </div>

              <UrlListEditor
                title="Screenshots"
                items={editScreenshots}
                onChange={setEditScreenshots}
                placeholder="Add custom screenshot URL..."
                emptyText="No screenshots added yet."
                primaryActions={(url) => (
                  <>
                    <button
                      type="button"
                      className="lb-apply-btn"
                      onClick={() => handleApplyIgdbImage(url, "cover")}
                      disabled={fetchingImageKey !== null}
                    >
                      {t("edit.setAsCover")}
                    </button>
                    <button
                      type="button"
                      className="lb-apply-btn"
                      onClick={() => handleApplyIgdbImage(url, "hero")}
                      disabled={fetchingImageKey !== null}
                    >
                      {t("edit.setAsHero")}
                    </button>
                  </>
                )}
              />

              <UrlListEditor
                title="Videos & Trailers"
                items={editVideos}
                onChange={setEditVideos}
                placeholder="Add custom YouTube video URL..."
                emptyText="No trailers or videos added yet."
                thumbnail={(url) => {
                  const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1];
                  return videoId ? `https://img.youtube.com/vi/${videoId}/default.jpg` : undefined;
                }}
              />

              <UrlListEditor
                title="Websites & Links"
                items={editWebsites}
                onChange={setEditWebsites}
                placeholder="Add official website, wiki, or community URL..."
                emptyText="No official links added yet."
              />
            </div>
          )}          {/* ── LAUNCH SUBTAB ── */}
          {editTab === "launch" && (
            <div className="edit-form edit-launch-form">
              {/* Primary Executable Card */}
              <div className="edit-launch-card">
                <div className="edit-launch-card-header">
                  <div className="edit-launch-card-icon edit-launch-icon-primary">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                  <div className="edit-launch-card-header-text">
                    <h4 className="edit-launch-card-title">{t("edit.label.executablePath")}</h4>
                    <p className="edit-launch-card-desc">The primary binary or launcher script executed when starting the game.</p>
                  </div>
                </div>
                <div className="edit-launch-input-row">
                  <div className="edit-launch-input-wrapper">
                    <input
                      id="edit-path"
                      className="edit-input edit-launch-path-input"
                      type="text"
                      value={editPath}
                      onChange={(e) => setEditPath(e.target.value)}
                      placeholder="e.g. C:\Games\Title\game.exe or relative executable path"
                    />
                    {editPath && (
                      <button
                        type="button"
                        className="edit-launch-input-clear"
                        onClick={() => setEditPath("")}
                        title="Clear executable path"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    onClick={handlePickExecutable}
                    leftIcon={
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    }
                  >
                    {t("edit.browse")}
                  </Button>
                </div>
              </div>

              {/* Launch Arguments & Flags Card */}
              <div className="edit-launch-card">
                <div className="edit-launch-card-header">
                  <div className="edit-launch-card-icon edit-launch-icon-args">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  </div>
                  <div className="edit-launch-card-header-text">
                    <h4 className="edit-launch-card-title">{t("edit.label.launchArguments")}</h4>
                    <p className="edit-launch-card-desc">{t("edit.launchArgsHint")}</p>
                  </div>
                </div>
                <div className="edit-launch-args-wrapper">
                  <span className="edit-launch-args-prefix">&gt;</span>
                  <input
                    id="edit-launch-arguments"
                    className="edit-input edit-launch-args-input"
                    type="text"
                    value={editLaunchArguments}
                    onChange={(e) => setEditLaunchArguments(e.target.value)}
                    placeholder="-windowed -novid -dx11"
                  />
                  {editLaunchArguments && (
                    <button
                      type="button"
                      className="edit-launch-input-clear"
                      onClick={() => setEditLaunchArguments("")}
                      title="Clear arguments"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Quick Argument Chips */}
                <div className="edit-launch-chips-section">
                  <span className="edit-launch-chips-title">Quick Presets:</span>
                  <div className="edit-launch-arg-chips">
                    {COMMON_LAUNCH_ARGS.map((arg) => {
                      const isActive = editLaunchArguments.includes(arg.label);
                      return (
                        <button
                          key={arg.label}
                          type="button"
                          className={`edit-launch-arg-chip ${isActive ? "active" : ""}`}
                          onClick={() => appendLaunchArg(arg.label)}
                          title={arg.desc}
                        >
                          <span className="edit-chip-dot" />
                          <span className="edit-chip-code">{arg.label}</span>
                          <span className="edit-chip-desc">{arg.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Execution Privileges & Steam Integration Grid */}
              <div className="edit-launch-grid-cards">
                {/* Run as Admin Card */}
                <div
                  className={`edit-launch-card edit-launch-toggle-card ${editRunAsAdmin ? "is-enabled" : ""}`}
                  onClick={() => setEditRunAsAdmin(!editRunAsAdmin)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setEditRunAsAdmin(!editRunAsAdmin); } }}
                >
                  <div className="edit-launch-toggle-main">
                    <div className="edit-launch-card-icon edit-launch-icon-admin">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </div>
                    <div className="edit-launch-toggle-text">
                      <div className="edit-launch-toggle-title-row">
                        <h4 className="edit-launch-card-title">{t("edit.runAsAdmin")}</h4>
                        <span className={`edit-launch-badge ${editRunAsAdmin ? "active" : "muted"}`}>
                          {editRunAsAdmin ? "Elevated" : "Normal"}
                        </span>
                      </div>
                      <p className="edit-launch-card-desc">{t("edit.runAsAdminHint")}</p>
                    </div>
                  </div>
                  <div className={`edit-toggle-switch ${editRunAsAdmin ? "active" : ""}`} aria-hidden="true">
                    <div className="edit-toggle-knob" />
                  </div>
                </div>

                {/* Do Not Track Game Card */}
                <div
                  className={`edit-launch-card edit-launch-toggle-card ${editUntracked ? "is-enabled" : ""}`}
                  onClick={() => setEditUntracked(!editUntracked)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setEditUntracked(!editUntracked); } }}
                >
                  <div className="edit-launch-toggle-main">
                    <div className="edit-launch-card-icon edit-launch-icon-track">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                        {editUntracked && <line x1="2" y1="2" x2="22" y2="22" />}
                      </svg>
                    </div>
                    <div className="edit-launch-toggle-text">
                      <div className="edit-launch-toggle-title-row">
                        <h4 className="edit-launch-card-title">{t("edit.doNotTrack")}</h4>
                        <span className={`edit-launch-badge ${editUntracked ? "active" : "muted"}`}>
                          {editUntracked ? t("edit.badgeUntracked") : t("edit.badgeTracked")}
                        </span>
                      </div>
                      <p className="edit-launch-card-desc">{t("edit.doNotTrackHint")}</p>
                    </div>
                  </div>
                  <div className={`edit-toggle-switch ${editUntracked ? "active" : ""}`} aria-hidden="true">
                    <div className="edit-toggle-knob" />
                  </div>
                </div>

                {/* Steam Launch Options (if Steam game) */}
                {game.platform === "Steam" && (
                  <div
                    className={`edit-launch-card edit-launch-toggle-card ${editShowSteamLaunchSelection ? "is-enabled" : ""}`}
                    onClick={() => setEditShowSteamLaunchSelection(!editShowSteamLaunchSelection)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setEditShowSteamLaunchSelection(!editShowSteamLaunchSelection); } }}
                  >
                    <div className="edit-launch-toggle-main">
                      <div className="edit-launch-card-icon edit-launch-icon-steam">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                          <path d="M12 2a10 10 0 0 0-10 9.68l5.48 2.26a3.17 3.17 0 0 1 1.78-.54c.2 0 .4.02.58.06l2.67-3.87A3.48 3.48 0 0 1 12 8.5a3.5 3.5 0 1 1 0 7 3.49 3.49 0 0 1-2.9-1.54l-3.92 1.62A4.2 4.2 0 0 0 9.25 18a4.25 4.25 0 1 0 2.75-7.46V10.5a3.5 3.5 0 0 1 0-7z" />
                        </svg>
                      </div>
                      <div className="edit-launch-toggle-text">
                        <div className="edit-launch-toggle-title-row">
                          <h4 className="edit-launch-card-title">{t("edit.showSteamLaunchSelection")}</h4>
                          <span className={`edit-launch-badge ${editShowSteamLaunchSelection ? "active" : "muted"}`}>
                            {editShowSteamLaunchSelection ? "Enabled" : "Auto"}
                          </span>
                        </div>
                        <p className="edit-launch-card-desc">{t("edit.showSteamLaunchSelectionHint")}</p>
                        {steamLaunchOptions && steamLaunchOptions.length >= 2 && (
                          <div className="edit-steam-options-badge">
                            <span className="edit-steam-options-count">{steamLaunchOptions.length} detected:</span>
                            <span className="edit-steam-options-list">{steamLaunchListLabel}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`edit-toggle-switch ${editShowSteamLaunchSelection ? "active" : ""}`} aria-hidden="true">
                      <div className="edit-toggle-knob" />
                    </div>
                  </div>
                )}
              </div>

              {/* Automation Scripts Card */}
              <div className="edit-launch-card">
                <div className="edit-launch-card-header">
                  <div className="edit-launch-card-icon edit-launch-icon-scripts">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                  </div>
                  <div className="edit-launch-card-header-text">
                    <h4 className="edit-launch-card-title">{t("edit.tab.scripts")}</h4>
                    <p className="edit-launch-card-desc">Execute custom commands before launching or after exiting the game.</p>
                  </div>
                </div>

                <div className="edit-launch-scripts-grid">
                  <LaunchScriptCard
                    type="pre"
                    label="Pre-Launch Script"
                    tag="Blocking"
                    hint="Runs synchronously before the game starts. Launch is aborted if this script exits with an error code."
                    value={editPreLaunchScript}
                    admin={editPreLaunchAdmin}
                    onPick={() => handlePickScript(setEditPreLaunchScript, "Select Pre-launch Script")}
                    onChange={setEditPreLaunchScript}
                    onAdminChange={setEditPreLaunchAdmin}
                  />
                  <LaunchScriptCard
                    type="post"
                    label="Post-Exit Script"
                    tag="Cleanup"
                    hint="Runs automatically after the game process terminates (success or crash) to handle cleanup or cloud syncing."
                    value={editPostExitScript}
                    admin={editPostExitAdmin}
                    onPick={() => handlePickScript(setEditPostExitScript, "Select Post-exit Script")}
                    onChange={setEditPostExitScript}
                    onAdminChange={setEditPostExitAdmin}
                  />
                </div>
              </div>

              {/* Companion Applications Card */}
              <div className="edit-launch-card">
                <div className="edit-launch-card-header">
                  <div className="edit-launch-card-icon edit-launch-icon-companion">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  </div>
                  <div className="edit-launch-card-header-text">
                    <div className="edit-launch-card-title-row">
                      <h4 className="edit-launch-card-title">{t("edit.tab.companionApps")}</h4>
                      <span className="edit-launch-card-counter">{editCompanionApps.length}</span>
                    </div>
                    <p className="edit-launch-card-desc">
                      Launch auxiliary software alongside the game (e.g. Dedicated Server, Discord RPC, RTSS, Overlay, Mod Organizer) with a configurable delay.
                    </p>
                  </div>
                </div>

                {editCompanionApps.length === 0 ? (
                  <div className="edit-companion-empty-state">
                    <div className="edit-companion-empty-icon">
                      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </div>
                    <p className="edit-companion-empty-text">{t("edit.noCompanionApps")}</p>
                    <button type="button" className="edit-companion-add-btn primary" onClick={addCompanionApp}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add Companion App
                    </button>
                  </div>
                ) : (
                  <div className="companion-app-list">
                    {editCompanionApps.map((app, idx) => (
                      <div key={idx} className="companion-app-card">
                        <div className="companion-app-card-header">
                          <span className="companion-app-index-badge">App #{idx + 1}</span>
                          <button
                            type="button"
                            className="companion-app-delete-btn"
                            onClick={() => removeCompanionApp(idx)}
                            title="Remove companion app"
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                        <div className="companion-app-path-row">
                          <input
                            className="edit-input edit-launch-path-input"
                            type="text"
                            value={app.path}
                            onChange={(e) => updateCompanionApp(idx, { path: e.target.value })}
                            placeholder="Path to executable (.exe, .bat, .lnk)"
                          />
                          <Button variant="secondary" size="sm" onClick={() => handlePickCompanion(idx)}>
                            {t("edit.browse")}
                          </Button>
                        </div>
                        <div className="companion-app-meta-row">
                          <div className="companion-app-arg-field">
                            <span className="companion-app-field-label">Arguments:</span>
                            <input
                              className="edit-input companion-app-args-input"
                              type="text"
                              value={app.arguments || ""}
                              onChange={(e) => updateCompanionApp(idx, { arguments: e.target.value })}
                              placeholder="e.g. -server -port 7777"
                            />
                          </div>
                          <div className="companion-app-delay-field">
                            <span className="companion-app-field-label">Delay:</span>
                            <div className="companion-app-delay-input-wrap">
                              <input
                                className="edit-input companion-app-delay-input"
                                type="number"
                                min={0}
                                step={500}
                                value={app.delayMs || 0}
                                onChange={(e) => updateCompanionApp(idx, { delayMs: Math.max(0, Number(e.target.value)) })}
                                aria-label="Delay before launch (ms)"
                              />
                              <span className="companion-app-delay-tag">ms</span>
                            </div>
                          </div>
                          <label className="companion-app-admin-toggle">
                            <input
                              type="checkbox"
                              checked={app.runAsAdmin || false}
                              onChange={(e) => updateCompanionApp(idx, { runAsAdmin: e.target.checked })}
                            />
                            <span className="companion-app-admin-label">
                              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                              </svg>
                              Admin
                            </span>
                          </label>
                        </div>
                      </div>
                    ))}
                    <button type="button" className="edit-companion-add-btn" onClick={addCompanionApp}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add Another Companion App
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {editTab === "details" && (t("edit.footerHint.details") || "Configure metadata, tags, and playtime")}
            {editTab === "media" && (t("edit.footerHint.media") || "Manage artworks, screenshots, and videos")}
            {editTab === "launch" && (t("edit.footerHint.launch") || "Setup execution paths, arguments, and scripts")}
          </span>
          <div className="modal-footer-actions">
            <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={saveEdits}>{t("edit.saveChanges")}</Button>
          </div>
        </div>
      </div>

      {mediaFetchSlot && (
        <MediaFetchBrowser
          slot={mediaFetchSlot}
          gameName={editName.trim() || game.name}
          steamAppId={game.steamAppId}
          onApply={(url) => handleApplyFetchedImage(url)}
          onClose={() => setMediaFetchSlot(null)}
        />
      )}
    </div>
  );
}

function LaunchScriptCard({
  type,
  label,
  tag,
  hint,
  value,
  admin,
  onChange,
  onAdminChange,
  onPick,
}: {
  type: "pre" | "post";
  label: string;
  tag: string;
  hint: string;
  value: string;
  admin: boolean;
  onChange: (path: string) => void;
  onAdminChange: (admin: boolean) => void;
  onPick: () => void;
}) {
  return (
    <div className={`edit-launch-script-box ${type === "pre" ? "is-pre" : "is-post"}`}>
      <div className="edit-launch-script-header">
        <div className="edit-launch-script-title-row">
          <span className="edit-launch-script-label">{label}</span>
          <span className={`edit-launch-script-tag ${type === "pre" ? "tag-warning" : "tag-info"}`}>
            {tag}
          </span>
        </div>
        <p className="edit-launch-script-hint">{hint}</p>
      </div>

      <div className="edit-launch-input-row">
        <div className="edit-launch-input-wrapper">
          <input
            className="edit-input edit-launch-path-input"
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Path to script (.bat, .cmd, .ps1, .exe)"
          />
          {value && (
            <button
              type="button"
              className="edit-launch-input-clear"
              onClick={() => onChange("")}
              title="Clear script path"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={onPick}>
          Browse...
        </Button>
      </div>

      <div className="edit-launch-script-footer">
        <label className="edit-launch-script-admin">
          <input
            type="checkbox"
            checked={admin}
            onChange={(e) => onAdminChange(e.target.checked)}
          />
          <span className="edit-launch-script-admin-text">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Run with Administrator Privileges
          </span>
        </label>
        {value && (
          <span className="edit-launch-script-status">
            Configured
          </span>
        )}
      </div>
    </div>
  );
}
