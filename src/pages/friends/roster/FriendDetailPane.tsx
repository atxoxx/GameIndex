import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  CalendarPlus,
  ChevronRight,
  Clock,
  Gamepad2,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Star,
  Swords,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { Friend, FriendCircle, GameSession } from "../friendsTypes";
import {
  displayName,
  formatFriendsSince,
  formatHours,
  formatLastSeen,
  presenceLabel,
  safeCurrentlyPlaying,
} from "../friendsUtils";
import { FriendAvatar } from "../shared/FriendAvatar";

interface FriendDetailPaneProps {
  friend: Friend;
  circles: FriendCircle[];
  myGameIds: Set<string>;
  sessions: GameSession[];
  onBack: () => void;
  onMessage: () => void;
  onInvite: () => void;
  onCompare: () => void;
  onTogglePin: () => void;
  onEditNickname: () => void;
  onToggleBlock: () => void;
  onDelete: () => void;
  onOpenCircles: () => void;
  onOpenSession: () => void;
}

export function FriendDetailPane({
  friend,
  circles,
  myGameIds,
  sessions,
  onBack,
  onMessage,
  onInvite,
  onCompare,
  onTogglePin,
  onEditNickname,
  onToggleBlock,
  onDelete,
  onOpenCircles,
  onOpenSession,
}: FriendDetailPaneProps) {
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuWrapRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const name = displayName(friend);
  const playing = safeCurrentlyPlaying(friend.currentlyPlaying);
  const memberCircles = (friend.groups || [])
    .map((id) => circles.find((circle) => circle.id === id))
    .filter((circle): circle is FriendCircle => !!circle);

  const sharedGamesAll = useMemo(() => {
    return (friend.games || [])
      .filter((game) => myGameIds.has(game.id))
      .sort((a, b) => b.playTimeMin - a.playTimeMin);
  }, [friend.games, myGameIds]);
  const sharedGames = sharedGamesAll.slice(0, 6);

  const nextSession = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter((session) => {
        if (session.deleted) return false;
        const time = new Date(session.scheduledAt).getTime();
        if (Number.isNaN(time) || time <= now) return false;
        return (
          session.creatorName === friend.name ||
          session.invited?.includes(friend.name) ||
          session.attendees?.includes(friend.name) ||
          session.rsvps?.[friend.name] === "going"
        );
      })
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  }, [sessions, friend.name]);

  const stats = friend.libStats || { gamesCount: 0, playtimeMinutes: 0, achievementsCount: 0 };

  return (
    <section className="friend-detail" aria-label={t("friendsPage.friendDetail", { name })}>
      <button type="button" className="friend-detail__back" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        {t("friendsPage.backToFriends")}
      </button>

      <header className="friend-detail__hero">
        <FriendAvatar friend={friend} size="xl" />
        <div className="friend-detail__identity">
          <span className="friend-detail__eyebrow">
            {playing ? t("friendsPage.playingNow") : presenceLabel(friend, t) || t("friendsPage.offline")}
          </span>
          <h2>{name}</h2>
          <span className="friend-detail__alias">@{friend.name}</span>
          <div className="friend-detail__meta">
            {playing && (
              <span className="friend-detail__playing">
                <Gamepad2 size={13} aria-hidden="true" />
                {playing}
              </span>
            )}
            {friend.region && (
              <span>
                <MapPin size={12} aria-hidden="true" />
                {friend.region}
              </span>
            )}
            <span>
              <Clock size={12} aria-hidden="true" />
              {formatLastSeen(friend.lastSeen, t)}
            </span>
          </div>
        </div>

        <div className="friend-detail__actions">
          <button type="button" className="friend-detail__action is-primary" onClick={onMessage}>
            <MessageCircle size={15} aria-hidden="true" />
            {t("friends.message")}
          </button>
          <button type="button" className="friend-detail__action" onClick={onInvite}>
            <CalendarPlus size={15} aria-hidden="true" />
            {t("friends.invite")}
          </button>
          <button type="button" className="friend-detail__action" onClick={onCompare}>
            <Swords size={15} aria-hidden="true" />
            {t("friends.compare")}
          </button>
          <div className="friend-detail__menu-wrap" ref={menuWrapRef}>
            <button
              type="button"
              className="friend-detail__icon-action"
              onClick={() => setMenuOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("friendsPage.actions")}
              title={t("friendsPage.actions")}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="friends-menu friends-menu--detail" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onTogglePin(); }}>
                  {friend.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
                  {friend.pinned ? t("friends.unpin") : t("friendsPage.pinToTop")}
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEditNickname(); }}>
                  <Pencil size={14} aria-hidden="true" />
                  {t("friendsPage.setNickname")}
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onToggleBlock(); }}>
                  <Ban size={14} aria-hidden="true" />
                  {friend.blocked ? t("friendsPage.unblock") : t("friendsPage.blockIgnore")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {t("friendsPage.removeFriendTitle", { name })}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {friend.blocked && (
        <div className="friend-detail__banner">
          <Ban size={14} aria-hidden="true" />
          {t("friendsPage.blockedBanner")}
          <button type="button" onClick={onToggleBlock}>
            {t("friendsPage.unblock")}
          </button>
        </div>
      )}

      {friend.bio && <p className="friend-detail__bio">{friend.bio}</p>}

      <div className="friend-detail__facts">
        <div>
          <span>{t("friendsPage.gamesOwned")}</span>
          <strong>{stats.gamesCount}</strong>
        </div>
        <div>
          <span>{t("friendsPage.totalPlaytime")}</span>
          <strong>{formatHours(stats.playtimeMinutes, t)}</strong>
        </div>
        <div>
          <span>{t("friendsPage.totalAchievements")}</span>
          <strong>{stats.achievementsCount}</strong>
        </div>
        <div>
          <span>{t("friendsPage.sharedGames")}</span>
          <strong>{sharedGamesAll.length}</strong>
        </div>
      </div>

      <div className="friend-detail__grid">
        <section className="friend-detail__section">
          <header>
            <h3>
              <Gamepad2 size={14} aria-hidden="true" />
              {t("friendsPage.sharedLibrary")}
            </h3>
            <button type="button" onClick={onCompare}>
              {t("friendsPage.openCompare")}
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          </header>
          {sharedGames.length === 0 ? (
            <p className="friend-detail__empty">{t("friendsPage.noSharedGames")}</p>
          ) : (
            <ul className="friend-detail__games">
              {sharedGames.map((game) => (
                <li key={game.id}>
                  <span className="friend-detail__game-mark" aria-hidden="true">
                    {game.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="friend-detail__game-main">
                    <span className="friend-detail__game-name">{game.name}</span>
                    <span className="friend-detail__game-meta">
                      {formatHours(game.playTimeMin, t)} · {game.achievementPercent}% {t("friendsPage.achievements")}
                    </span>
                    <span className="friend-detail__game-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(0, Math.min(100, game.achievementPercent))}%` }} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="friend-detail__side">
          <section className="friend-detail__section">
            <header>
              <h3>
                <CalendarPlus size={14} aria-hidden="true" />
                {t("friendsPage.nextTogether")}
              </h3>
              {nextSession && (
                <button type="button" onClick={onOpenSession}>
                  {t("friendsPage.viewSession")}
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              )}
            </header>
            {nextSession ? (
              <button type="button" className="friend-detail__next-session" onClick={onOpenSession}>
                <span className="friend-detail__next-date">
                  {new Date(nextSession.scheduledAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                  {" · "}
                  {new Date(nextSession.scheduledAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
                <strong>{nextSession.gameName}</strong>
                <span>{nextSession.creatorName}</span>
              </button>
            ) : (
              <p className="friend-detail__empty">{t("friendsPage.noSessionTogether")}</p>
            )}
          </section>

          <section className="friend-detail__section">
            <header>
              <h3>
                <Tag size={14} aria-hidden="true" />
                {t("friendsPage.circles")}
              </h3>
              <button type="button" onClick={onOpenCircles}>
                {t("friendsPage.manageCircles")}
                <ChevronRight size={13} aria-hidden="true" />
              </button>
            </header>
            {memberCircles.length === 0 ? (
              <p className="friend-detail__empty">{t("friendsPage.noCircles")}</p>
            ) : (
              <div className="friend-detail__circles">
                {memberCircles.map((circle) => (
                  <span key={circle.id} className="friend-detail__circle">
                    <span style={{ background: circle.color || "var(--color-accent)" }} aria-hidden="true" />
                    {circle.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="friend-detail__section">
            <header>
              <h3>
                <Users size={14} aria-hidden="true" />
                {t("friendsPage.friendship")}
              </h3>
            </header>
            <dl className="friend-detail__dl">
              <div>
                <dt>{t("friendsPage.friendsSince")}</dt>
                <dd>{formatFriendsSince(friend.addedAt, t)}</dd>
              </div>
              <div>
                <dt>{t("friendsPage.favoriteGameLabel")}</dt>
                <dd>
                  <Star size={12} aria-hidden="true" />
                  {friend.favoriteGame || t("friendsPage.notSet")}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </section>
  );
}

export default FriendDetailPane;
