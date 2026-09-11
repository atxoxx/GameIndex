import { useCallback } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { copyTextToClipboard } from "../utils/clipboard";

/** Copy text to the clipboard and confirm the outcome with a toast. */
export function useCopyToClipboard() {
  const { showToast } = useToast();
  const { t } = useLanguage();

  return useCallback(
    async (text: string): Promise<boolean> => {
      const copied = await copyTextToClipboard(text);
      showToast(
        copied ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
        copied ? "success" : "error"
      );
      return copied;
    },
    [showToast, t]
  );
}
