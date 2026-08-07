// ActivityTab — unified timeline across sessions, recommendations,
// wishlist shares, new friends and recent achievement unlocks.

import { useLanguage } from "../../../context/LanguageContext";
import type { ActivityItem, UseFriendsSocialResult } from "../../../hooks/useFriendsSocial";
import { formatLastSeen, Icons } from "./friendsUtils";

export default function ActivityTab({ social }: { social: UseFriendsSocialResult }) {
  const { t } = useLanguage();
  const { activityFeed } = social;

  return (
    <div className="bigscreen-friends-activity">
      <div className="bigscreen-friends-section-head">
        <h3>{t("friendsPage.activityFeedTitle")}</h3>
        <span className="bigscreen-friends-section-hint">{t("friendsPage.activityFeedSubtitle")}</span>
      </div>

      {activityFeed.length === 0 ? (
        <div className="system-view-empty">
          <p>{t("friendsPage.activityFeedEmpty")}</p>
          <p>{t("friendsPage.activityFeedEmptyDesc")}</p>
        </div>
      ) : (
        <div className="bigscreen-activity-list">
          {activityFeed.map((item) => (
            <ActivityRow key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { t } = useLanguage();
  return (
    <div className={`bigscreen-activity-item kind-${item.kind}`}>
      <span className="bigscreen-activity-icon" aria-hidden>
        {item.kind === "session" ? (
          Icons.calendar()
        ) : item.kind === "rec" ? (
          Icons.star(true)
        ) : item.kind === "suggestion" ? (
          Icons.heart()
        ) : item.kind === "friend" ? (
          Icons.users()
        ) : (
          Icons.trophy()
        )}
      </span>
      <div className="bigscreen-activity-body">
        <div className="bigscreen-activity-title">{item.title}</div>
        {item.detail && <div className="bigscreen-activity-detail">{item.detail}</div>}
      </div>
      <span className="bigscreen-activity-time" title={new Date(item.timestamp).toLocaleString()}>
        {formatLastSeen(Math.floor(item.timestamp / 1000), t)}
      </span>
    </div>
  );
}
