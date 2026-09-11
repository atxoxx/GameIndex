import { useMemo } from "react";
import { Copy, FolderOpen, Link2, Pause, Play, Sprout, Trash2, XCircle } from "lucide-react";
import { useDownloads } from "../../context/DownloadContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { copyTextToClipboard } from "../../utils/clipboard";
import { isActiveStatus, type TorrentDownload } from "../../types/download";
import type { Game } from "../../types/game";
import type { ContextMenuItem } from "../ui/ContextMenu";

interface DownloadMenuOptions {
  matchedGame?: Game | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteFiles: (download: TorrentDownload) => void;
}

/** Shared right-click item list for download rows and grid cards. */
export function useDownloadMenuItems(
  download: TorrentDownload,
  { matchedGame, onPause, onResume, onRemove, onDeleteFiles }: DownloadMenuOptions
): ContextMenuItem[] {
  const { launchGame } = useGames();
  const { openDownloadFolder, setSeeding } = useDownloads();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const isPaused = download.status.kind === "paused";
  const isSeeding = download.status.kind === "seeding";
  const isCompleted = download.status.kind === "completed";
  const isPlayable = isCompleted && Boolean(matchedGame?.installed);
  const canPause = isActiveStatus(download.status) && !isSeeding;
  const sourceLink =
    download.magnetUri || download.sourceUri || (download.uris && download.uris[0]) || "";

  return useMemo(() => {
    const copy = async (text: string) => {
      const copied = await copyTextToClipboard(text);
      showToast(
        copied ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
        copied ? "success" : "error"
      );
    };

    const launch = async () => {
      if (!matchedGame) return;
      try {
        await launchGame(matchedGame);
      } catch (err) {
        showToast(t("gameContext.launchFailed", { error: String(err) }), "error");
      }
    };

    const raw: (ContextMenuItem | null)[] = [
      isPlayable
        ? {
            id: "play",
            label: t("game.play"),
            icon: <Play size={15} />,
            accent: true,
            onSelect: launch,
          }
        : null,
      isPaused
        ? {
            id: "resume",
            label: t("downloadRow.resume"),
            icon: <Play size={15} />,
            onSelect: () => onResume(download.id),
          }
        : null,
      canPause
        ? {
            id: "pause",
            label: t("downloadRow.pause"),
            icon: <Pause size={15} />,
            onSelect: () => onPause(download.id),
          }
        : null,
      isSeeding
        ? {
            id: "stop-seeding",
            label: t("downloadRow.stopSeeding"),
            icon: <Sprout size={15} />,
            onSelect: () =>
              setSeeding(download.id, false).catch((err) =>
                showToast(t("downloadRow.stopSeedingFailed", { error: String(err) }), "error")
              ),
          }
        : null,
      {
        id: "open-folder",
        label: t("downloadRow.openFolder"),
        icon: <FolderOpen size={15} />,
        onSelect: () =>
          openDownloadFolder(download.id).catch((err) =>
            showToast(t("downloadRow.openFolderFailed", { error: String(err) }), "error")
          ),
      },
      { id: "sep-1", separator: true },
      {
        id: "copy-name",
        label: t("gameMenu.copyName"),
        icon: <Copy size={15} />,
        onSelect: () => copy(download.name),
      },
      sourceLink
        ? {
            id: "copy-link",
            label: t("deals.copyLink"),
            icon: <Link2 size={15} />,
            onSelect: () => copy(sourceLink),
          }
        : null,
      { id: "sep-2", separator: true },
      {
        id: "remove",
        label: t("common.remove"),
        icon: <Trash2 size={15} />,
        danger: true,
        onSelect: () => onRemove(download.id),
      },
      {
        id: "delete-files",
        label: t("downloadRow.deleteFromDisk"),
        icon: <XCircle size={15} />,
        danger: true,
        onSelect: () => onDeleteFiles(download),
      },
    ];
    return raw.filter((item): item is ContextMenuItem => item !== null);
  }, [
    canPause,
    download,
    isPaused,
    isPlayable,
    isSeeding,
    launchGame,
    matchedGame,
    onDeleteFiles,
    onPause,
    onRemove,
    onResume,
    openDownloadFolder,
    setSeeding,
    showToast,
    sourceLink,
    t,
  ]);
}
