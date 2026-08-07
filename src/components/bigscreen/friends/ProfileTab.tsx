// ProfileTab — my profile card, friend code, and the full editor
// (gamer tag, status + presets, region, bio, favorite game, avatar
// upload / procedural reset). Mirrors the desktop profile tab.

import { useRef } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import { useGames } from "../../../context/GameContext";
import { useToast } from "../../../context/ToastContext";
import { STATUS_PRESETS, type UserProfile } from "../../../pages/friendsStorage";
import type { UseFriendsSocialResult } from "../../../hooks/useFriendsSocial";
import { FriendAvatar, Icons, formatHours, formatLastSeen, useFocusableInput } from "./friendsUtils";

export interface ProfileTabProps {
  social: UseFriendsSocialResult;
  profile: UserProfile;
  setProfile: (p: UserProfile) => void;
  selfStats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number };
  generatedFriendCode: string;
  onSave: () => void;
}

export default function ProfileTab({
  social,
  profile,
  setProfile,
  selfStats,
  generatedFriendCode,
  onSave,
}: ProfileTabProps) {
  const { t } = useLanguage();
  const { games } = useGames();

  return (
    <div className="bigscreen-gamepage-2col bigscreen-profile-layout" data-cols="2">
      {/* Profile card + friend code */}
      <div className="bigscreen-profile-stack">
        <div className="bigscreen-panel-card">
          <div className="bigscreen-profile-card-header">
            <FriendAvatar avatar={profile.avatar} name={profile.name} className="bigscreen-friend-avatar bigscreen-friend-avatar--lg" />
            <div>
              <h3 className="bigscreen-profile-card-name">{profile.name}</h3>
              <div className="bigscreen-profile-card-status">"{profile.status || t("bigscreen.friends.noStatus")}"</div>
            </div>
          </div>

          {profile.region && (
            <div className="bigscreen-profile-meta-line">
              {Icons.mapPin()} {profile.region}
            </div>
          )}
          {profile.bio && <p className="bigscreen-profile-bio">{profile.bio}</p>}
          <div className="bigscreen-profile-meta-line">
            {Icons.clock()}{" "}
            {t("friendsPage.lastActiveWithTime", {
              time: profile.lastPublished ? formatLastSeen(profile.lastPublished, t) : t("friendsPage.formatJustNow"),
            })}
          </div>

          <div className="bigscreen-profile-stat-grid">
            <div className="bigscreen-profile-stat-box">
              <span className="bigscreen-profile-stat-value">{selfStats.gamesCount}</span>
              <span className="bigscreen-profile-stat-label">{t("friendsPage.profileGames")}</span>
            </div>
            <div className="bigscreen-profile-stat-box">
              <span className="bigscreen-profile-stat-value">{formatHours(selfStats.playtimeMinutes, t)}</span>
              <span className="bigscreen-profile-stat-label">{t("friendsPage.profilePlayed")}</span>
            </div>
            <div className="bigscreen-profile-stat-box">
              <span className="bigscreen-profile-stat-value">{selfStats.achievementsCount}</span>
              <span className="bigscreen-profile-stat-label">{t("friendsPage.profileTrophies")}</span>
            </div>
          </div>
        </div>

        <div className="bigscreen-panel-card">
          <div className="bigscreen-profile-key-block">
            <div className="bigscreen-kpi-label bigscreen-profile-key-label">{t("friends.profile.publicKey")}</div>
            <p className="bigscreen-profile-key-desc">{t("friendsPage.shareKeyDesc")}</p>
            <div className="bigscreen-profile-key">{generatedFriendCode}</div>
            <CopyKeyButton onCopy={() => social.handleCopyCode()} />
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="bigscreen-panel-card">
        <h3>{t("friends.profile.edit")}</h3>
        <ProfileEditor
          profile={profile}
          setProfile={setProfile}
          games={games}
          onSave={onSave}
        />
      </div>
    </div>
  );
}

// ─── Copy key button ──────────────────────────────────────────────

function CopyKeyButton({ onCopy }: { onCopy: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onCopy);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
      {...props}
    >
      {Icons.copy()}
      {t("friends.profile.copyKey")}
    </button>
  );
}

// ─── Editor form ──────────────────────────────────────────────────

function ProfileEditor({
  profile,
  setProfile,
  games,
  onSave,
}: {
  profile: UserProfile;
  setProfile: (p: UserProfile) => void;
  games: { id: string; name: string; coverArtUrl?: string }[];
  onSave: () => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const nameInput = useFocusableInput<HTMLInputElement>();
  const statusInput = useFocusableInput<HTMLInputElement>();
  const regionInput = useFocusableInput<HTMLInputElement>();
  const bioInput = useFocusableInput<HTMLTextAreaElement>();
  const favGameInput = useFocusableInput<HTMLSelectElement>();
  const formRef = useRef<HTMLFormElement | null>(null);
  const saveProps = useFocusable(() => formRef.current?.requestSubmit());

  const handleImageUpload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast(t("friendsPage.fileTooLarge"), "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const maxDim = 96;
        canvas.width = maxDim;
        canvas.height = maxDim;
        if (ctx) {
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxDim, maxDim);
          try {
            const compressedBase64 = canvas.toDataURL("image/jpeg", 0.6);
            setProfile({ ...profile, avatar: compressedBase64 });
            showToast(t("friendsPage.avatarUploaded"), "success");
          } catch {
            showToast(t("friendsPage.imageProcessingFailed"), "error");
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <form
      ref={formRef}
      className="bigscreen-profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="bigscreen-input-group">
        <label>{t("friends.profile.gamerTag")}</label>
        <input
          ref={nameInput.setInputRef}
          type="text"
          className="bigscreen-input"
          value={profile.name}
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          placeholder={t("friendsPage.enterName")}
          required
          tabIndex={nameInput.inputProps.tabIndex}
          role={nameInput.inputProps.role}
          onClick={nameInput.inputProps.onClick}
        />
      </div>

      <div className="bigscreen-input-group">
        <label>{t("friends.profile.status")}</label>
        <input
          ref={statusInput.setInputRef}
          type="text"
          className="bigscreen-input"
          value={profile.status}
          onChange={(e) => setProfile({ ...profile, status: e.target.value })}
          placeholder={t("friendsPage.statusPlaceholder")}
          tabIndex={statusInput.inputProps.tabIndex}
          role={statusInput.inputProps.role}
          onClick={statusInput.inputProps.onClick}
        />
        <div className="bigscreen-status-presets">
          {STATUS_PRESETS.map((preset) => (
            <StatusPresetChip
              key={preset.value}
              emoji={preset.emoji}
              active={profile.status === preset.value}
              onPick={() => setProfile({ ...profile, status: preset.value })}
            />
          ))}
        </div>
      </div>

      <div className="bigscreen-input-group">
        <label>{t("friends.profile.region")}</label>
        <input
          ref={regionInput.setInputRef}
          type="text"
          className="bigscreen-input"
          value={profile.region || ""}
          onChange={(e) => setProfile({ ...profile, region: e.target.value })}
          placeholder={t("friendsPage.regionPlaceholder")}
          tabIndex={regionInput.inputProps.tabIndex}
          role={regionInput.inputProps.role}
          onClick={regionInput.inputProps.onClick}
        />
      </div>

      <div className="bigscreen-input-group">
        <label>{t("friends.profile.bio")}</label>
        <textarea
          ref={bioInput.setInputRef}
          className="bigscreen-input bigscreen-input--textarea"
          value={profile.bio || ""}
          onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
          placeholder={t("friendsPage.bioPlaceholder")}
          tabIndex={bioInput.inputProps.tabIndex}
          role={bioInput.inputProps.role}
          onClick={bioInput.inputProps.onClick}
        />
      </div>

      <div className="bigscreen-input-group">
        <label>{t("friends.profile.favoriteGame")}</label>
        <select
          ref={favGameInput.setInputRef}
          className="bigscreen-input bigscreen-select"
          value={profile.favoriteGameId || ""}
          onChange={(e) => {
            const gameId = e.target.value;
            const selectedGame = games.find((g) => g.id === gameId);
            setProfile({
              ...profile,
              favoriteGameId: gameId,
              favoriteGameName: selectedGame ? selectedGame.name : "",
            });
          }}
          tabIndex={favGameInput.inputProps.tabIndex}
          role={favGameInput.inputProps.role}
          onClick={favGameInput.inputProps.onClick}
        >
          <option value="">{t("friends.profile.none")}</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bigscreen-input-group">
        <label>{t("friends.profile.avatarStyle")}</label>
        <div className="bigscreen-avatar-upload">
          <AvatarUploadButton onPick={(file) => handleImageUpload(file)} />
          {profile.avatar !== "procedural" && (
            <ResetAvatarButton
              onReset={() => setProfile({ ...profile, avatar: "procedural" })}
            />
          )}
          <span className="bigscreen-avatar-upload-info">{t("friendsPage.proceduralAvatarInfo")}</span>
        </div>
      </div>

      <button type="submit" className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-profile-save-btn" {...saveProps}>
        {Icons.check()}
        {t("friends.profile.save")}
      </button>
    </form>
  );
}

function StatusPresetChip({
  emoji,
  active,
  onPick,
}: {
  emoji: string;
  active: boolean;
  onPick: () => void;
}) {
  const props = useFocusable(onPick);
  return (
    <button
      type="button"
      className={`bigscreen-status-preset${active ? " active" : ""}`}
      {...props}
    >
      {emoji}
    </button>
  );
}

function AvatarUploadButton({ onPick }: { onPick: (file: File | undefined) => void }) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const labelProps = useFocusable(() => fileRef.current?.click());
  return (
    <>
      <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact" {...labelProps}>
        {Icons.plus()}
        {t("friends.profile.upload")}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="bigscreen-avatar-file-input"
        onChange={(e) => onPick(e.target.files?.[0])}
        tabIndex={-1}
      />
    </>
  );
}

function ResetAvatarButton({ onReset }: { onReset: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onReset);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
      {...props}
    >
      {Icons.refresh()}
      {t("friends.profile.resetProcedural")}
    </button>
  );
}
