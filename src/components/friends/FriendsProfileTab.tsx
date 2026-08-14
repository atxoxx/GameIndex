import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { UserProfile } from "./friendsTypes";
import {
  FriendCodeQR,
  formatHours,
  getInitials,
  getProceduralAvatarStyle,
  SearchableGameSelector,
  UserIcon,
  CopyIcon,
  StarIcon,
  MapPinIcon,
  CheckIcon,
} from "./friendsUtils";
import { STATUS_PRESETS } from "../../pages/friendsStorage";

interface FriendsProfileTabProps {
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  selfStats: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
  libraryGames: any[];
  myFriendCode: string;
  nostrPublicKey: string;
  onSaveProfile: (e: React.FormEvent) => void;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function FriendsProfileTab({
  profile,
  setProfile,
  selfStats,
  libraryGames,
  myFriendCode,
  nostrPublicKey,
  onSaveProfile,
  onImageUpload,
}: FriendsProfileTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(t("friendsPage.copiedToClipboard", { label }), "success");
  };

  const handleUseProceduralAvatar = () => {
    setProfile((prev) => ({ ...prev, avatar: "procedural" }));
  };

  return (
    <div className="friends-profile-section">
      <div className="profile-layout-grid">
        {/* Left Column: Live Profile Preview Card */}
        <div className="profile-preview-column">
          <div className="profile-card-preview">
            <div className="profile-card-banner" />
            <div className="profile-card-avatar-wrapper">
              {profile.avatar && profile.avatar.startsWith("data:") ? (
                <img src={profile.avatar} alt={profile.name} className="profile-card-avatar-img" />
              ) : (
                <div
                  className="profile-card-avatar-procedural"
                  style={getProceduralAvatarStyle(profile.name)}
                >
                  {getInitials(profile.name)}
                </div>
              )}
              <span className="profile-presence-dot online" />
            </div>

            <div className="profile-card-identity">
              <h2 className="profile-card-name">{profile.name}</h2>
              {profile.region && (
                <div className="profile-card-region">
                  <MapPinIcon /> <span>{profile.region}</span>
                </div>
              )}
              <div className="profile-card-status">
                <span>{profile.status || t("friendsPage.formatOnline")}</span>
              </div>
            </div>

            {profile.bio && <p className="profile-card-bio">"{profile.bio}"</p>}

            {profile.favoriteGameName && (
              <div className="profile-card-fav-game">
                <StarIcon />
                <span>{t("friendsPage.favoriteGame", { game: profile.favoriteGameName })}</span>
              </div>
            )}

            <div className="profile-card-stats-row">
              <div className="profile-stat-box">
                <span className="profile-stat-val">{selfStats.gamesCount}</span>
                <span className="profile-stat-lbl">{t("friendsPage.games")}</span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-val">{formatHours(selfStats.playtimeMinutes, t)}</span>
                <span className="profile-stat-lbl">{t("friendsPage.playtime")}</span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-val">{selfStats.achievementsCount}</span>
                <span className="profile-stat-lbl">{t("friendsPage.achievements")}</span>
              </div>
            </div>
          </div>

          {/* Friend Code Card */}
          <div className="friend-code-card">
            <h3 className="friend-code-title">{t("friendsPage.yourFriendCode")}</h3>
            <p className="friends-modal-desc">{t("friendsPage.shareCodeDesc")}</p>

            <div className="my-code-box">
              <span className="my-code-text">{myFriendCode}</span>
              <button
                type="button"
                className="btn btn-secondary btn--mini"
                onClick={() => copyToClipboard(myFriendCode, t("friendsPage.friendCode"))}
              >
                <CopyIcon /> {t("common.copy")}
              </button>
            </div>

            {myFriendCode && (
              <div className="profile-qr-box">
                <FriendCodeQR code={myFriendCode} />
                <span className="profile-qr-caption">{t("friends.scanQrWithMobile")}</span>
              </div>
            )}

            {nostrPublicKey && (
              <div className="nostr-key-box">
                <span className="nostr-key-label">{t("friendsPage.nostrPublicKey")}</span>
                <div className="nostr-key-row">
                  <span className="nostr-key-val">{nostrPublicKey}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn--mini"
                    onClick={() => copyToClipboard(nostrPublicKey, t("friendsPage.nostrPublicKey"))}
                  >
                    <CopyIcon />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Profile Editor Form */}
        <div className="profile-editor-column">
          <form className="profile-editor-card" onSubmit={onSaveProfile}>
            <h3 className="profile-editor-heading">
              <UserIcon /> {t("friendsPage.editProfileHeading")}
            </h3>

            <div className="form-group">
              <label className="form-label">{t("friends.displayName")}</label>
              <input
                type="text"
                className="profile-input"
                value={profile.name}
                onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>

            {/* Avatar Selector */}
            <div className="form-group">
              <label className="form-label">{t("friendsPage.avatarPicture")}</label>
              <div className="avatar-options-row">
                <button
                  type="button"
                  className={`btn btn-secondary btn--mini${
                    profile.avatar === "procedural" ? " active" : ""
                  }`}
                  onClick={handleUseProceduralAvatar}
                >
                  {t("friendsPage.proceduralAvatar")}
                </button>

                <label className="btn btn-secondary btn--mini file-upload-label">
                  <span>{t("friendsPage.uploadCustomImage")}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onImageUpload}
                    className="hidden-file-input"
                  />
                </label>
              </div>
            </div>

            {/* Status Presets */}
            <div className="form-group">
              <label className="form-label">{t("friendsPage.statusPreset")}</label>
              <div className="status-presets-pills">
                {STATUS_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={`status-preset-btn${profile.status === preset.value ? " active" : ""}`}
                    onClick={() => setProfile((prev) => ({ ...prev, status: preset.value }))}
                  >
                    <span>{preset.emoji}</span>
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">{t("friendsPage.customStatus")}</label>
              <input
                type="text"
                className="profile-input"
                placeholder={t("friendsPage.customStatusPlaceholder")}
                value={profile.status}
                onChange={(e) => setProfile((prev) => ({ ...prev, status: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t("friendsPage.bio")}</label>
              <textarea
                className="profile-input"
                rows={3}
                placeholder={t("friendsPage.bioPlaceholder")}
                value={profile.bio || ""}
                onChange={(e) => setProfile((prev) => ({ ...prev, bio: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t("friendsPage.region")}</label>
              <input
                type="text"
                className="profile-input"
                placeholder={t("friendsPage.regionPlaceholder")}
                value={profile.region || ""}
                onChange={(e) => setProfile((prev) => ({ ...prev, region: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t("friendsPage.favoriteGameLabel")}</label>
              <SearchableGameSelector
                games={libraryGames}
                selectedGameId={profile.favoriteGameId || ""}
                onSelect={(gid) => {
                  const found = libraryGames.find((g) => g.id === gid);
                  setProfile((prev) => ({
                    ...prev,
                    favoriteGameId: gid,
                    favoriteGameName: found ? found.name : undefined,
                  }));
                }}
              />
            </div>

            <div className="profile-editor-footer">
              <button type="submit" className="btn btn-primary">
                <CheckIcon /> {t("friendsPage.saveProfile")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
