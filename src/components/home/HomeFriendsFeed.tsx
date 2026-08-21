import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import {
  type Friend,
  loadFriends,
  displayName,
  safeCurrentlyPlaying,
} from "../../pages/friendsStorage";
import HomeSection from "./HomeSection";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function HomeFriendsFeed() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [friends] = useState<Friend[]>(() => loadFriends());

  const playingFriends = useMemo(() => {
    return friends.filter((f) => safeCurrentlyPlaying(f.currentlyPlaying));
  }, [friends]);

  const activeDisplay = useMemo(() => {
    if (playingFriends.length > 0) return playingFriends.slice(0, 4);
    // If nobody playing, show up to 3 online / available friends
    return friends.slice(0, 3);
  }, [friends, playingFriends]);

  if (friends.length === 0) return null;

  return (
    <HomeSection
      className="home-friends-feed"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      }
      title={t("home.friends.title")}
      subtitle={
        playingFriends.length > 0
          ? t("home.friends.subtitle", { count: playingFriends.length })
          : undefined
      }
      viewAllPath="/friends"
    >
      {activeDisplay.length === 0 ? (
        <div className="home-friends-feed__empty">
          <span>{t("home.friends.empty")}</span>
        </div>
      ) : (
        <div className="home-friends-feed__list">
          {activeDisplay.map((friend) => {
            const name = displayName(friend);
            const playing = safeCurrentlyPlaying(friend.currentlyPlaying);
            return (
              <div
                key={friend.id}
                className="home-friends-feed__item"
                onClick={() => navigate("/friends")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate("/friends")}
              >
                <div className="home-friends-feed__avatar-wrap">
                  {friend.avatar && friend.avatar !== "procedural" ? (
                    <img className="home-friends-feed__avatar" src={friend.avatar} alt={name} />
                  ) : (
                    <span className="home-friends-feed__avatar home-friends-feed__avatar--initials">
                      {initials(name)}
                    </span>
                  )}
                  <span
                    className={`home-friends-feed__status-dot${
                      playing ? " is-playing" : " is-online"
                    }`}
                    aria-hidden
                  />
                </div>

                <div className="home-friends-feed__info">
                  <span className="home-friends-feed__name" title={name}>
                    {name}
                  </span>
                  <span className="home-friends-feed__status" title={playing ?? friend.status}>
                    {playing ? (
                      <span className="home-friends-feed__playing-game">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden>
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        {playing}
                      </span>
                    ) : (
                      friend.status || t("home.friends.online")
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </HomeSection>
  );
}
