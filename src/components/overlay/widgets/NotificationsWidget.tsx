import { useMemo } from "react";
import { Bell, Download, Trophy } from "lucide-react";
import { useAchievements } from "../../../context/AchievementContext";
import { useDownloads } from "../../../context/DownloadContext";
import { useLanguage } from "../../../context/LanguageContext";
import { Badge, Card } from "../../ui";

/** A notification-worthy event surfaced from an existing store. */
export interface OverlayNotification {
  id: string;
  kind: "achievement" | "download";
  name: string;
}

/**
 * Derives the overlay's notification feed from stores the reduced provider
 * tree already mounts: recent achievement unlocks and completed downloads.
 * No new persistence — this is a read-only projection.
 */
export function useOverlayNotifications(): OverlayNotification[] {
  const { recentUnlocks } = useAchievements();
  const { completedDownloads } = useDownloads();

  return useMemo(() => {
    const items: OverlayNotification[] = [];
    for (const record of recentUnlocks.slice(0, 6)) {
      items.push({
        id: `achievement:${record.gameId}:${record.achievement.apiName}`,
        kind: "achievement",
        name: record.achievement.displayName,
      });
    }
    for (const download of completedDownloads.slice(0, 6)) {
      items.push({ id: `download:${download.id}`, kind: "download", name: download.name });
    }
    return items;
  }, [recentUnlocks, completedDownloads]);
}

/** Notification feed for the expanded overlay panel. */
export default function NotificationsWidget() {
  const notifications = useOverlayNotifications();
  const { t } = useLanguage();

  return (
    <Card variant="glass" className="overlay-widget">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <Bell />
        </span>
        <h3 className="overlay-widget__title">
          {t("overlay.widget.notifications")}
        </h3>
        {notifications.length > 0 && (
          <Badge variant="warning">{notifications.length}</Badge>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="overlay-widget__empty">{t("overlay.notifications.empty")}</p>
      ) : (
        <ul className="overlay-list">
          {notifications.slice(0, 4).map((item) => (
            <li key={item.id} className="overlay-list__row">
              <span className="overlay-list__icon" aria-hidden>
                {item.kind === "achievement" ? <Trophy /> : <Download />}
              </span>
              <span className="overlay-list__name">
                {item.kind === "achievement"
                  ? t("overlay.notifications.unlocked", { name: item.name })
                  : t("overlay.notifications.downloadDone", { name: item.name })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
