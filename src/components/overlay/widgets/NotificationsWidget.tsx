import { useMemo } from "react";
import { Bell, Download, Trophy } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Badge, Card } from "../../ui";
import { useOverlayNotifications } from "../overlayNotifications";
import type { OverlayWidgetProps } from "./types";

/** Notification feed for the expanded overlay panel. */
export default function NotificationsWidget({ bare = false }: OverlayWidgetProps) {
  const { items, unread, markAllSeen } = useOverlayNotifications();
  const { t } = useLanguage();

  const unreadIds = useMemo(
    () => new Set(unread.map((item) => item.id)),
    [unread],
  );

  return (
    <Card variant="glass" className="overlay-widget">
      {!bare ? (
        <div className="overlay-widget__head">
          <span className="overlay-widget__icon" aria-hidden>
            <Bell />
          </span>
          <h3 className="overlay-widget__title">
            {t("overlay.widget.notifications")}
          </h3>
          {unread.length > 0 && (
            <Badge variant="warning">{unread.length}</Badge>
          )}
        </div>
      ) : (
        unread.length > 0 && (
          <div className="overlay-notifications__toolbar">
            <span className="overlay-notifications__count">
              {t("overlay.notifications.unread", { count: unread.length })}
            </span>
            <button
              type="button"
              className="overlay-notifications__mark"
              onClick={markAllSeen}
            >
              {t("overlay.notifications.markAllRead")}
            </button>
          </div>
        )
      )}

      {items.length === 0 ? (
        <p className="overlay-widget__empty">{t("overlay.notifications.empty")}</p>
      ) : (
        <ul className="overlay-list">
          {items.map((item) => (
            <li
              key={item.id}
              className={`overlay-list__row${
                unreadIds.has(item.id) ? " overlay-list__row--unread" : ""
              }`}
            >
              <span className="overlay-list__icon" aria-hidden>
                {item.kind === "achievement" ? <Trophy /> : <Download />}
              </span>
              <span className="overlay-list__name">
                {item.kind === "achievement"
                  ? t("overlay.notifications.unlocked", { name: item.name })
                  : t("overlay.notifications.downloadDone", { name: item.name })}
              </span>
              {unreadIds.has(item.id) && (
                <span
                  className="overlay-notifications__dot"
                  aria-label={t("overlay.notifications.new")}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
