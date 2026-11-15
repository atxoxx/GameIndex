import { Play, Settings2, TerminalSquare } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import { WineLogsPathChip } from "./WineLogsPathChip";

interface WineLogsEmptyStateProps {
  logPath?: string;
  onLaunch?: () => void;
  onOpenCompatSettings?: () => void;
  onCopyPath: () => Promise<boolean>;
}

/**
 * Empty state with somewhere to go: launch the game (primary) or open the
 * compatibility settings that decide where the log lands (secondary).
 */
export function WineLogsEmptyState({
  logPath,
  onLaunch,
  onOpenCompatSettings,
  onCopyPath,
}: WineLogsEmptyStateProps) {
  const { t } = useLanguage();

  return (
    <div className="wine-logs-empty">
      <span className="wine-logs-empty-icon" aria-hidden>
        <TerminalSquare size={20} />
      </span>
      <h3 className="wine-logs-empty-title">{t("wineLogs.noLogsTitle")}</h3>
      <p className="wine-logs-empty-desc">{t("wineLogs.noLogsDesc")}</p>

      {onLaunch || onOpenCompatSettings ? (
        <div className="wine-logs-empty-actions">
          {onLaunch ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onLaunch}
              leftIcon={<Play size={13} />}
            >
              {t("wineLogs.launchWithWine")}
            </Button>
          ) : null}
          {onOpenCompatSettings ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenCompatSettings}
              leftIcon={<Settings2 size={13} />}
            >
              {t("wineLogs.openCompatSettings")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {logPath ? (
        <div className="wine-logs-empty-path">
          <WineLogsPathChip path={logPath} onCopy={onCopyPath} />
        </div>
      ) : null}
    </div>
  );
}
