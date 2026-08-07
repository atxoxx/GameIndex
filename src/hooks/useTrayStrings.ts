import { useEffect } from "react";
import { emit } from "@tauri-apps/api/event";
import { useLanguage } from "../context/LanguageContext";

/**
 * useTrayStrings
 * ──────────────
 * Emits the system tray menu strings for the active UI language as a
 * `tray-strings` event (camelCase payload). The backend tray menu falls
 * back to English until it receives this payload, and re-emits whenever
 * the language changes so the tray always matches the app UI.
 */
export function useTrayStrings() {
  const { t } = useLanguage();

  useEffect(() => {
    void emit("tray-strings", {
      idle: t("tray.idle"),
      playing: t("tray.playing"),
      show: t("tray.show"),
      hide: t("tray.hide"),
      quit: t("tray.quit"),
      recent: t("tray.recent"),
      noRecent: t("tray.noRecent"),
      downloads: t("tray.downloads"),
      downloadsActive: t("tray.downloadsActive"),
      noDownloads: t("tray.noDownloads"),
      downloadRow: t("tray.downloadRow"),
      downloadStarting: t("tray.downloadStarting"),
      openDownloads: t("tray.openDownloads"),
      library: t("tray.library"),
      store: t("tray.store"),
      activity: t("tray.activity"),
      friends: t("tray.friends"),
      mods: t("tray.mods"),
      settings: t("tray.settings"),
    });
  }, [t]);
}