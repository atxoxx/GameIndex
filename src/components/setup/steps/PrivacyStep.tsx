import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { SetupSection, SetupToggle } from "../SetupControls";

/** Ninth step: optional online features, all off/neutral by default. */
export default function PrivacyStep() {
  const { t } = useLanguage();
  const {
    discordRichPresence,
    setDiscordRichPresence,
    webviewContentFilter,
    setWebviewContentFilter,
    friendsNotifications,
    setFriendsNotifications,
    dmReadReceipts,
    setDmReadReceipts,
  } = useSettings();

  return (
    <div className="setup-step">
      <SetupSection title={t("setup.privacy.heading")} desc={t("setup.privacy.body")}>
        <div className="setup-toggle-list">
          <SetupToggle
            title={t("setup.features.discord")}
            tip={t("setup.features.discordTip")}
            checked={discordRichPresence}
            onChange={setDiscordRichPresence}
          />
          <SetupToggle
            title={t("setup.privacy.contentFilter")}
            tip={t("setup.privacy.contentFilterTip")}
            checked={webviewContentFilter}
            onChange={setWebviewContentFilter}
          />
          <SetupToggle
            title={t("setup.privacy.friendsNotifications")}
            tip={t("setup.privacy.friendsNotificationsTip")}
            checked={friendsNotifications}
            onChange={setFriendsNotifications}
          />
          <SetupToggle
            title={t("setup.privacy.readReceipts")}
            tip={t("setup.privacy.readReceiptsTip")}
            checked={dmReadReceipts}
            onChange={setDmReadReceipts}
          />
        </div>
      </SetupSection>
    </div>
  );
}
