import { useState, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Friend, FriendCircle, FriendInvitation } from "./friendsTypes";
import FriendCard from "./FriendCard";
import {
  displayName,
  isOnline,
  safeCurrentlyPlaying,
  UsersIcon,
  PlusIcon,
  GamepadIcon,
  CheckIcon,
  XIcon,
  PinIcon,
  BlockIcon,
  TrashIcon,
  TagIcon,
} from "./friendsUtils";

interface FriendsListTabProps {
  friends: Friend[];
  circles: FriendCircle[];
  invitations: FriendInvitation[];
  myGameIds: Set<string>;
  onOpenAddModal: () => void;
  onOpenCirclesModal: () => void;
  onAcceptInvitation: (invite: FriendInvitation) => void;
  onDenyInvitation: (syncId: string) => void;
  onCompareFriend: (friend: Friend) => void;
  onInviteFriend: (friend: Friend) => void;
  onMessageFriend: (friend: Friend) => void;
  onTogglePin: (friendId: string) => void;
  onEditNickname: (friend: Friend) => void;
  onToggleBlock: (friendId: string, friendName: string) => void;
  onDeleteFriend: (friendId: string, friendName: string) => void;
  onBulkPin: (friendIds: string[]) => void;
  onBulkUnpin: (friendIds: string[]) => void;
  onBulkBlock: (friendIds: string[]) => void;
  onBulkRemove: (friendIds: string[]) => void;
}

export default function FriendsListTab({
  friends,
  circles,
  invitations,
  myGameIds,
  onOpenAddModal,
  onOpenCirclesModal,
  onAcceptInvitation,
  onDenyInvitation,
  onCompareFriend,
  onInviteFriend,
  onMessageFriend,
  onTogglePin,
  onEditNickname,
  onToggleBlock,
  onDeleteFriend,
  onBulkPin,
  onBulkUnpin,
  onBulkBlock,
  onBulkRemove,
}: FriendsListTabProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterState, setFilterState] = useState<"all" | "online" | "ingame" | "pinned" | "blocked">("all");
  const [sortOption, setSortOption] = useState<"default" | "name" | "recent" | "online">("default");
  const [selectedCircleId, setSelectedCircleId] = useState<string>("all");
  const [density, setDensity] = useState<"grid" | "list">("grid");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Playing now rail: friends currently in game
  const playingNowFriends = useMemo(() => {
    return friends.filter((f) => !f.blocked && !!safeCurrentlyPlaying(f.currentlyPlaying));
  }, [friends]);

  // Filter and sort friends
  const filteredFriends = useMemo(() => {
    let list = [...friends];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((f) => {
        const name = displayName(f).toLowerCase();
        const rawName = f.name.toLowerCase();
        const fav = (f.favoriteGame || "").toLowerCase();
        const curr = (safeCurrentlyPlaying(f.currentlyPlaying) || "").toLowerCase();
        return name.includes(q) || rawName.includes(q) || fav.includes(q) || curr.includes(q);
      });
    }

    if (selectedCircleId !== "all") {
      list = list.filter((f) => (f.groups || []).includes(selectedCircleId));
    }

    if (filterState === "online") {
      list = list.filter((f) => isOnline(f) && !f.blocked);
    } else if (filterState === "ingame") {
      list = list.filter((f) => !!safeCurrentlyPlaying(f.currentlyPlaying) && !f.blocked);
    } else if (filterState === "pinned") {
      list = list.filter((f) => f.pinned);
    } else if (filterState === "blocked") {
      list = list.filter((f) => f.blocked);
    } else {
      // By default in 'all' view, don't mix blocked users with active friends unless 'blocked' tab chosen
      list = list.filter((f) => !f.blocked);
    }

    list.sort((a, b) => {
      if (sortOption === "name") {
        return displayName(a).localeCompare(displayName(b));
      }
      if (sortOption === "recent") {
        return (b.addedAt || 0) - (a.addedAt || 0);
      }
      if (sortOption === "online") {
        const ao = isOnline(a) ? 1 : 0;
        const bo = isOnline(b) ? 1 : 0;
        if (bo !== ao) return bo - ao;
        return (b.addedAt || 0) - (a.addedAt || 0);
      }
      // default: pinned first, then most recently added
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return (b.addedAt || 0) - (a.addedAt || 0);
    });

    return list;
  }, [friends, searchQuery, filterState, sortOption, selectedCircleId]);

  const toggleSelectFriend = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredFriends.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredFriends.map((f) => f.id));
    }
  };

  return (
    <div className="friends-list-section">
      {/* Pending Friend Invitations Banner */}
      {invitations.length > 0 && (
        <div className="friend-invitations-section">
          <div className="friend-invitations-head">
            <h3 className="friend-invitations-title">
              <UsersIcon /> {t("friendsPage.pendingInvitations", { count: invitations.length })}
            </h3>
          </div>
          <div className="friend-invitations-grid">
            {invitations.map((invite) => (
              <div key={invite.syncId} className="friend-invitation-card">
                <div className="friend-invitation-info">
                  <div className="friend-invitation-avatar">
                    {invite.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <span className="friend-invitation-name">{invite.name}</span>
                    <span className="friend-invitation-status">{invite.status || t("friendsPage.formatOnline")}</span>
                    {invite.favoriteGame && (
                      <span className="friend-invitation-game">
                        {t("friendsPage.favoriteGame", { game: invite.favoriteGame })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="friend-invitation-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn--mini"
                    onClick={() => onAcceptInvitation(invite)}
                    title={t("friendsPage.acceptInvite")}
                  >
                    <CheckIcon /> {t("friendsPage.accept")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn--mini danger"
                    onClick={() => onDenyInvitation(invite.syncId)}
                    title={t("friendsPage.denyInvite")}
                  >
                    <XIcon /> {t("friendsPage.deny")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Playing Now Hero Rail */}
      {playingNowFriends.length > 0 && (
        <div className="playing-now-rail">
          <div className="playing-now-rail-header">
            <GamepadIcon />
            <span>{t("friendsPage.friendsPlayingNow", { count: playingNowFriends.length })}</span>
          </div>
          <div className="playing-now-rail-scroll">
            {playingNowFriends.map((f) => {
              const playingGame = safeCurrentlyPlaying(f.currentlyPlaying);
              return (
                <div
                  key={f.id}
                  className="playing-now-pill"
                  onClick={() => onCompareFriend(f)}
                  title={t("friendsPage.playingGame", { game: playingGame || "" })}
                >
                  <div className="playing-now-avatar">{f.name.slice(0, 2).toUpperCase()}</div>
                  <div className="playing-now-meta">
                    <span className="playing-now-name">{displayName(f)}</span>
                    <span className="playing-now-game">{playingGame}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toolbar / Search / Filters / Actions */}
      <div className="friends-list-toolbar">
        <div className="friends-list-search-wrapper">
          <input
            type="text"
            className="friends-search-input"
            placeholder={t("friends.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="friends-search-clear"
              onClick={() => setSearchQuery("")}
              title={t("common.clear")}
            >
              ×
            </button>
          )}
        </div>

        <div className="friends-list-filters">
          <div className="friends-sort-wrapper">
            <select
              className="friends-sort-select"
              value={filterState}
              onChange={(e) => setFilterState(e.target.value as any)}
              aria-label={t("library.filter.status")}
            >
              <option value="all">{t("friends.all")}</option>
              <option value="online">{t("friendsPage.onlineNow")}</option>
              <option value="ingame">{t("friendsPage.inGame")}</option>
              <option value="pinned">{t("friends.pinned")}</option>
              <option value="blocked">{t("friendsPage.blocked")}</option>
            </select>
          </div>

          <div className="friends-sort-wrapper">
            <select
              className="friends-sort-select"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as any)}
            >
              <option value="default">{t("friendsPage.sortDefault")}</option>
              <option value="name">{t("friendsPage.sortName")}</option>
              <option value="recent">{t("friendsPage.sortRecentlyAdded")}</option>
              <option value="online">{t("friendsPage.sortOnline")}</option>
            </select>
          </div>

          <div className="friends-density-toggle">
            <button
              type="button"
              className={`density-btn${density === "grid" ? " active" : ""}`}
              onClick={() => setDensity("grid")}
              title={t("friendsPage.densityGrid")}
            >
              ⊞
            </button>
            <button
              type="button"
              className={`density-btn${density === "list" ? " active" : ""}`}
              onClick={() => setDensity("list")}
              title={t("friendsPage.densityList")}
            >
              ☰
            </button>
          </div>

          <button
            type="button"
            className={`btn btn-secondary btn--mini batch-toggle-btn${selectMode ? " active" : ""}`}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelectedIds([]);
            }}
            title={selectMode ? t("friendsPage.exitSelectMode") : t("friendsPage.selectMultiple")}
          >
            <CheckIcon /> {selectMode ? t("friendsPage.exitSelectMode") : t("friendsPage.selectMultiple")}
          </button>

          <button
            type="button"
            className="btn btn-primary btn--mini"
            onClick={onOpenAddModal}
          >
            <PlusIcon /> {t("friends.addFriend")}
          </button>
        </div>
      </div>

      {/* Friend Circle Chips */}
      <div className="friends-circle-chips-row">
        <button
          type="button"
          className={`circle-chip${selectedCircleId === "all" ? " active" : ""}`}
          onClick={() => setSelectedCircleId("all")}
        >
          {t("friendsPage.allCircles")}
        </button>
        {circles.map((circle) => (
          <button
            key={circle.id}
            type="button"
            className={`circle-chip${selectedCircleId === circle.id ? " active" : ""}`}
            onClick={() => setSelectedCircleId(circle.id)}
            style={circle.color ? { borderColor: circle.color } : undefined}
          >
            <span className="circle-chip-dot" style={{ backgroundColor: circle.color || "var(--color-accent)" }} />
            <span>{circle.name}</span>
          </button>
        ))}
        <button
          type="button"
          className="circle-manage-btn"
          onClick={onOpenCirclesModal}
          title={t("friendsPage.manageCircles")}
        >
          <TagIcon />
          <span>{t("friendsPage.manageCircles")}</span>
        </button>
      </div>

      {/* Batch Select Controls (Only rendered when selectMode is true) */}
      {selectMode && (
        <div className="friends-batch-controls-bar">
          <div className="batch-count-info">
            <span className="bulk-count">
              {selectedIds.length} / {filteredFriends.length} {t("friendsPage.selectedCount", { count: selectedIds.length }) || "selected"}
            </span>
          </div>

          <div className="batch-actions-cluster">
            <button type="button" className="btn btn-secondary btn--mini" onClick={handleSelectAll}>
              {selectedIds.length === filteredFriends.length ? t("friendsPage.deselectAll") : t("friendsPage.selectAll")}
            </button>

            {selectedIds.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn--mini"
                  onClick={() => {
                    onBulkPin(selectedIds);
                    setSelectedIds([]);
                    setSelectMode(false);
                  }}
                >
                  <PinIcon /> {t("friendsPage.pinSelected")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn--mini"
                  onClick={() => {
                    onBulkUnpin(selectedIds);
                    setSelectedIds([]);
                    setSelectMode(false);
                  }}
                >
                  {t("friends.unpin")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn--mini"
                  onClick={() => {
                    onBulkBlock(selectedIds);
                    setSelectedIds([]);
                    setSelectMode(false);
                  }}
                >
                  <BlockIcon /> {t("friendsPage.blockSelected")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn--mini danger"
                  onClick={() => {
                    onBulkRemove(selectedIds);
                    setSelectedIds([]);
                    setSelectMode(false);
                  }}
                >
                  <TrashIcon /> {t("friendsPage.removeSelected")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Friends Grid / List */}
      {filteredFriends.length === 0 ? (
        <div className="friends-empty-state">
          <div className="friends-empty-icon">
            <UsersIcon />
          </div>
          <h3 className="friends-empty-title">{t("friends.noFriendsYet")}</h3>
          <p className="friends-empty-desc">
            {searchQuery
              ? t("friendsPage.noMatchesFound")
              : filterState !== "all"
              ? t("friendsPage.noFilteredFriends")
              : t("friends.addFriendsDesc")}
          </p>
          {!searchQuery && filterState === "all" && (
            <button type="button" className="btn btn-primary" onClick={onOpenAddModal}>
              <PlusIcon /> {t("friends.addFriend")}
            </button>
          )}
        </div>
      ) : (
        <div className={`friends-cards-grid${density === "list" ? " friends-cards-grid--list" : ""}`}>
          {filteredFriends.map((friend) => (
            <FriendCard
              key={friend.id}
              friend={friend}
              circles={circles}
              myGameIds={myGameIds}
              density={density}
              selectMode={selectMode}
              selected={selectedIds.includes(friend.id)}
              onToggleSelect={() => toggleSelectFriend(friend.id)}
              onCompare={() => onCompareFriend(friend)}
              onInvite={() => onInviteFriend(friend)}
              onMessage={() => onMessageFriend(friend)}
              onTogglePin={() => onTogglePin(friend.id)}
              onSetNickname={() => onEditNickname(friend)}
              onToggleBlock={() => onToggleBlock(friend.id, displayName(friend))}
              onDelete={() => onDeleteFriend(friend.id, displayName(friend))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
