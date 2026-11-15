import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";

interface WineLogsPathChipProps {
  path: string;
  /** Resolves true when the path reached the clipboard. */
  onCopy: () => Promise<boolean>;
}

/**
 * Quiet, copyable log-path chip. Shared by the rail and the empty state so
 * the path is never a full-width bordered bar.
 */
export function WineLogsPathChip({ path, onCopy }: WineLogsPathChipProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  async function handleCopy() {
    const ok = await onCopy();
    if (!ok) return;
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      className="wine-logs-path"
      title={path}
      aria-label={t("wineLogs.copyPath")}
      data-copied={copied ? "true" : undefined}
      onClick={() => void handleCopy()}
    >
      <span className="wine-logs-path-text">{path}</span>
      <span className="wine-logs-path-icon" aria-hidden>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </span>
      {copied ? <span className="wine-logs-path-copied">{t("wineLogs.copied")}</span> : null}
    </button>
  );
}
