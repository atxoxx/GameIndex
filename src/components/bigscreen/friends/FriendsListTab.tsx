// FriendsListTab — the Friends List surface of the Big Screen hub.
//
// Console translation of the desktop friends list: pending invitations,
// a "Playing Now" rail (with one-press Join), filter chips (All /
// Online / Pinned), circle chips, search + sort, the friend grid, and
// a circles manager modal. Every interactive element is a dedicated
// component so useFocusable counts stay stable (rules of hooks).

import { useMemo, useState } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import { useGames } from "../../../context/GameContext";
import {
  type Friend,
  type FriendCircle,
  displayName,
  dmThreadId,
} from "../../../pages/friendsStorage";
import type { FriendInvitation, UseFriendsSocialResult } from "../../../hooks/useFriendsSocial";
import { FriendAvatar, Icons, isOnline, useFocusableInput, useOverlayEscape } from "./friendsUtils";
import FriendCard from "./FriendCard";

export type FriendSort = "default" | "name" | "recent" | "online";
export type FriendFilter = "all" | "online" | "pinned";

export interface FriendsListTabProps {
  social: UseFriendsSocialResult;
  profileName: string;
  onOpenDm: (threadId: string, friendName: string) => void;
  onInviteToLobby: (friendName: string) => void;
  onCompare: (friendId: string) => void;
  onSetNickname: (friendId: string) => void;
}

export default function FriendsListTab({
  social,
  profileName,
  onOpenDm,
  onInviteToLobby,
  onCompare,
  onSetNickname,
}: FriendsListTabProps) {
  const { t } = useLanguage();
  const { runningGameIds, launchGame } = useGames();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FriendFilter>("all");
  const [sort, setSort] = useState<FriendSort>("default");
  const [selectedCircleId, setSelectedCircleId] = useState("all");
  const [showCirclesModal, setShowCirclesModal] = useState(false);

  const { friends, circles, invitations, playingNow, myGameIds } = social;

  const visibleFriends = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = friends.filter((f) => {
      const name = displayName(f).toLowerCase();
      const matchesQuery =
        !query || name.includes(query) || (f.favoriteGame || "").toLowerCase().includes(query);
      const matchesFilter = filter === "all" ? true : filter === "online" ? isOnline(f) : !!f.pinned;
      const matchesCircle =
        selectedCircleId === "all" || (f.groups || []).includes(selectedCircleId);
      return matchesQuery && matchesFilter && matchesCircle;
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return displayName(a).localeCompare(displayName(b));
      if (sort === "recent") return (b.addedAt || 0) - (a.addedAt || 0);
      if (sort === "online") {
        const ao = isOnline(a) ? 1 : 0;
        const bo = isOnline(b) ? 1 : 0;
        if (bo !== ao) return bo - ao;
        return (b.addedAt || 0) - (a.addedAt || 0);
      }
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return (b.addedAt || 0) - (a.addedAt || 0);
    });
    return list;
  }, [friends, search, filter, sort, selectedCircleId]);

  return (
    <div className="bigscreen-friends-list-section">
      {/* Pending invitations */}
      {invitations.length > 0 && (
        <section className="bigscreen-friends-invites">
          <div className="bigscreen-friends-section-head">
            <h3>{t("friends.pendingInvites", { count: invitations.length })}</h3>
          </div>
          <div className="bigscreen-friends-invites-list">
            {invitations.map((invite) => (
              <InvitationRow
                key={invite.syncId}
                invite={invite}
                onAccept={() => social.handleAcceptInvitation(invite)}
                onDeny={() => social.handleDenyInvitation(invite.syncId)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Playing Now rail */}
      {playingNow.length > 0 && (
        <section className="bigscreen-friends-playingnow">
          <div className="bigscreen-friends-section-head">
            <h3>{t("friendsPage.playingNowTitle")}</h3>
            <span className="bigscreen-friends-section-hint">{t("friendsPage.playingNowHint")}</span>
          </div>
          <div className="bigscreen-playingnow-rail">
            {playingNow.map(({ friend, playing, game }) => (
              <div key={friend.id} className="bigscreen-playingnow-card">
                <FriendAvatar
                  avatar={friend.avatar}
                  name={friend.name}
                  className="bigscreen-friend-avatar bigscreen-friend-avatar--sm"
                />
                <div className="bigscreen-playingnow-id">
                  <span className="bigscreen-playingnow-name">{displayName(friend)}</span>
                  <span className="bigscreen-playingnow-game">{playing}</span>
                </div>
                {game ? (
                  <JoinGameButton
                    running={runningGameIds.includes(game.id)}
                    onJoin={() => launchGame(game)}
                  />
                ) : (
                  <span
                    className="bigscreen-playingnow-notowned"
                    title={t("friendsPage.notOwnedHint")}
                  >
                    {t("friendsPage.notOwned")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {friends.length === 0 ? (
        <div className="system-view-empty">
          <p>{t("bigscreen.friends.noFriendsDesc")}</p>
        </div>
      ) : (
        <>
          {/* Controls: filter chips + circles + search + sort */}
          <div className="bigscreen-friends-controls">
            <div className="bigscreen-filter-chips" role="group" aria-label={t("friendsPage.friendFiltersAria")}>
              <FilterChip
                label={`${t("friends.filterAll")} (${friends.length})`}
                active={filter === "all"}
                onActivate={() => setFilter("all")}
              />
              <FilterChip
                label={`${t("friends.filterOnline")} (${friends.filter(isOnline).length})`}
                active={filter === "online"}
                onActivate={() => setFilter("online")}
              />
              <FilterChip
                label={`${t("friends.filterPinned")} (${friends.filter((f) => f.pinned).length})`}
                active={filter === "pinned"}
                onActivate={() => setFilter("pinned")}
              />
              {circles.length > 0 && (
                <FilterChip
                  label={t("friendsPage.allCircles")}
                  active={selectedCircleId === "all"}
                  onActivate={() => setSelectedCircleId("all")}
                />
              )}
              {circles.map((c) => (
                <FilterChip
                  key={c.id}
                  label={`${c.name} (${friends.filter((f) => (f.groups || []).includes(c.id)).length})`}
                  active={selectedCircleId === c.id}
                  onActivate={() => setSelectedCircleId(selectedCircleId === c.id ? "all" : c.id)}
                />
              ))}
            </div>

            <div className="bigscreen-friends-controls-tools">
              <CirclesManageButton onActivate={() => setShowCirclesModal(true)} />
              <SearchBox value={search} onChange={setSearch} onClear={() => setSearch("")} />
              <div className="bigscreen-friends-sort" role="group" aria-label={t("friendsPage.sortFriendsAria")}>
                {(
                  [
                    ["default", t("friends.sort.pinned")],
                    ["name", t("friends.sort.name")],
                    ["recent", t("friends.sort.recent")],
                    ["online", t("friends.sort.online")],
                  ] as [FriendSort, string][]
                ).map(([value, label]) => (
                  <FilterChip key={value} label={label} active={sort === value} onActivate={() => setSort(value)} />
                ))}
              </div>
            </div>
          </div>

          {visibleFriends.length === 0 ? (
            <div className="system-view-empty">
              <p>{t("friends.noMatch")}</p>
              <ClearFiltersButton
                onClear={() => {
                  setSearch("");
                  setFilter("all");
                }}
              />
            </div>
          ) : (
            <div className="bigscreen-friends-grid">
              {visibleFriends.map((friend) => (
                <FriendCard
                  key={friend.id}
                  friend={friend}
                  circles={circles}
                  myGameIds={myGameIds}
                  onPin={() => social.handleTogglePin(friend.id)}
                  onBlock={() => social.handleToggleBlock(friend.id, displayName(friend))}
                  onDelete={() => social.handleDeleteFriend(friend.id, displayName(friend))}
                  onSetNickname={() => onSetNickname(friend.id)}
                  onCompare={() => onCompare(friend.id)}
                  onMessage={() => {
                    const existing = social.dms.find(
                      (th) =>
                        th.participants.includes(profileName) && th.participants.includes(friend.name),
                    );
                    onOpenDm(existing ? existing.id : dmThreadId(profileName, friend.name), friend.name);
                  }}
                  onInviteToLobby={() => onInviteToLobby(friend.name)}
                  onToggleCircle={(circleId) => social.handleToggleFriendCircle(friend.id, circleId)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showCirclesModal && (
        <CirclesManager
          circles={circles}
          friends={friends}
          onClose={() => setShowCirclesModal(false)}
          onCreate={(name) => social.handleCreateCircle(name)}
          onRename={(id, name) => social.handleRenameCircle(id, name)}
          onDelete={(id) => social.handleDeleteCircle(id)}
          onToggleFriend={(friendId, circleId) => social.handleToggleFriendCircle(friendId, circleId)}
        />
      )}
    </div>
  );
}

// ─── Search box (focusable input + clear) ─────────────────────────

function SearchBox({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const { t } = useLanguage();
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  return (
    <div className="bigscreen-friends-search">
      <span className="bigscreen-friends-search-icon">{Icons.search()}</span>
      <input
        ref={setInputRef}
        type="text"
        className="bigscreen-input"
        placeholder={t("friends.searchPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={inputProps.tabIndex}
        role={inputProps.role}
        onClick={inputProps.onClick}
      />
      {value && <ClearSearchButton onClear={onClear} />}
    </div>
  );
}

function ClearSearchButton({ onClear }: { onClear: () => void }) {
  const { t } = useLanguage();
  const clearProps = useFocusable(onClear);
  return (
    <button
      type="button"
      className="bigscreen-friends-search-clear"
      aria-label={t("friends.clearSearch")}
      {...clearProps}
    >
      {Icons.x()}
    </button>
  );
}

// ─── Circles manager launcher ─────────────────────────────────────

function CirclesManageButton({ onActivate }: { onActivate: () => void }) {
  const { t } = useLanguage();
  const btnProps = useFocusable(onActivate);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
      {...btnProps}
    >
      {Icons.users()}
      {t("friendsPage.manageCircles")}
    </button>
  );
}

// ─── Invitation row ───────────────────────────────────────────────

function InvitationRow({
  invite,
  onAccept,
  onDeny,
}: {
  invite: FriendInvitation;
  onAccept: () => void;
  onDeny: () => void;
}) {
  const { t } = useLanguage();
  const acceptProps = useFocusable(onAccept);
  const denyProps = useFocusable(onDeny);
  return (
    <div className="bigscreen-friends-invite-row">
      <FriendAvatar
        avatar={invite.avatar}
        name={invite.name}
        className="bigscreen-friend-avatar bigscreen-friend-avatar--sm"
      />
      <div className="bigscreen-friends-invite-id">
        <div className="bigscreen-friends-invite-name">{invite.name}</div>
        <div className="bigscreen-friends-invite-status">
          {invite.status || t("friends.wantsToConnect")}
          {invite.favoriteGame && (
            <span className="bigscreen-friends-invite-fav">
              {Icons.star(true)} {invite.favoriteGame}
            </span>
          )}
        </div>
      </div>
      <div className="bigscreen-friends-invite-actions">
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
          {...acceptProps}
        >
          {Icons.check()}
          {t("bigscreen.friends.accept")}
        </button>
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
          {...denyProps}
        >
          {Icons.x()}
          {t("friends.deny")}
        </button>
      </div>
    </div>
  );
}

// ─── Join button ──────────────────────────────────────────────────

function JoinGameButton({
  running,
  onJoin,
}: {
  running: boolean;
  onJoin: () => void;
}) {
  const { t } = useLanguage();
  const joinProps = useFocusable(onJoin);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-playingnow-join"
      disabled={running}
      {...joinProps}
    >
      {Icons.gamepad()}
      {running ? t("friendsPage.running") : t("friendsPage.joinGame")}
    </button>
  );
}

// ─── Filter chip ──────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onActivate,
}: {
  label: string;
  active: boolean;
  onActivate: () => void;
}) {
  const chipProps = useFocusable(onActivate);
  return (
    <button type="button" className={`bigscreen-filter-chip${active ? " active" : ""}`} {...chipProps}>
      {label}
    </button>
  );
}

// ─── Clear-filters empty state button ─────────────────────────────

function ClearFiltersButton({ onClear }: { onClear: () => void }) {
  const { t } = useLanguage();
  const clearProps = useFocusable(onClear);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
      {...clearProps}
    >
      {t("friends.clearFilters")}
    </button>
  );
}

// ─── Circles manager modal ────────────────────────────────────────

function CirclesManager({
  circles,
  friends,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onToggleFriend,
}: {
  circles: FriendCircle[];
  friends: Friend[];
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleFriend: (friendId: string, circleId: string) => void;
}) {
  const { t } = useLanguage();
  const [newName, setNewName] = useState("");
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  const closeProps = useFocusable(onClose);
  useOverlayEscape(onClose);
  const createProps = useFocusable(() => {
    if (newName.trim()) {
      onCreate(newName);
      setNewName("");
    }
  });

  return (
    <div
      data-bigscreen-overlay="true"
      role="dialog"
      aria-modal="true"
      className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
      onMouseDown={onClose}
    >
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-circles-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bigscreen-overlay-drawer-header">
          <h3>{t("friendsPage.manageCircles")}</h3>
          <button type="button" className="bigscreen-overlay-drawer-close" aria-label={t("common.close")} {...closeProps}>
            {Icons.x()}
          </button>
        </div>

        <div className="bigscreen-overlay-drawer-content bigscreen-circles-content">
          {circles.length === 0 ? (
            <div className="bigscreen-circles-empty">
              <p>{t("bigscreen.friends.noCircles")}</p>
              <p>{t("bigscreen.friends.noCirclesDesc")}</p>
            </div>
          ) : (
            circles.map((circle) => (
              <CircleEditor
                key={circle.id}
                circle={circle}
                friends={friends}
                onRename={onRename}
                onDelete={onDelete}
                onToggleFriend={onToggleFriend}
              />
            ))
          )}

          <div className="bigscreen-circle-create-row">
            <input
              ref={setInputRef}
              type="text"
              className="bigscreen-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              tabIndex={inputProps.tabIndex}
              role={inputProps.role}
              onClick={inputProps.onClick}
              placeholder={t("bigscreen.friends.circleNamePlaceholder")}
            />
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
              {...createProps}
            >
              {Icons.plus()}
              {t("bigscreen.friends.newCircle")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Single circle editor (rename / delete / member toggles) ──────

function CircleEditor({
  circle,
  friends,
  onRename,
  onDelete,
  onToggleFriend,
}: {
  circle: FriendCircle;
  friends: Friend[];
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleFriend: (friendId: string, circleId: string) => void;
}) {
  const { t } = useLanguage();
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  const renameProps = useFocusable(() => {
    setRenaming(true);
    setRenameDraft(circle.name);
  });
  const deleteProps = useFocusable(() => onDelete(circle.id));
  const confirmRenameProps = useFocusable(() => {
    onRename(circle.id, renameDraft);
    setRenaming(false);
  });

  return (
    <div className="bigscreen-circle-editor">
      {renaming ? (
        <div className="bigscreen-circle-rename-row">
          <input
            ref={setInputRef}
            type="text"
            className="bigscreen-input"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            tabIndex={inputProps.tabIndex}
            role={inputProps.role}
            onClick={inputProps.onClick}
            placeholder={t("bigscreen.friends.circleNamePlaceholder")}
          />
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
            {...confirmRenameProps}
          >
            {t("common.confirm")}
          </button>
        </div>
      ) : (
        <div className="bigscreen-circle-head">
          <span className="bigscreen-circle-head-dot" aria-hidden />
          <span className="bigscreen-circle-name">{circle.name}</span>
          <span className="bigscreen-circle-count">
            {t("bigscreen.friends.memberCount", {
              count: friends.filter((f) => (f.groups || []).includes(circle.id)).length,
            })}
          </span>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
            {...renameProps}
          >
            {t("bigscreen.friends.rename")}
          </button>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--danger bigscreen-details-btn--compact"
            {...deleteProps}
          >
            {t("bigscreen.friends.deleteCircle")}
          </button>
        </div>
      )}

      <div className="bigscreen-circle-members">
        {friends.map((f) => (
          <CircleMemberToggle
            key={f.id}
            name={displayName(f)}
            active={(f.groups || []).includes(circle.id)}
            onToggle={() => onToggleFriend(f.id, circle.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CircleMemberToggle({
  name,
  active,
  onToggle,
}: {
  name: string;
  active: boolean;
  onToggle: () => void;
}) {
  const toggleProps = useFocusable(onToggle);
  return (
    <button
      type="button"
      className={`bigscreen-circle-member${active ? " active" : ""}`}
      {...toggleProps}
    >
      {name}
      {active && <span className="bigscreen-circle-member-check">{Icons.check()}</span>}
    </button>
  );
}
