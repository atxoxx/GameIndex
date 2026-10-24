import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Check,
  Inbox,
  LayoutList,
  Pin,
  Rows3,
  Search,
  Tag,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { usePersistedState } from "../../../hooks/usePersistedState";
import type { Friend, FriendCircle, FriendInvitation } from "../friendsTypes";
import { displayName, isOnline, safeCurrentlyPlaying } from "../friendsUtils";
import { FriendAvatar } from "../shared/FriendAvatar";
import type { FriendsRosterFilter } from "../shared/FriendsHeroBand";
import { FriendRow } from "./FriendRow";

type SortOption = "default" | "name" | "recent" | "online";
type Density = "comfortable" | "compact";

interface FriendsRosterProps {
  friends: Friend[];
  circles: FriendCircle[];
  invitations: FriendInvitation[];
  selectedFriendId: string | null;
  filter: FriendsRosterFilter;
  onFilterChange: (filter: FriendsRosterFilter) => void;
  onSelectFriend: (friendId: string) => void;
  onOpenAddModal: () => void;
  onOpenCirclesModal: () => void;
  onAcceptInvitation: (invite: FriendInvitation) => void;
  onDenyInvitation: (syncId: string) => void;
  onMessageFriend: (friend: Friend) => void;
  onInviteFriend: (friend: Friend) => void;
  onCompareFriend: (friend: Friend) => void;
  onTogglePin: (friendId: string) => void;
  onEditNickname: (friend: Friend) => void;
  onToggleBlock: (friendId: string, friendName: string) => void;
  onDeleteFriend: (friendId: string, friendName: string) => void;
  onBulkPin: (friendIds: string[]) => void;
  onBulkUnpin: (friendIds: string[]) => void;
  onBulkBlock: (friendIds: string[]) => void;
  onBulkRemove: (friendIds: string[]) => void;
}

const FILTERS: FriendsRosterFilter[] = ["all", "online", "ingame", "pinned", "blocked"];

export function FriendsRoster({
  friends,
  circles,
  invitations,
  selectedFriendId,
  filter,
  onFilterChange,
  onSelectFriend,
  onOpenAddModal,
  onOpenCirclesModal,
  onAcceptInvitation,
  onDenyInvitation,
  onMessageFriend,
  onInviteFriend,
  onCompareFriend,
  onTogglePin,
  onEditNickname,
  onToggleBlock,
  onDeleteFriend,
  onBulkPin,
  onBulkUnpin,
  onBulkBlock,
  onBulkRemove,
}: FriendsRosterProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("default");
  const [circleId, setCircleId] = useState<string>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [density, setDensity] = usePersistedState<Density>(
    "gamelib.friends.roster.density_v2",
    "comfortable",
    ["comfortable", "compact"]
  );

  useEffect(() => {
    if (circleId !== "all" && !circles.some((circle) => circle.id === circleId)) setCircleId("all");
  }, [circles, circleId]);

  const visible = useMemo(() => {
    let list = [...friends];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((friend) => {
        const name = displayName(friend).toLowerCase();
        const raw = friend.name.toLowerCase();
        const favorite = (friend.favoriteGame || "").toLowerCase();
        const playing = (safeCurrentlyPlaying(friend.currentlyPlaying) || "").toLowerCase();
        return name.includes(q) || raw.includes(q) || favorite.includes(q) || playing.includes(q);
      });
    }

    if (circleId !== "all") list = list.filter((friend) => (friend.groups || []).includes(circleId));

    if (filter === "blocked") {
      list = list.filter((friend) => friend.blocked);
    } else {
      list = list.filter((friend) => !friend.blocked);
      if (filter === "online") list = list.filter((friend) => isOnline(friend));
      else if (filter === "ingame") list = list.filter((friend) => !!safeCurrentlyPlaying(friend.currentlyPlaying));
      else if (filter === "pinned") list = list.filter((friend) => friend.pinned);
    }

    list.sort((a, b) => {
      if (sort === "name") return displayName(a).localeCompare(displayName(b));
      if (sort === "recent") return (b.addedAt || 0) - (a.addedAt || 0);
      if (sort === "online") {
        const ao = isOnline(a) ? 1 : 0;
        const bo = isOnline(b) ? 1 : 0;
        if (ao !== bo) return bo - ao;
        return (b.addedAt || 0) - (a.addedAt || 0);
      }
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (b.addedAt || 0) - (a.addedAt || 0);
    });

    return list;
  }, [friends, searchQuery, circleId, filter, sort]);

  const filterCount = (key: FriendsRosterFilter) => {
    if (key === "all") return friends.filter((friend) => !friend.blocked).length;
    if (key === "online") return friends.filter((friend) => !friend.blocked && isOnline(friend)).length;
    if (key === "ingame") {
      return friends.filter((friend) => !friend.blocked && !!safeCurrentlyPlaying(friend.currentlyPlaying)).length;
    }
    if (key === "pinned") return friends.filter((friend) => !friend.blocked && friend.pinned).length;
    return friends.filter((friend) => friend.blocked).length;
  };

  const toggleChecked = (friendId: string) => {
    setSelectedIds((prev) => (prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId]));
  };

  const clearSelection = () => setSelectedIds([]);

  const handleBulk = (action: (ids: string[]) => void) => {
    action(selectedIds);
    clearSelection();
    setSelectMode(false);
  };

  return (
    <aside className="friends-roster" aria-label={t("friendsPage.friendList")}>
      <div className="friends-roster__head">
        <div>
          <span className="friends-roster__eyebrow">{t("friendsPage.yourCircle")}</span>
          <h2 className="friends-roster__title">
            {t("friendsPage.friendList")}
            <span className="friends-roster__count">{friends.filter((friend) => !friend.blocked).length}</span>
          </h2>
        </div>
        <button
          type="button"
          className="friends-roster__add"
          onClick={onOpenAddModal}
          title={t("friends.addFriend")}
          aria-label={t("friends.addFriend")}
        >
          <UserPlus size={16} aria-hidden="true" />
        </button>
      </div>

      {invitations.length > 0 && (
        <div className="friends-invites">
          <div className="friends-invites__head">
            <Inbox size={14} aria-hidden="true" />
            {t("friendsPage.pendingInvitations", { count: invitations.length })}
          </div>
          <div className="friends-invites__list">
            {invitations.map((invite) => (
              <div key={invite.syncId} className="friends-invite">
                <FriendAvatar name={invite.name} avatar={invite.avatar} size="sm" />
                <span className="friends-invite__meta">
                  <span className="friends-invite__name">{invite.name}</span>
                  <span className="friends-invite__status">{invite.status || t("friendsPage.formatOnline")}</span>
                </span>
                <button
                  type="button"
                  className="friends-invite__accept"
                  onClick={() => onAcceptInvitation(invite)}
                  title={t("friendsPage.acceptInvite")}
                  aria-label={t("friendsPage.acceptInvite")}
                >
                  <Check size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="friends-invite__deny"
                  onClick={() => onDenyInvitation(invite.syncId)}
                  title={t("friendsPage.denyInvite")}
                  aria-label={t("friendsPage.denyInvite")}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="friends-roster__search">
        <Search size={15} className="friends-roster__search-icon" aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("friends.searchPlaceholder")}
          aria-label={t("friends.searchPlaceholder")}
        />
        {searchQuery && (
          <button
            type="button"
            className="friends-roster__search-clear"
            onClick={() => setSearchQuery("")}
            title={t("common.clear")}
            aria-label={t("common.clear")}
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="friends-roster__filters" role="group" aria-label={t("friendsPage.filterByStatus")}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={["friends-filter-chip", filter === key ? "is-active" : ""].filter(Boolean).join(" ")}
            onClick={() => onFilterChange(key)}
            aria-pressed={filter === key}
          >
            {t(`friendsPage.filter.${key}`)}
            <span>{filterCount(key)}</span>
          </button>
        ))}
      </div>

      <div className="friends-roster__tools">
        <select
          className="friends-select"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortOption)}
          aria-label={t("friendsPage.sortBy")}
        >
          <option value="default">{t("friendsPage.sortDefault")}</option>
          <option value="name">{t("friendsPage.sortName")}</option>
          <option value="recent">{t("friendsPage.sortRecentlyAdded")}</option>
          <option value="online">{t("friendsPage.sortOnline")}</option>
        </select>

        <div className="friends-density" role="group" aria-label={t("friendsPage.rowDensity")}>
          <button
            type="button"
            className={density === "comfortable" ? "is-active" : ""}
            onClick={() => setDensity("comfortable")}
            title={t("friendsPage.densityComfortable")}
            aria-pressed={density === "comfortable"}
          >
            <Rows3 size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={density === "compact" ? "is-active" : ""}
            onClick={() => setDensity("compact")}
            title={t("friendsPage.densityCompact")}
            aria-pressed={density === "compact"}
          >
            <LayoutList size={14} aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          className={["friends-roster__tool", selectMode ? "is-active" : ""].filter(Boolean).join(" ")}
          onClick={() => {
            setSelectMode((value) => !value);
            clearSelection();
          }}
          title={selectMode ? t("friendsPage.exitSelectMode") : t("friendsPage.selectMultiple")}
          aria-pressed={selectMode}
        >
          {selectMode ? <X size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
        </button>

        <button
          type="button"
          className="friends-roster__tool"
          onClick={onOpenCirclesModal}
          title={t("friendsPage.manageCircles")}
          aria-label={t("friendsPage.manageCircles")}
        >
          <Tag size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="friends-roster__circles">
        <button
          type="button"
          className={["friends-circle-chip", circleId === "all" ? "is-active" : ""].filter(Boolean).join(" ")}
          onClick={() => setCircleId("all")}
        >
          {t("friendsPage.allCircles")}
        </button>
        {circles.map((circle) => (
          <button
            key={circle.id}
            type="button"
            className={["friends-circle-chip", circleId === circle.id ? "is-active" : ""].filter(Boolean).join(" ")}
            onClick={() => setCircleId(circle.id)}
          >
            <span className="friends-circle-chip__dot" style={{ background: circle.color || "var(--color-accent)" }} />
            {circle.name}
          </button>
        ))}
        {circles.length === 0 && (
          <button type="button" className="friends-circle-chip is-ghost" onClick={onOpenCirclesModal}>
            <Tag size={12} aria-hidden="true" />
            {t("friendsPage.createCircle")}
          </button>
        )}
      </div>

      {selectMode && (
        <div className="friends-bulk">
          <span className="friends-bulk__count">
            {selectedIds.length} / {visible.length}
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(selectedIds.length === visible.length ? [] : visible.map((friend) => friend.id))}
          >
            {selectedIds.length === visible.length ? t("friendsPage.deselectAll") : t("friendsPage.selectAll")}
          </button>
          <span className="friends-bulk__actions">
            <button type="button" onClick={() => handleBulk(onBulkPin)} disabled={selectedIds.length === 0}>
              <Pin size={13} aria-hidden="true" />
              {t("friendsPage.pinSelected")}
            </button>
            <button type="button" onClick={() => handleBulk(onBulkUnpin)} disabled={selectedIds.length === 0}>
              {t("friends.unpin")}
            </button>
            <button type="button" onClick={() => handleBulk(onBulkBlock)} disabled={selectedIds.length === 0}>
              <Ban size={13} aria-hidden="true" />
              {t("friendsPage.blockSelected")}
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => handleBulk(onBulkRemove)}
              disabled={selectedIds.length === 0}
            >
              <Trash2 size={13} aria-hidden="true" />
              {t("friendsPage.removeSelected")}
            </button>
          </span>
        </div>
      )}

      <div className="friends-roster__list" role="listbox" aria-label={t("friendsPage.friendList")}>
        {visible.length === 0 ? (
          <div className="friends-empty">
            <span className="friends-empty__icon" aria-hidden="true">
              <Users size={22} />
            </span>
            <h3>
              {searchQuery
                ? t("friendsPage.noMatchesFound")
                : filter !== "all"
                ? t("friendsPage.noFilteredFriends")
                : t("friends.noFriendsYet")}
            </h3>
            <p>
              {searchQuery
                ? t("friendsPage.noMatchesHint")
                : filter !== "all"
                ? t("friendsPage.noFilteredFriends")
                : t("friends.addFriendsDesc")}
            </p>
            {!searchQuery && filter === "all" && (
              <button type="button" className="friends-empty__action" onClick={onOpenAddModal}>
                <UserPlus size={14} aria-hidden="true" />
                {t("friends.addFriend")}
              </button>
            )}
          </div>
        ) : (
          visible.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              circles={circles}
              density={density}
              selected={selectedFriendId === friend.id}
              selectMode={selectMode}
              checked={selectedIds.includes(friend.id)}
              onSelect={() => onSelectFriend(friend.id)}
              onToggleChecked={() => toggleChecked(friend.id)}
              onMessage={() => onMessageFriend(friend)}
              onInvite={() => onInviteFriend(friend)}
              onCompare={() => onCompareFriend(friend)}
              onTogglePin={() => onTogglePin(friend.id)}
              onSetNickname={() => onEditNickname(friend)}
              onToggleBlock={() => onToggleBlock(friend.id, displayName(friend))}
              onDelete={() => onDeleteFriend(friend.id, displayName(friend))}
            />
          ))
        )}
      </div>
    </aside>
  );
}

export default FriendsRoster;
